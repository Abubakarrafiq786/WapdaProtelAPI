const express = require('express');
const router = express.Router();
const PersonDetail = require('../models/PersonDetail');
const { protect } = require('../middleware/auth');

// ✅ CREATE
router.post('/', protect, async (req, res) => {
  debugger
  try {
    const newPerson = new PersonDetail({
      UserId: req.user.id, // comes from your middleware
      ReferanceNo: req.body.ReferanceNo,
      CustomerNo: req.body.CustomerNo,
    });

    const saved = await newPerson.save();
    res.status(201).json(saved);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// ✅ GET ALL for current user
router.get('/', protect, async (req, res) => {
  try {
    const persons = await PersonDetail.find();
    res.json(persons);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ✅ GET ONE (must belong to logged-in user)
router.get('/:id', protect, async (req, res) => {
  debugger
  try {
    const person = await PersonDetail.find({
      UserId: req.params.id,
      UserId: req.user.id
    });
    if (!person) return res.status(404).json({ message: 'Not found or unauthorized' });
    res.json(person);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ✅ UPDATE
router.put('/:id', protect, async (req, res) => {
  debugger
  try {
    const updated = await PersonDetail.findOneAndUpdate(
      { UserId: req.params.id, UserId: req.user.id  },
      req.body,
      { new: true, runValidators: true }
    );
    console.log(updated);
    if (!updated) return res.status(404).json({ message: 'Not found or unauthorized' });
    res.json(updated);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// ✅ DELETE
router.delete('/:id', protect, async (req, res) => {
  debugger
  try {
    const deleted = await PersonDetail.findOneAndDelete({
      UserId: req.params.id,
      UserId: req.user.id,
    });
    if (!deleted) return res.status(404).json({ message: 'Not found or unauthorized' });
    res.json({ message: 'Deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
