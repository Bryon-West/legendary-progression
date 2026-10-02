---
name: Progression scope
description: User-requested boundary for recommendation features in the hypertrophy tracker.
---

The user explicitly requires “THIS IS AN UPDATE, NOT A REBUILD,” “Completed workout data is historical truth,” and “COMPLETED PERFORMANCE != FUTURE PRESCRIPTION.” Preserve existing users, exercise history, completed performance, mesocycles, and the Create Mesocycle layout.

**Why:** the user's V2.2 specification explicitly overrides conflicting V2.1 behavior without authorizing replacement of the existing product or its data.

**How to apply:** keep historical performance independent of forecasts. Never apply future prescriptions or accepted structural changes to completed records. Calibration uses the configured week RIR, not a fixed 3 RIR.

## Structural changes and recovery

Let users modify today's structure without asking after each change whether it is permanent. Only the consolidated Finish Workout decision applies those changes to future uncompleted programming. This includes replacements made before any sets are completed.

**Why:** V2.2 requires one decision for the whole session; “Today Only” must leave future structure unchanged even when a user removed or replaced an exercise.

**How to apply:** stage edits in the active session. Temporary recovery adjustments must not overwrite normal strength baselines or masquerade as structural edits. A separately confirmed persistent recovery-volume choice must survive acceptance of other structural changes. Never infer permission for aggressive automatic deloads or permanent reductions from one readiness answer.

## Lifecycle and destructive-action scope

V2.3A updates the existing app; never reset or drop PostgreSQL as implementation or verification. Plan deletion must preserve completed workout evidence and valid historical baseline sources. RESET TRAINING DATA is a separate, intentionally destructive, selected-profile operation requiring the exact typed confirmation RESET.

**Why:** the user explicitly prohibited database resets and completed-history deletion during implementation, while requesting a protected training-data reset for end users.

**How to apply:** use isolated synthetic profiles for destructive verification. Never interpret a request to implement the reset button as permission to reset the creator's existing training data. Preserve profile settings and the exercise library, and never clear another profile's data.