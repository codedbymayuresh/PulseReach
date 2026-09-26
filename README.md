# PulseReach

Intelligent Blood Donation Mobilisation & Turnout Platform.

## Commit 3: organiser authentication

This version adds organiser registration and session-based login. Organisers must be authenticated to access their dashboard, create drives, view drive details, and manage participants. Donor registration links remain public so participants do not need an account.

### Run

```bash
npm install
npm run init
npm start
```

Open `http://localhost:8080`.

### Database

MongoDB through Mongoose. Default local connection:

```text
mongodb://127.0.0.1:27017/pulsereach
```

Override with `MONGO_URI` if needed.

### Authentication

- `/register-organizer` creates an organiser account.
- `/login` signs an organiser in.
- `/dashboard`, `/drives/new`, `/drives/:id`, `/participants` and participant-management APIs require authentication.
- `/register/:id` remains public for donors.
- Passwords are stored as bcrypt hashes.
- The prototype uses Express sessions. For production, set a strong `SESSION_SECRET` and use a persistent session store.

### Demo initialization

`npm run init` creates one demo organiser and its demo drive/participants if they do not already exist.

Demo credentials:

```text
Email: organizer@pulsereach.local
Password: PulseReach@123
```

You can skip `npm run init` and create your own organiser account from the UI.

Medical eligibility, clinical screening, blood collection, inventory and medical records are outside the platform boundary.
