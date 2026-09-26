const Communication = require('../models/Communication');
const Donor = require('../models/Donor');

const languageNames = { English: 'English', Hindi: 'Hindi', Marathi: 'Marathi' };

function stageFor(participant, drive) {
  const now = new Date();
  const eventDate = new Date(drive.date);
  const hours = (eventDate - now) / 36e5;
  if (participant.confirmationStatus === 'Pending') return hours <= 24 ? 'Final reminder' : 'Confirmation';
  if (participant.confirmationStatus === 'Declined') return 'Follow-up';
  if (hours <= 24) return 'Final reminder';
  return 'Reminder';
}

async function donorFor(participant) {
  if (participant.donorId && typeof participant.donorId === 'object' && participant.donorId._id) return participant.donorId;
  if (participant.donorId) return Donor.findById(participant.donorId);
  return Donor.findOne({ phone: participant.phone });
}

function pauseStatus(donor, now = new Date()) {
  const until = donor?.notificationPausedUntil ? new Date(donor.notificationPausedUntil) : null;
  const active = Boolean(until && until > now);
  return {
    active,
    until,
    remainingDays: active ? Math.max(1, Math.ceil((until - now) / 86400000)) : 0,
    pauseDays: Number(donor?.notificationPauseDays || 0),
    genderRule: donor?.gender === 'Female' ? '120 days after a recorded donation' : '90 days after a recorded donation'
  };
}

function contextFor(participant, drive, stage, donor, purpose) {
  const hours = Math.max(0, Math.round((new Date(drive.date) - new Date()) / 36e5));
  const pause = pauseStatus(donor);
  return {
    participantName: participant.name,
    preferredLanguage: languageNames[participant.preferredLanguage] || 'English',
    stage,
    purpose,
    confirmationStatus: participant.confirmationStatus,
    previousResponse: participant.responseScore > 0 ? 'Positive' : participant.responseScore < 0 ? 'Negative' : 'No recent response',
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
  const raw = data?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('').trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_) {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    return JSON.parse(match[0]);
  }
}

async function generateWithGemini(context) {
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not configured.');

  const model = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const prompt = `You are the PulseReach donor communication decision engine.

Your job is to decide whether ONE administrative blood-drive notification should be generated for this donor, and if yes, write the notification.

HARD RULES:
1. If notificationPolicy.paused is true, set shouldSend=false. Never generate or recommend a drive notification during the pause.
2. The pause is a mobilisation rule after a recorded donation: Female donors are paused for 120 days; Male and Other donors are paused for 90 days.
3. Do not override the pause because a drive is urgent, the donor is unconfirmed, or engagement is low.
4. Current-drive communication consent is mandatory. This engine is only called after the application has checked consent.
5. For purpose=registration, a consented donor should receive the registration acknowledgement unless the hard pause rule blocks it.
6. For reminder/preview purposes, send only when a notification is useful based on confirmation status, time remaining, previous response, and reminder engagement. Do not spam.
7. Never provide medical advice, diagnose, assess medical eligibility, or tell the donor whether they can donate. Do not mention blood type or medical status.
8. Use the preferred language exactly as supplied. Keep the message short, respectful, and non-coercive.

Return ONLY valid JSON matching this shape:
{
  "shouldSend": true,
  "reason": "short reason",
  "message": "short notification text"
}

Context:
${JSON.stringify(context, null, 2)}`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 220,
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            shouldSend: { type: 'BOOLEAN' },
            reason: { type: 'STRING' },
            message: { type: 'STRING' }
          },
          required: ['shouldSend', 'reason', 'message']
        }
      }
    })
  });

  if (!response.ok) throw new Error(`Gemini API returned ${response.status}`);
  const decision = parseGeminiJson(await response.json());
  if (!decision || typeof decision.shouldSend !== 'boolean' || !String(decision.reason || '').trim()) {
    throw new Error('Gemini returned an invalid notification decision.');
  }

  return {
    shouldSend: decision.shouldSend,
    reason: String(decision.reason).trim(),
    message: String(decision.message || '').trim()
  };
}

async function generateCommunication(participant, drive, options = {}) {
  const stage = options.stage || stageFor(participant, drive);
  const purpose = options.purpose || 'reminder';
  const donor = await donorFor(participant);
  const pause = pauseStatus(donor);

  // Server-side enforcement is authoritative. Gemini also receives the same policy as context.
  if (!participant.communicationConsent) {
    return { skipped: true, reason: 'Participant has withdrawn current-drive communication consent.', stage, context: null };
  }
  if (pause.active) {
    return {
      skipped: true,
      reason: `Donor is in the post-donation ${pause.pauseDays || 90}-day notification pause until ${pause.until.toLocaleDateString('en-IN')}.`,
      stage,
      context: null,
      notificationPolicy: pause
    };
  }

  const context = contextFor(participant, drive, stage, donor, purpose);
  const decision = await generateWithGemini(context);

  if (!decision.shouldSend) {
    return { skipped: true, reason: decision.reason, stage, context, generatedBy: 'Gemini', decision };
  }
  if (!decision.message) throw new Error('Gemini decided to send but returned an empty message.');

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

async function createPreview(participant, drive) {
  const result = await generateCommunication(participant, drive, { purpose: 'preview' });
  if (result.skipped) return result;

  const log = await Communication.create({
    driveId: drive._id,
    participantId: participant._id,
    stage: result.stage,
    channel: 'Reminder',
    language: participant.preferredLanguage,
    message: result.message,
    generatedBy: result.generatedBy,
    consentChecked: true
  });
  return { ...result, log };
}

async function createRegistrationNotification(participant, drive) {
  const result = await generateCommunication(participant, drive, { purpose: 'registration', stage: 'Registration' });
  if (result.skipped) return result;

  const log = await Communication.create({
    driveId: drive._id,
    participantId: participant._id,
    stage: 'Registration',
    channel: 'Reminder',
    language: participant.preferredLanguage,
    message: result.message,
    generatedBy: 'Gemini',
    consentChecked: true
  });

  return { ...result, log };
}

module.exports = {
  generateCommunication,
  createPreview,
  createRegistrationNotification,
  stageFor,
  pauseStatus,
  donorFor
};
