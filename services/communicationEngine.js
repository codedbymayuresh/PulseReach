const Communication = require('../models/Communication');
const Donor = require('../models/Donor');

const languageNames = {
  English: 'English',
  Hindi: 'Hindi',
  Marathi: 'Marathi'
};

function stageFor(participant, drive) {
  const now = new Date();
  const eventDate = new Date(drive.date);
  const hours = (eventDate - now) / 36e5;

  if (participant.confirmationStatus === 'Pending') {
    return hours <= 24 ? 'Final reminder' : 'Confirmation';
  }

  if (participant.confirmationStatus === 'Declined') {
    return 'Follow-up';
  }

  if (hours <= 24) {
    return 'Final reminder';
  }

  return 'Reminder';
}

async function donorFor(participant) {
  if (
    participant.donorId &&
    typeof participant.donorId === 'object' &&
    participant.donorId._id
  ) {
    return participant.donorId;
  }

  if (participant.donorId) {
    return Donor.findById(participant.donorId);
  }

  return Donor.findOne({ phone: participant.phone });
}

function pauseStatus(donor, now = new Date()) {
  const until = donor?.notificationPausedUntil
    ? new Date(donor.notificationPausedUntil)
    : null;

  const active = Boolean(until && until > now);

  return {
    active,
    until,
    remainingDays: active
      ? Math.max(1, Math.ceil((until - now) / 86400000))
      : 0,
    pauseDays: Number(donor?.notificationPauseDays || 0),
    genderRule:
      donor?.gender === 'Female'
        ? '120 days after a recorded donation'
        : '90 days after a recorded donation'
  };
}

function contextFor(participant, drive, stage, donor, purpose) {
  const hours = Math.max(
    0,
    Math.round((new Date(drive.date) - new Date()) / 36e5)
  );

  const pause = pauseStatus(donor);

  return {
    participantName: participant.name,

    preferredLanguage:
      languageNames[participant.preferredLanguage] || 'English',

    stage,
    purpose,

    confirmationStatus: participant.confirmationStatus,

    previousResponse:
      participant.responseScore > 0
        ? 'Positive'
        : participant.responseScore < 0
          ? 'Negative'
          : 'No recent response',

    previousParticipation: participant.previousParticipation,

    reminderEngagement: participant.reminderEngagement,

    hoursRemaining: hours,

    driveName: drive.name,

    date: new Date(drive.date).toLocaleString('en-IN'),

    venue: drive.venue,

    notificationPolicy: {
      paused: pause.active,
      pausedUntil: pause.until ? pause.until.toISOString() : null,
      remainingDays: pause.remainingDays,
      rule: pause.genderRule
    }
  };
}

function parseGeminiJson(data) {
  const raw = data?.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || '')
    .join('')
    .trim();

  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch (_) {
    const match = raw.match(/\{[\s\S]*\}/);

    if (!match) return null;

    return JSON.parse(match[0]);
  }
}

/**
 * Gemini communication generator.
 *
 * This function is intentionally strict:
 * Gemini is used when available.
 * If Gemini fails, the caller can use the Template fallback.
 */
async function generateWithGemini(context) {
  if (!process.env.GEMINI_API_KEY) {
    const error = new Error(
      'GEMINI_API_KEY is not configured.'
    );

    error.status = 401;

    throw error;
  }

  const model =
    process.env.GEMINI_MODEL ||
    'gemini-3.5-flash-lite';

  const endpoint =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${encodeURIComponent(model)}:generateContent`;

  const prompt = `You are the PulseReach donor communication decision engine.

Your job is to decide whether ONE administrative blood-drive notification should be generated for this donor, and if yes, write the notification.

HARD RULES:

1. If notificationPolicy.paused is true, set shouldSend=false.
2. Female donors are paused for 120 days after a recorded donation.
3. Male and Other donors are paused for 90 days after a recorded donation.
4. Never override the notification pause.
5. Current-drive communication consent is mandatory.
6. For purpose=registration, a consented donor should receive the registration acknowledgement unless the pause blocks it.
7. For reminder/preview purposes, send only when useful based on confirmation status, time remaining, previous response, and reminder engagement.
8. Do not spam.
9. Never provide medical advice.
10. Never assess medical eligibility.
11. Never diagnose or discuss medical conditions.
12. Do not mention blood type or medical status.
13. Use the preferred language exactly as supplied.
14. Keep the message short, respectful, and non-coercive.

Return ONLY valid JSON:

{
  "shouldSend": true,
  "reason": "short reason",
  "message": "short notification text"
}

Context:
${JSON.stringify(context, null, 2)}`;

  let response;

  try {
    response = await fetch(endpoint, {
      method: 'POST',

      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': process.env.GEMINI_API_KEY
      },

      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: prompt
              }
            ]
          }
        ],

        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 300,

          responseMimeType: 'application/json',

          responseSchema: {
            type: 'OBJECT',

            properties: {
              shouldSend: {
                type: 'BOOLEAN'
              },

              reason: {
                type: 'STRING'
              },

              message: {
                type: 'STRING'
              }
            },

            required: [
              'shouldSend',
              'reason',
              'message'
            ]
          }
        }
      })
    });
  } catch (networkError) {
    const error = new Error(
      `Gemini network request failed: ${networkError.message}`
    );

    error.status = 503;

    throw error;
  }

  let data;

  try {
    data = await response.json();
  } catch (_) {
    const error = new Error(
      `Gemini returned a non-JSON HTTP response (${response.status}).`
    );

    error.status = response.status;

    throw error;
  }

  if (!response.ok) {
    const apiMessage =
      data?.error?.message ||
      `Gemini API returned ${response.status}`;

    const error = new Error(apiMessage);

    error.status = response.status;

    throw error;
  }

  const decision = parseGeminiJson(data);

  if (
    !decision ||
    typeof decision.shouldSend !== 'boolean'
  ) {
    const finishReason =
      data?.candidates?.[0]?.finishReason ||
      'unknown';

    const blockReason =
      data?.promptFeedback?.blockReason ||
      'none';

    const error = new Error(
      `Gemini returned an invalid notification decision ` +
      `(finishReason: ${finishReason}, blockReason: ${blockReason}).`
    );

    error.status = 502;

    throw error;
  }

  const reason = String(
    decision.reason ||
      (
        decision.shouldSend
          ? 'Gemini approved this notification.'
          : 'Gemini decided not to send this notification.'
      )
  ).trim();

  const message = String(
    decision.message || ''
  ).trim();

  if (decision.shouldSend && !message) {
    const error = new Error(
      'Gemini approved the notification but returned an empty message.'
    );

    error.status = 502;

    throw error;
  }

  return {
    shouldSend: decision.shouldSend,
    reason,
    message
  };
}


/**
 * Template fallback.
 *
 * This is used ONLY when Gemini is unavailable.
 * It is deliberately marked as Template rather than Gemini.
 */
function createFallbackMessage(
  participant,
  drive,
  stage = 'Reminder'
) {
  const name = participant.name || 'Donor';

  const language =
    participant.preferredLanguage || 'English';

  const driveName = drive.name || 'Blood Donation Drive';

  const date = drive.date
    ? new Date(drive.date).toLocaleDateString('en-IN')
    : '';

  const venue = drive.venue || '';

  if (language === 'Hindi') {
    if (stage === 'Registration') {
      return `Namaste ${name}, ${driveName} ke liye aapka registration successfully confirm ho gaya hai. Date: ${date}. Venue: ${venue}.`;
    }

    return `Namaste ${name}, ${driveName} ke liye aapka reminder hai. Date: ${date}. Venue: ${venue}. Aapke participation ke liye dhanyavaad.`;
  }

  if (language === 'Marathi') {
    if (stage === 'Registration') {
      return `Namaskar ${name}, ${driveName} sathi tumchi registration successfully confirm zali aahe. Date: ${date}. Venue: ${venue}.`;
    }

    return `Namaskar ${name}, ${driveName} sathi ha ek reminder aahe. Date: ${date}. Venue: ${venue}. Tumchya participation sathi dhanyavaad.`;
  }

  if (stage === 'Registration') {
    return `Hi ${name}, your registration for ${driveName} has been successfully confirmed. Date: ${date}. Venue: ${venue}. Thank you for participating.`;
  }

  if (stage === 'Final reminder') {
    return `Hi ${name}, this is a final reminder for ${driveName} on ${date} at ${venue}. Thank you for registering and supporting the blood donation initiative.`;
  }

  return `Hi ${name}, this is a reminder for ${driveName} on ${date} at ${venue}. Thank you for registering and supporting the blood donation initiative.`;
}


/**
 * Server-side communication policy.
 *
 * Consent and post-donation pause are enforced BEFORE Gemini.
 */
async function generateCommunication(
  participant,
  drive,
  options = {}
) {
  const stage =
    options.stage ||
    stageFor(participant, drive);

  const purpose =
    options.purpose ||
    'reminder';

  const donor =
    await donorFor(participant);

  const pause =
    pauseStatus(donor);

  if (!participant.communicationConsent) {
    return {
      skipped: true,

      reason:
        'Participant has withdrawn current-drive communication consent.',

      stage,

      context: null
    };
  }

  if (pause.active) {
    return {
      skipped: true,

      reason:
        `Donor is in the post-donation ` +
        `${pause.pauseDays || 90}-day notification pause ` +
        `until ${pause.until.toLocaleDateString('en-IN')}.`,

      stage,

      context: null,

      notificationPolicy: pause
    };
  }

  const context =
    contextFor(
      participant,
      drive,
      stage,
      donor,
      purpose
    );

  const decision =
    await generateWithGemini(context);

  if (!decision.shouldSend) {
    return {
      skipped: true,

      reason: decision.reason,

      stage,

      context,

      generatedBy: 'Gemini',

      decision
    };
  }

  if (!decision.message) {
    throw new Error(
      'Gemini decided to send but returned an empty message.'
    );
  }

  return {
    skipped: false,

    stage,

    context,

    message: decision.message,

    generatedBy: 'Gemini',

    decision,

    notificationPolicy: pause
  };
}


/**
 * Creates a normal preview.
 */
async function createPreview(
  participant,
  drive
) {
  const result =
    await generateCommunication(
      participant,
      drive,
      {
        purpose: 'preview'
      }
    );

  if (result.skipped) {
    return result;
  }

  const log =
    await Communication.create({
      driveId: drive._id,

      participantId: participant._id,

      stage: result.stage,

      channel: 'Reminder',

      language:
        participant.preferredLanguage,

      message: result.message,

      generatedBy: 'Gemini',

      consentChecked: true
    });

  return {
    ...result,
    log
  };
}


/**
 * Registration notification.
 *
 * Gemini first.
 * If Gemini is unavailable, a clearly marked Template
 * notification is saved so the donor dashboard still works.
 */
async function createRegistrationNotification(
  participant,
  drive
) {
  const result =
    await generateCommunication(
      participant,
      drive,
      {
        purpose: 'registration',
        stage: 'Registration'
      }
    );

  if (result.skipped) {
    return result;
  }

  const log =
    await Communication.create({
      driveId: drive._id,

      participantId: participant._id,

      stage: 'Registration',

      channel: 'Reminder',

      language:
        participant.preferredLanguage,

      message: result.message,

      generatedBy: 'Gemini',

      consentChecked: true
    });

  return {
    ...result,
    log
  };
}


/**
 * Registration fallback used when Gemini quota is exhausted.
 */
async function createRegistrationFallbackNotification(
  participant,
  drive,
  reason = 'Gemini unavailable'
) {
  const donor =
    await donorFor(participant);

  const pause =
    pauseStatus(donor);

  if (!participant.communicationConsent) {
    return {
      skipped: true,

      reason:
        'Participant has withdrawn current-drive communication consent.'
    };
  }

  if (pause.active) {
    return {
      skipped: true,

      reason:
        `Post-donation notification pause is active until ` +
        `${pause.until.toLocaleDateString('en-IN')}.`
    };
  }

  const message =
    createFallbackMessage(
      participant,
      drive,
      'Registration'
    );

  const log =
    await Communication.create({
      driveId: drive._id,

      participantId: participant._id,

      stage: 'Registration',

      channel: 'Reminder',

      language:
        participant.preferredLanguage || 'English',

      message,

      generatedBy: 'Template',

      consentChecked: true
    });

  return {
    skipped: false,

    stage: 'Registration',

    message,

    generatedBy: 'Template',

    fallback: true,

    fallbackReason: reason,

    log
  };
}


module.exports = {
  generateCommunication,

  createPreview,

  createRegistrationNotification,

  createRegistrationFallbackNotification,

  createFallbackMessage,

  stageFor,

  pauseStatus,

  donorFor
};