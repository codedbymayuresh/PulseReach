const mongoose = require('mongoose');

const communicationSchema = new mongoose.Schema({
  driveId: { type: mongoose.Schema.Types.ObjectId, ref: 'Drive', required: true, index: true },
  participantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Participant', required: true, index: true },
  stage: { type: String, enum: ['Registration', 'Confirmation', 'Reminder', 'Final reminder', 'Follow-up'], required: true },
  channel: { type: String, enum: ['Preview', 'Reminder'], default: 'Preview' },
  language: { type: String, required: true },
  message: { type: String, required: true },
  generatedBy: { type: String, enum: ['Gemini', 'Template'], required: true },
  consentChecked: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Communication', communicationSchema);
