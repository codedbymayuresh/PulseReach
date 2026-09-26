const AuditLog = require('../models/AuditLog');

async function audit(req, { action, entityType, entityId = '', driveId = null, details = {} }) {
  try {
    await AuditLog.create({
      actorId: req.session?.organizerId || null,
      actorName: req.session?.organizer?.name || 'System',
      actorRole: req.session?.organizer?.role || 'SYSTEM',
      organization: req.session?.organizer?.organization || 'SYSTEM',
      action,
      entityType,
      entityId: String(entityId || ''),
      driveId: driveId || null,
      details,
      ip: req.ip || ''
    });
  } catch (error) {
    console.error('Audit log failed:', error.message);
  }
}

module.exports = { audit };
