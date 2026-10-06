---
name: GitHub checkpoint authentication
description: Distinguish the project GitHub connection notice from working Git CLI access when creating stable checkpoints.
---

A Replit GitHub provider connection notice did not guarantee usable Git CLI credentials in this workspace. The integration appeared authorized, but its status remained `not_added`, the connection lookup returned no credentials, and an HTTPS push was rejected as unauthenticated. The internal `gitsafe-backup` remote is separate from GitHub.

**Why:** A local commit/tag and Replit's internal backup are not proof that the corresponding GitHub refs were pushed.

**How to apply:** Before claiming a checkpoint is on GitHub, inspect the configured GitHub remote, check remote refs with `git ls-remote`, and verify the branch and tag hashes after pushing. Keep uploaded instruction files out of the checkpoint unless the user asks to include them.
