// routes/pdfExtractor.js  (or inside your main app.js/server.js)

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const jwt = require('jsonwebtoken');
const PersonDetail = require('../models/PersonDetail'); // Your existing model

// Middleware to verify JWT
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ error: 'Access token required' });

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid or expired token' });
    req.user = user; // { id: '...' }
    next();
  });
};

// Helper: Convert stream to string
const streamToString = (stream) => {
  const chunks = [];
  return new Promise((resolve, reject) => {
    stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
};

// API Endpoint
router.post('/extract-latest-pdf', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    console.log(userId);
    // Step 1: Get referenceNumber from PersonDetail
    const person = await PersonDetail.findOne({ UserId: userId });
    console.log('person',person);
    if (!person || !person.ReferanceNo) {
      return res.status(404).json({ error: 'Reference number not found for user' });
    }

    const referenceNumber = person.ReferanceNo;
    const userDir = path.join(__dirname, '../bills/pdfs');
console.log(userDir)
    // Step 2: Check if directory exists
    if (!fs.existsSync(userDir)) {
      return res.status(404).json({ error: 'No documents found for this reference' });
    }

    // Step 3: Get all PDFs and sort by modified time (latest first)
    const files = fs.readdirSync(userDir)
      .filter(file => file.toLowerCase().endsWith('.pdf'))
      .map(file => ({
        name: file,
        fullPath: path.join(userDir, file),
        mtime: fs.statSync(path.join(userDir, file)).mtime
      }))
      .sort((a, b) => b.mtime - a.mtime);

    if (files.length === 0) {
      return res.status(404).json({ error: 'No PDF files found' });
    }

    const latestPdfPath = files[0].fullPath;

    // Step 4: Prepare FormData for Nutrient.io
    const form = new FormData();
    form.append('instructions', JSON.stringify({
      parts: [{ file: "document" }],
      output: {
        type: "json-content",
        plainText: false,
        structuredText: false,
        keyValuePairs: false,
        tables: true
      }
    }));
    form.append('document', fs.createReadStream(latestPdfPath));

    // Step 5: Call Nutrient.io API
    const response = await axios.post('https://api.nutrient.io/build', form, {
      headers: {
        ...form.getHeaders(),
        'Authorization': 'Bearer pdf_live_AjaIXiBuq39n1DzCiNhlKXpT7dsxPmQYnasfBQpnDeC'
      },
      responseType: 'stream',
      timeout: 60000 // 60 seconds
    });

    // Step 6: Stream response and collect JSON
    let resultJson;
    try {
      const responseText = await streamToString(response.data);
      resultJson = JSON.parse(responseText);
    } catch (parseErr) {
      return res.status(500).json({ error: 'Failed to parse PDF extraction result' });
    }

    // Step 7: Return structured result
    res.json({
      success: true,
      referenceNumber,
      extractedFrom: path.basename(latestPdfPath),
      data: resultJson
    });

  } catch (error) {
    console.error('PDF Extraction Error:', error.message);

    if (error.response) {
      try {
        const errMsg = await streamToString(error.response.data);
        return res.status(500).json({ error: 'Nutrient.io API error', details: errMsg });
      } catch {
        return res.status(500).json({ error: 'Failed to process PDF', details: error.message });
      }
    }

    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

module.exports = router;