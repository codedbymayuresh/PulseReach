# PulseReach — Commit 5: Communication Engine

PulseReach now adds a consent-aware communication engine for blood-drive mobilisation.

## What this commit adds

- Communication Centre for organisers.
- Personalised message generation using participant context:
  - preferred language
  - communication stage
  - confirmation status
  - previous response behaviour
  - reminder engagement
  - previous participation
  - time remaining before the drive
- Gemini-powered generation when `GEMINI_API_KEY` is configured.
- Safe local template fallback when Gemini is unavailable.
- Current-drive consent is checked before a message can be generated.
- Communication previews are stored in MongoDB with stage, language, source, and timestamp.
- Drive-level and participant-level preview generation.
- No messages are actually sent in this prototype; this commit prepares the communication layer for future SMS/WhatsApp/email integrations.

## Run

```bash
npm install
npm start
```

Open `http://localhost:8080` and sign in as an organiser.

## Gemini API setup

Gemini is **optional for running the application**, but recommended for the hackathon demo because it enables the personalised AI message generation. Without a key, PulseReach automatically falls back to local templates.

1. Open Google AI Studio and create an API key from the API Keys page.
2. Create a local `.env` file in the project root by copying `.env.example`.
3. Put the key in `.env`:

```env
GEMINI_API_KEY=your_key_here
GEMINI_MODEL=gemini-3.6-flash
SESSION_SECRET=replace-with-a-long-random-string
MONGO_URI=mongodb://127.0.0.1:27017/pulsereach
```

4. Restart the server:

```bash
npm start
```

5. Open **Communication** from the organiser dashboard and generate a preview.

**Never commit `.env` or expose the API key in frontend JavaScript.** The key is used only by the server-side communication engine.

## Product boundary

PulseReach handles mobilisation and administrative coordination only. It does not determine medical eligibility, perform clinical screening, diagnose, manage blood collection, manage blood inventory, or store medical records.
