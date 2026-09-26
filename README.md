# PulseReach — Commits 4–7 combined

This version consolidates four development milestones into one working pass:

- **Drive management** — create, view, change status, delete, and isolate drives by organizer.
- **Participant management** — registrations, confirmation state, participant list, and organizer controls.
- **Consent management** — current-drive consent and future-drive consent are stored separately; withdrawing current-drive consent disables reminder engagement.
- **Registration + confirmation** — mobile-friendly public registration, automatic registration confirmation, unique registration code, public status page, confirmation/decline link, and QR sharing.
- **Attendance management** — organizers can mark each participant Attended, Absent, or Not Marked and see predicted vs actual attendance.

## Stack

- Node.js + Express
- EJS server-rendered UI
- MongoDB + Mongoose
- Express sessions
- bcryptjs for organizer passwords
- QRCode for registration QR generation

## Run

```bash
npm install
npm run init   # optional demo data
npm start
```

Open `http://localhost:8080`.

## Demo organizer

After `npm run init`:

- Email: `organizer@pulsereach.local`
- Password: `PulseReach@123`

## Important product boundary

PulseReach only handles mobilisation and administrative coordination. It does not determine medical eligibility, perform clinical screening, diagnose, manage blood collection, manage inventory, or store medical records.
