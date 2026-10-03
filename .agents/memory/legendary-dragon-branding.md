---
name: Legendary dragon artwork
description: Approved source and handling for app icons and loading artwork.
---

Use the newest full dragon artwork shown on the main welcome screen as the source for PWA icons, maskable/adaptive icons, and favicons. Preserve the dragon itself: use uniform contain/fit scaling, center it, and add dark padding rather than cropping, stretching, redrawing, or retouching. The Android-generated PWA launch splash should use this art once; keep the React loading state neutral so it does not show a second dragon. Do not alter the main welcome page or working authentication as part of icon/splash work.

**Why:** The user specified this as the current Legendary dragon artwork and asked for one consistent startup, while Android can retain old manifest icon imagery in an installed PWA.

**How to apply:** Start from the approved welcome-screen image and create padded outputs sized for each platform, keeping the maskable version inside Android's safe area. Version new manifest icon URLs and the service-worker cache; advise reinstalling an existing Android PWA to refresh its OS-cached launch icon.