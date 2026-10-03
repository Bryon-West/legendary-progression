---
name: V2.4 account ownership and scope
description: User-set boundaries for account ownership, data preservation, and auth scope in Hypertrophy Tracker.
---

- Keep both legacy profiles unassigned until the user explicitly approves an ownership decision.
- Give each new account its own private profile; never claim a legacy profile during signup.
- This Clerk instance rejects first/last name fields during password signup; submit only email and password, then save the retained Name value to the account-owned training profile after authentication and before onboarding.
- Preserve existing data with additive changes; do not force schema changes that truncate or delete records.
- Do not publish, reset the database, add payments, or add social login without explicit approval.
- Use the supplied gold dragon image unchanged on the welcome screen.

**Why:** The user set these boundaries for V2.4 account work, and the real Clerk instance rejects `first_name` although the installed SDK types expose name fields conditionally on instance settings.

**How to apply:** Keep these limits in force for follow-up changes, preserve legacy workout history and profile preferences, and keep the name write after successful session finalization but before route navigation.