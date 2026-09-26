const { generateCommunication, donorFor, pauseStatus } = require('./communicationEngine');
const Communication = require('../models/Communication');

async function isEligible(participant) {
  if (!participant.communicationConsent || participant.confirmationStatus === 'Declined' || participant.attendanceStatus === 'Attended') return false;
  const donor = await donorFor(participant);
  if (pauseStatus(donor).active) return false;
  return true;
}

function urgencyFor(participant, drive) {
  const hours = Math.max(0, (new Date(drive.date) - new Date()) / 36e5);
  if (participant.confirmationStatus === 'Pending') return hours <= 24 ? 'Critical' : 'High';
  if (hours <= 24) return 'Critical';
  if ((participant.reminderEngagement || 0) === 0) return 'High';
  return 'Normal';
}

async function generateIntelligentReminders(participants, drive) {
  const results = [];
  for (const participant of participants) {
    const donor = await donorFor(participant);
    const pause = pauseStatus(donor);

    if (!(await isEligible(participant))) {
      const reason = !participant.communicationConsent
        ? 'Current-drive communication consent is off.'
        : pause.active
          ? `Post-donation notification pause is active until ${pause.until.toLocaleDateString('en-IN')}.`
          : 'Participant no longer needs a reminder.';
      results.push({ participant, skipped: true, reason });
      continue;
    }

    const result = await generateCommunication(participant, drive, { purpose: 'reminder' });
    if (result.skipped) {
      results.push({ participant, ...result, urgency: urgencyFor(participant, drive), skipped: true });
      continue;
    }

    const log = await Communication.create({
      driveId: drive._id,
      participantId: participant._id,
      stage: result.stage === 'Confirmation' ? 'Confirmation' : result.stage,
      channel: 'Reminder',
      language: participant.preferredLanguage,
      message: result.message,
      generatedBy: result.generatedBy,
      consentChecked: true
    });
    results.push({ participant, ...result, urgency: urgencyFor(participant, drive), skipped: false, log });
  }
  return results;
}

module.exports = { generateIntelligentReminders, isEligible, urgencyFor };
