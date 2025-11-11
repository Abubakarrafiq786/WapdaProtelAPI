const mongoose = require('mongoose');
const AutoIncrement = require('mongoose-sequence')(mongoose);

const PersonDetailSchema = new mongoose.Schema({
  UserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User', // assuming you have a User model
    required: true,
  },
  ReferanceNo: {
    type: String,
    required: [true, 'Please add a reference number'],
    minlength: 15,
  },
  CustomerNo: {
    type: String,
    minlength: 11,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// Auto-increment the Id field
PersonDetailSchema.plugin(AutoIncrement, { inc_field: 'Id' });

module.exports = mongoose.model('PersonDetail', PersonDetailSchema);