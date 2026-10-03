---
name: pnpm workspace updates
description: Dependency-update behavior and lockfile hygiene in this pnpm monorepo.
---

In this pnpm monorepo, the generic package-install callback runs `pnpm add` at the workspace root and fails with `ERR_PNPM_ADDING_TO_ROOT`. Filter package updates to the target artifact, then inspect the lockfile for unrelated transitive updates.

**Why:** A Clerk SDK version check left Clerk unchanged but updated a transitive `tsx` version in the lockfile.

**How to apply:** Use the workspace filter for dependency updates, respect the workspace release-age policy, and retain only lockfile changes required by the requested dependency update.