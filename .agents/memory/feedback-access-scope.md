---
name: Feedback access scope
description: Keep beta feedback moderation separate from general administration and training-data access.
---

Use a persistent role model for beta feedback with one owner and narrowly scoped feedback managers. The owner can grant or revoke manager status; managers can view, update, and remove feedback but must not gain general administration or access to another account's training data. Ordinary users remain testers. Bootstrap ownership only from one explicitly configured Clerk identity; never guess the owner.

**Why:** Feedback moderation needs delegation without broad cross-account privileges.

**How to apply:** Gate feedback endpoints and manager assignment on stored roles, and test account isolation and role persistence independently from bootstrap configuration. After changing the Development bootstrap secret, verify only its presence/count in the API process and restart that workflow so it receives the new value. Development and Production Clerk user stores are separate; never reuse a Development Clerk identity for the Production allowlist. Published deployments receive secrets at publish, and later secret changes require another publish.

Development already has one persistent Owner. The current feedback QA fixture tries to bootstrap a second synthetic Owner, so its manager-permission test stops with 403 before exercising manager assignment.

**Why:** The one-owner rule is intentional; a populated Development database makes the empty-database bootstrap assumption invalid.

**How to apply:** Adapt the QA fixture to use an isolated owner or an isolated database state without logging or exposing Clerk IDs, and never relax the one-owner permission rule to make the test pass.

The Production secret store can show a bootstrap key as present while the deployed value is stale or contains a Development Clerk identity. Feedback requests can successfully create account-linked profiles and still skip bootstrap if the live authenticated ID is not the single configured identity.

**Why:** Production requests use the Production Clerk identity store, and bootstrap compares exact IDs rather than email or profile name.

**How to apply:** Verify secret presence, deployment freshness, and identity-match only as booleans; do not read or print either ID. If the Production value changes, republish only with the user's approval.
