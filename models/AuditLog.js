const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
  actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organizer', default: null },
  donorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Donor', default: null, index: true },
  actorName: { type: String, default: 'System' },
  actorRole: { type: String, default: 'SYSTEM' },
  organization: { type: String, default: '', index: true },
  action: { type: String, required: true, index: true },
  entityType: { type: String, required: true },
  entityId: { type: String, default: '' },
  driveId: { type: mongoose.Schema.Types.ObjectId, ref: 'Drive', default: null, index: true },
  details: { type: mongoose.Schema.Types.Mixed, default: {} },
  ip: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now, index: true }
});

module.exports = mongoose.model('AuditLog', auditLogSchema);
