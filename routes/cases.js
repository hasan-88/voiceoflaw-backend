const express = require('express');
const Case = require('../models/Case');
const auth = require('../middleware/auth');
const router = express.Router();

// Get all cases for authenticated user
router.get('/', auth, async (req, res) => {
  try {
    const cases = await Case.find({ userId: req.user.userId });
    res.json(cases);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get single case
router.get('/:id', auth, async (req, res) => {
  try {
    const caseItem = await Case.findOne({ 
      _id: req.params.id, 
      userId: req.user.userId 
    });
    
    if (!caseItem) {
      return res.status(404).json({ message: 'Case not found' });
    }
    
    res.json(caseItem);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Create new case
router.post('/', auth, async (req, res) => {
  try {
    const caseData = {
      ...req.body,
      userId: req.user.userId
    };
    
    const newCase = new Case(caseData);
    const savedCase = await newCase.save();
    res.status(201).json(savedCase);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ message: 'Case number already exists' });
    }
    res.status(400).json({ message: error.message });
  }
});

// Update case
router.put('/:id', auth, async (req, res) => {
  try {
    const caseItem = await Case.findOneAndUpdate(
      { _id: req.params.id, userId: req.user.userId },
      req.body,
      { new: true, runValidators: true }
    );
    
    if (!caseItem) {
      return res.status(404).json({ message: 'Case not found' });
    }
    
    res.json(caseItem);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Delete case
router.delete('/:id', auth, async (req, res) => {
  try {
    const caseItem = await Case.findOneAndDelete({ 
      _id: req.params.id, 
      userId: req.user.userId 
    });
    
    if (!caseItem) {
      return res.status(404).json({ message: 'Case not found' });
    }
    
    res.json({ message: 'Case deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;