# PulseReach

Intelligent Blood Donation Mobilisation & Turnout Platform.

## Next commit: dynamic initialization

This version removes prototype seed data from `server.js`. Initialization data now lives in `init.js` and is loaded explicitly.

### Run

```bash
npm install
npm run init
npm start
```

Open `http://localhost:8080`.

### Database

The prototype uses MongoDB through Mongoose.

Default local connection:

```text
mongodb://127.0.0.1:27017/pulsereach
```

You can override it with `MONGO_URI`.

### Initialization

`init.js` contains the demo drive and demo participant data used to populate a fresh local database. It is idempotent for the demo drive: running `npm run init` again will not duplicate that drive.

The application itself does **not** automatically seed data when the server starts. If the database is empty, the dashboard shows an empty state and the organizer can create a real drive through the UI.

### First real drive

1. Start MongoDB.
2. Start PulseReach with `npm start`.
3. Open `/dashboard`.
4. Click **Create drive**.
5. Enter the drive name, date/time, venue, target donor count, official screening information link, and description.
6. Create the drive.
7. Use the generated QR code/registration link to collect participants.

Medical eligibility, clinical screening, blood collection, inventory and medical records are outside the platform boundary.
