---
name: Legendary dragon artwork
description: Approved source and handling for app icons and loading artwork.
---

Use the user's latest square padded Legendary dragon image as the source for PWA icons and favicons; do not revert to the wide welcome-screen artwork. Preserve its complete square composition and padding when uniformly resizing the whole image to target icon dimensions. Never crop, zoom within the canvas, remove padding, redraw, or retouch it. Use versioned manifest icon URLs and bump the service-worker cache. Keep the React loading state neutral so Android's generated splash is the only dragon during startup; do not alter the welcome page or authentication for icon work.

**Why:** The user supplied a dedicated padded square asset and explicitly said its black padding is intentional for Android masking. Replacing image data at unchanged icon URLs previously left Android showing cached art, so preserve this composition and version references.

**How to apply:** Use the latest user-provided padded image verbatim as the source for every standard and maskable icon size; only scale the entire square image uniformly. Version the manifest references and service-worker cache, and advise reinstalling an existing Android PWA to refresh its OS-cached launch icon.