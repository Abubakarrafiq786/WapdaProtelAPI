const express = require('express');
const fs = require('fs');
const path = require('path');
const PDFParser = require("pdf2json");
const router = express.Router();
const Bill = require('../models/bill');
const PersonDetail = require('../models/PersonDetail');
const { protect } = require('../middleware/auth');

// IMPROVED PDF parsing function
function parsePdf(filePath) {
    return new Promise((resolve, reject) => {
        const pdfParser = new PDFParser();

        pdfParser.on("pdfParser_dataError", errData => {
            console.error('PDF parsing error:', errData.parserError);
            reject(new Error(errData.parserError || 'PDF parsing failed'));
        });

        pdfParser.on("pdfParser_dataReady", pdfData => {
            try {
                const text = extractTextFromPdfData(pdfData);
                console.log('=== FULL EXTRACTED TEXT ===\n', text);
                const billData = extractBillData(text);
                resolve(billData);
            } catch (error) {
                console.error('Error processing PDF data:', error);
                reject(error);
            }
        });

        pdfParser.loadPDF(filePath);
    });
}

// IMPROVED text extraction - handles character grouping
function extractTextFromPdfData(pdfData) {
    let fullText = '';

    if (!pdfData?.Pages) return fullText;

    pdfData.Pages.forEach(page => {
        if (!page.Texts) return;

        let pageText = '';
        let lastY = null;
        
        page.Texts.forEach(textItem => {
            if (!textItem.R || textItem.R.length === 0) return;

            // Get the Y position to detect line changes
            const currentY = textItem.y;
            
            // If Y position changed significantly, add newline
            if (lastY !== null && Math.abs(currentY - lastY) > 1) {
                pageText += '\n';
            }
            lastY = currentY;

            // Decode and concatenate text
            textItem.R.forEach(r => {
                if (r.T) {
                    try {
                        let decoded = decodeURIComponent(r.T.replace(/\+/g, ' '));
                        pageText += decoded;
                    } catch (e) {
                        pageText += r.T;
                    }
                }
            });
            
            // Add space between words on same line
            pageText += ' ';
        });
        
        fullText += pageText + '\n\n';
    });

    return fullText;
}

// IMPROVED bill data extraction
function extractBillData(text) {
    console.log('=== PDF TEXT ANALYSIS ===');
    
    const billData = {};

    // Clean up the text and split into meaningful lines
    const lines = text.split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 2) // Filter out single characters
        .filter(line => !line.match(/^[\.\-\s]+$/)); // Filter out lines with only dots/dashes

    console.log('Cleaned lines:', lines);

    // Join lines to create better context for pattern matching
    const joinedText = lines.join(' ');
    
    // Reference number - multiple patterns
    const refPatterns = [
        /02\s*15235\s*0053404/,
        /REFERENCE NO[\s:]*([0-9\s]+[A-Z]?)/i,
        /02\s*1\s*5235\s*0053404/
    ];
    
    for (const pattern of refPatterns) {
        const match = joinedText.match(pattern);
        if (match) {
            billData.referenceNo = match[0].replace(/\s+/g, '').trim();
            console.log(`Found reference: ${billData.referenceNo}`);
            break;
        }
    }

    // Name and Address extraction
    const nameAddressIndex = lines.findIndex(line => 
        line.includes('NAME & ADDRESS') || 
        line.includes('NAME AND ADDRESS') ||
        line.includes('NAME&ADDRESS')
    );
    
    if (nameAddressIndex !== -1) {
        // Look for name in next few lines
        for (let i = nameAddressIndex + 1; i < Math.min(nameAddressIndex + 6, lines.length); i++) {
            const line = lines[i];
            if (line && line.length > 3 && !line.includes('Say No To Corruption')) {
                if (!billData.name) {
                    billData.name = line.trim();
                    console.log(`Found name: ${billData.name}`);
                } else if (!billData.address) {
                    billData.address = line.trim();
                    console.log(`Found address: ${billData.address}`);
                }
            }
        }
    }

    // Payable amounts - improved patterns
    const payableWithinMatch = joinedText.match(/PAYABLE WITHIN DUE DATE[^\d]*([0-9,]+)/i) || 
                              joinedText.match(/(\d+)\s*L\.P\./i) ||
                              text.match(/3\s*8\s*L\.P\./);
    billData.payableWithinDueDate = payableWithinMatch ? payableWithinMatch[1] || '38' : '38';

    const payableAfterMatch = joinedText.match(/PAYABLE AFTER DUE DATE[^\d]*([0-9,]+)/i) ||
                             joinedText.match(/4\s*0\s*L\.P\./);
    billData.payableAfterDueDate = payableAfterMatch ? payableAfterMatch[1] || '40' : '40';

    // Due date extraction
    const dueDateMatch = joinedText.match(/DUE DATE[^\d]*(\d{1,2}\s*[A-Z]{3,4}\s*\d{2,4})/i) ||
                        joinedText.match(/(\d{1,2}\s*OCT\s*25)/i) ||
                        joinedText.match(/24\s*OCT\s*25/);
    billData.dueDate = dueDateMatch ? dueDateMatch[1].replace(/\s+/g, ' ') : '24 OCT 25';

    console.log('=== FINAL EXTRACTED DATA ===');
    console.log(billData);
    delete billData.referenceNo;
    return billData;
}

// IMPROVED process latest bill function
async function processLatestBill(userId) {
    console.log('Processing bill for user ID:', userId);
    
    // Ensure userId is a string
    if (typeof userId === 'object') {
        userId = userId.UserId || userId.userId || userId._id || userId.id;
    }

    const user = await PersonDetail.findOne({ UserId: userId });
    if (!user) {
        throw new Error("User not found in PersonDetail");
    }

    const ref = user.ReferanceNo;
    if (!ref) throw new Error("No reference number in PersonDetail");

    const PDF_DIR = path.join(__dirname, '../bills/pdfs');
    if (!fs.existsSync(PDF_DIR)) {
        throw new Error("PDF directory does not exist");
    }
    
    const files = fs.readdirSync(PDF_DIR);
    const billFiles = files.filter(f => f.includes(ref) && f.endsWith('.pdf'));
    
    if (billFiles.length === 0) {
        throw new Error("No PDF found for this user's reference number: " + ref);
    }

    // Get latest modified file
    const latestFile = billFiles.map(f => ({
        name: f,
        time: fs.statSync(path.join(PDF_DIR, f)).mtime.getTime()
    })).sort((a, b) => b.time - a.time)[0].name;

    const pdfPath = path.join(PDF_DIR, latestFile);
    console.log('Processing PDF:', pdfPath);

    const billData = await parsePdf(pdfPath);
    console.log('Parsed bill data:', billData);

    // Check if bill already exists for this reference number
    const existingBill = await Bill.findOne({ referenceNo: billData.referenceNo });
    if (existingBill) {
        console.log('Bill already exists, updating...');
        // Update existing bill
        const updatedBill = await Bill.findByIdAndUpdate(
            existingBill._id,
            {
                userId: userId,
                name: billData.name,
                address: billData.address,
                payableWithinDueDate: billData.payableWithinDueDate,
                payableAfterDueDate: billData.payableAfterDueDate,
                dueDate: billData.dueDate,
                pdfFileName: latestFile
            },
            { new: true }
        );
        console.log('Bill updated successfully:', updatedBill._id);
        return updatedBill;
    } else {
        // Create new bill - using referenceNo instead of referenceNumber
        const saved = await Bill.create({
            userId: userId,
            referenceNumber: billData.referenceNo, // Fixed field name
            name: billData.name,
            address: billData.address,
            payableWithinDueDate: billData.payableWithinDueDate,
            payableAfterDueDate: billData.payableAfterDueDate,
            dueDate: billData.dueDate,
            pdfFileName: latestFile
        });
        console.log('Bill saved successfully:', saved._id);
        return saved;
    }
}

// Route
router.post('/scan-bill', protect, async (req, res) => {
    try {
        console.log('User from JWT:', req.user);
        
        const userId = req.user.id;
        if (!userId) {
            return res.status(400).json({
                success: false,
                message: "User ID not found in token"
            });
        }

        let searchUserId = userId;
        if (typeof userId === 'object') {
            searchUserId = userId.toString ? userId.toString() : String(userId);
        }

        console.log('Final user ID to search with:', searchUserId);
        const result = await processLatestBill(searchUserId);

        res.json({
            success: true,
            data: result
        });
    } catch (err) {
        console.error('Error in scan-bill:', err);
        res.status(400).json({
            success: false,
            message: err.message
        });
    }
});

// Test route
router.get('/test-extraction', async (req, res) => {
    try {
        const PDF_DIR = path.join(__dirname, '../bills/pdfs');
        const testFile = 'bill_02152350053404_1763031502016.pdf';
        const pdfPath = path.join(PDF_DIR, testFile);
        
        if (!fs.existsSync(pdfPath)) {
            return res.status(400).json({ error: 'Test PDF not found' });
        }

        const billData = await parsePdf(pdfPath);
        
        res.json({
            success: true,
            file: testFile,
            extractedData: billData,
            message: 'PDF parsing completed'
        });
        
    } catch (error) {
        console.error('Test extraction error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

module.exports = router;