const mongoose = require('mongoose');

const organizerSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  organization: { type: String, required: true, trim: true },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ['OWNER', 'MANAGER', 'VOLUNTEER'], default: 'OWNER' },
  active: { type: Boolean, default: true },
  permissions: { type: [String], default: [] }
}, { timestamps: true });

module.exports = mongoose.model('Organizer', organizerSchema);
