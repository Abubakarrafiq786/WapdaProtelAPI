const mongoose = require('mongoose');

const billSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    referenceNumber: { 
         type: String,
    required: true,
    unique: true
    },
    name: String,
    address: String,
    payableWithinDueDate: Number,
    payableAfterDueDate: Number,
    dueDate: String,
    pdfFileName: String,
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('Bill', billSchema);