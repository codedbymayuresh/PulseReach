const { generateCommunication } = require('./communicationEngine');
const Communication = require('../models/Communication');

function isEligible(participant) {
  return Boolean(participant.communicationConsent) && participant.confirmationStatus !== 'Declined' && participant.attendanceStatus !== 'Attended';
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
    if (!isEligible(participant)) {
      results.push({ participant, skipped: true, reason: 'Consent withdrawn or participant no longer needs a reminder.' });
      continue;
    }
    const result = await generateCommunication(participant, drive);
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
