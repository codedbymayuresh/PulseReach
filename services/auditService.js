const AuditLog = require('../models/AuditLog');

async function audit(req, { action, entityType, entityId = '', driveId = null, donorId = null, details = {}, actorName = null, actorRole = null, organization = null }) {
  try {
    await AuditLog.create({
      actorId: req.session?.organizerId || null,
      donorId: donorId || null,
      actorName: actorName || req.session?.organizer?.name || 'System',
      actorRole: actorRole || req.session?.organizer?.role || 'SYSTEM',
      organization: organization || req.session?.organizer?.organization || 'SYSTEM',
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
