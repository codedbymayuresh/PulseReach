# Donor Account + Dashboard

## Included
- Donor account creation during drive registration
- Mobile-number + password donor login
- Automatic redirect to `/donor/dashboard` after successful registration
- Donor dashboard with profile, blood group, gender, language, consent status
- Notification pause status and end date after recorded donation
- Previous drive registrations and confirmation status
- Previous donation history with date and location
- E-certificate links
- Upcoming active drives with one-click registration
- Donor logout

## Important behavior
- Donor account authentication is separate from organizer authentication.
- Existing donor accounts must use their existing password when registering for another drive.
- Gemini prediction remains asynchronous and cannot block donor account creation or registration.
- Notification pause is a communication-management setting; it does not determine medical eligibility.
