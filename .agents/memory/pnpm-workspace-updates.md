---
name: pnpm workspace updates
description: Dependency-update behavior and lockfile hygiene in this pnpm monorepo.
---

In this pnpm monorepo, a recursive update targeting an exact transitive version may leave that package unchanged while relocking an unrelated peer dependency. If so, use a narrowly parent-scoped override rather than broad resolution.

**Why:** Repeated dependency updates left the intended package unchanged but introduced unrelated `tsx` lockfile churn.

**How to apply:** Respect the workspace release-age policy, inspect the full lockfile diff, use a scoped override only when normal resolution cannot select the fix, then verify the active installed tree and keep only requested package changes.