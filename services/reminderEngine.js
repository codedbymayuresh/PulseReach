const {
  generateCommunication,
  donorFor,
  pauseStatus,
  createFallbackMessage
} = require('./communicationEngine');

const Communication =
  require('../models/Communication');


async function isEligible(participant) {
  if (
    !participant.communicationConsent ||
    participant.confirmationStatus === 'Declined' ||
    participant.attendanceStatus === 'Attended'
  ) {
    return false;
  }

  const donor =
    await donorFor(participant);

  if (
    pauseStatus(donor).active
  ) {
    return false;
  }

  return true;
}


function urgencyFor(
  participant,
  drive
) {
  const hours =
    Math.max(
      0,
      (new Date(drive.date) - new Date()) / 36e5
    );

  if (
    participant.confirmationStatus === 'Pending'
  ) {
    return hours <= 24
      ? 'Critical'
      : 'High';
  }

  if (hours <= 24) {
    return 'Critical';
  }

  if (
    (participant.reminderEngagement || 0) === 0
  ) {
    return 'High';
  }

  return 'Normal';
}


/**
 * Creates template reminders when Gemini is unavailable.
 *
 * Maximum = 100 reminders per drive.
 *
 * IMPORTANT:
 * These records are marked generatedBy="Template".
 * They are not falsely labelled as Gemini-generated.
 */
async function createDemoFallbackReminders(
  participants,
  drive,
  target = 100
) {
  if (
    !participants ||
    !participants.length ||
    !drive
  ) {
    return [];
  }

  const existingCount =
    await Communication.countDocuments({
      driveId: drive._id
    });

  const remaining =
    Math.max(
      0,
      target - existingCount
    );

  if (remaining === 0) {
    return [];
  }

  const eligibleParticipants = [];

  for (const participant of participants) {
    if (
      await isEligible(participant)
    ) {
      eligibleParticipants.push(
        participant
      );
    }
  }

  if (
    !eligibleParticipants.length
  ) {
    return [];
  }

  const documents = [];

  const stages = [
    'Reminder',
    'Confirmation',
    'Final reminder'
  ];

  for (
    let index = 0;
    index < remaining;
    index++
  ) {
    const participant =
      eligibleParticipants[
        index %
        eligibleParticipants.length
      ];

    const stage =
      stages[
        index % stages.length
      ];

    const message =
      createFallbackMessage(
        participant,
        drive,
        stage
      );

    documents.push({
      driveId: drive._id,

      participantId:
        participant._id,

      stage,

      channel: 'Reminder',

      language:
        participant.preferredLanguage ||
        'English',

      message,

      generatedBy: 'Template',

      consentChecked: true,

      readAt: null,

      readCount: 0,

      engagementRecorded: false
    });
  }

  if (!documents.length) {
    return [];
  }

  return Communication.insertMany(
    documents
  );
}


/**
 * Main intelligent reminder engine.
 *
 * Flow:
 *
 * Gemini available:
 *     Gemini → personalized reminder
 *
 * Gemini quota exhausted:
 *     Gemini → 429
 *             ↓
 *     Template fallback
 *             ↓
 *     Up to 100 reminder records
 */
async function generateIntelligentReminders(
  participants,
  drive
) {
  const results = [];

  let geminiFailures = 0;

  for (
    const participant of participants
  ) {
    const donor =
      await donorFor(participant);

    const pause =
      pauseStatus(donor);

    if (
      !(await isEligible(participant))
    ) {
      const reason =
        !participant.communicationConsent
          ? 'Current-drive communication consent is off.'
          : pause.active
            ? `Post-donation notification pause is active until ${pause.until.toLocaleDateString('en-IN')}.`
            : 'Participant no longer needs a reminder.';

      results.push({
        participant,

        skipped: true,

        reason
      });

      continue;
    }

    let result;

    try {
      result =
        await generateCommunication(
          participant,
          drive,
          {
            purpose: 'reminder'
          }
        );
    } catch (error) {
      geminiFailures += 1;

      console.error(
        `Gemini reminder decision failed for ` +
        `${participant.registrationCode || participant._id}:`,
        error.message
      );

      results.push({
        participant,

        skipped: true,

        reason:
          error.message,

        urgency:
          urgencyFor(
            participant,
            drive
          ),

        generatedBy: 'Gemini',

        error: true,

        quotaError:
          error.status === 429
      });

      continue;
    }

    if (
      result.skipped
    ) {
      results.push({
        participant,

        ...result,

        urgency:
          urgencyFor(
            participant,
            drive
          ),

        skipped: true
      });

      continue;
    }

    const log =
      await Communication.create({
        driveId: drive._id,

        participantId:
          participant._id,

        stage:
          result.stage === 'Confirmation'
            ? 'Confirmation'
            : result.stage,

        channel: 'Reminder',

        language:
          participant.preferredLanguage,

        message:
          result.message,

        generatedBy:
          result.generatedBy,

        consentChecked: true
      });

    results.push({
      participant,

      ...result,

      urgency:
        urgencyFor(
          participant,
          drive
        ),

      skipped: false,

      log
    });
  }


  /**
   * If Gemini failed for one or more participants,
   * make sure the reminder dashboard still has useful
   * notification records.
   *
   * Existing Gemini records are preserved.
   */
  if (geminiFailures > 0) {
    try {
      const fallback =
        await createDemoFallbackReminders(
          participants,
          drive,
          100
        );

      if (
        fallback.length > 0
      ) {
        console.log(
          `Gemini unavailable. Created ` +
          `${fallback.length} Template fallback reminders ` +
          `for drive ${drive._id}.`
        );
      }
    } catch (fallbackError) {
      console.error(
        'Template reminder fallback failed:',
        fallbackError.message
      );
    }
  }

  return results;
}


module.exports = {
  generateIntelligentReminders,

  isEligible,

  urgencyFor,

  createDemoFallbackReminders
};