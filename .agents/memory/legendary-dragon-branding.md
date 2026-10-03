---
name: Legendary dragon artwork
description: Approved source and handling for app icons and loading artwork.
---

Use the minimal gold L-in-diamond mark on black for the PWA manifest icons and browser icon. Android's generated PWA startup screen uses the manifest icon family too; there is no separate manifest splash icon or supported icon-suppression field. Keep the manifest startup background black. For the controlled React loading screen, use the complete original rectangular `public/legendary-dragon.png` at its native aspect ratio with `object-fit: contain` on black; do not crop or alter it. Cache this original image in the PWA shell.

**Why:** The user wants no dragon on the Android-generated first screen but wants the full dragon on the second, app-controlled screen. The manifest icons are reused for launcher and generated startup, so the minimal L mark keeps the PWA installable without showing a dragon before React loads.

**How to apply:** Keep `background_color` and `theme_color` black, use the minimal L icon family for PWA/launcher identity, and render the original rectangle only in the app-controlled loading component, centered and contained in a full-viewport black background. Include the original image in the service-worker shell cache so the loading artwork is available offline. If Android still shows an older icon after the current manifest serves the L assets, check the installed PWA's origin and refresh or reinstall it; the OS startup icon is outside React and service-worker rendering.