---
name: Verification isolation
description: Preserve original profile preferences as well as workout data during browser verification.
---

Use synthetic test records, and verify the browser's selected profile before any profile-setting interaction. Owning the workout IDs is not sufficient isolation.

**Why:** browser verification using synthetic workouts still changed an original profile's display-unit preference. Full record fingerprints caught this even though stored loads and completed performance were unchanged.

**How to apply:** check profile selection explicitly, include preferences and metadata in preservation verification, and clean up only explicitly recorded synthetic IDs. Do not assume a tester's statement that original data was untouched replaces a preservation check.