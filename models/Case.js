const mongoose = require('mongoose');

const caseSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  caseNo: {
    type: String,
    required: true,
    unique: true
  },
  type: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'completed', 'hearing'],
    default: 'pending'
  },
  court: {
    type: String,
    required: true
  },
  nextHearing: {
    type: Date,
    required: true
  },
  partyName: {
    type: String,
    required: true
  },
  respondent: {
    type: String,
    required: true
  },
  lawyer: {
    type: String,
    required: true
  },
  contactNumber: {
    type: String,
    required: true
  },
  advocateContactNumber: {
    type: String
  },
  adversePartyAdvocateName: {
    type: String
  },
  caseYear: {
    type: Number,
    required: true
  },
  onBehalfOf: {
    type: String,
    required: true,
    enum: ['Petitioner', 'Respondent', 'Complainant', 'Accused', 'Plantiff', 'DHR', 'JDR', 'Appellant']
  },
  description: {
    type: String
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Case', caseSchema);