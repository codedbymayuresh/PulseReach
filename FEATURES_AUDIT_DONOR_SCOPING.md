# Commit 10 — Drive-Scoped Donor Audit Trail

## Purpose

The organizer audit trail is now focused on donor activity belonging to blood donation camps created by the currently logged-in organizer.

## Access rule

- A user can see audit activity only for drives where `Drive.createdBy === req.session.organizerId`.
- Selecting a drive is additionally validated against that same owned-drive list.
- Donor activity from another organizer's drive is never included in the query.
- Managers/organizers who did not create a drive cannot use the audit page to inspect that drive's donor audit events.

## What appears

Only drive-bound donor events are shown, including events such as:

- Donor registration
- Confirmation changes
- Consent changes
- Notification read/engagement
- Attendance changes
- Donation recorded

Organizer login/account events are intentionally excluded from this donor audit view.

## Existing audit data

`AuditLog.donorId` is now stored for new donor-related audit events. The audit page also resolves donor identity from existing Participant, Donation, and Communication records when older audit rows do not yet have `donorId`, so existing data remains visible when possible.
