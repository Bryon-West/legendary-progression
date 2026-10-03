---
name: Legendary dragon artwork
description: Approved source and handling for app icons and loading artwork.
---

Keep the square v4 dragon icons for the installed launcher icon. For the controlled React loading screen, use the complete original rectangular `public/legendary-dragon.png` artwork at its native aspect ratio with `object-fit: contain` on a black background; do not crop or alter it. Do not use launcher-icon geometry as the loading-screen design. Keep the welcome page and authentication unchanged.

**Why:** The user explicitly separated the square Android launcher icon from the full original artwork used after React renders. The full rectangular art is more important than filling the portrait screen, and Android's generated icon splash cannot be controlled by the React screen.

**How to apply:** Keep manifest icon references on the padded square set; render the original rectangle only in the app-controlled loading component, centered and contained in a full-viewport dark background. Include the original image in the service-worker shell cache so the loading artwork is available offline.