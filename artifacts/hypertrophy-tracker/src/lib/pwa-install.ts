export type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

export const PWA_INSTALL_STATE_EVENT = "legendary:pwa-install-state";

declare global {
  interface Window {
    __legendaryDeferredInstallPrompt?: InstallPromptEvent | null;
    __legendaryPwaInstalled?: boolean;
  }
}

export function isPwaInstalled(): boolean {
  const standaloneDisplay = window.matchMedia?.("(display-mode: standalone)").matches ?? false;
  const legacyStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return window.__legendaryPwaInstalled === true || standaloneDisplay || legacyStandalone;
}

export function hasDeferredInstallPrompt(): boolean {
  return window.__legendaryDeferredInstallPrompt != null;
}

export function consumeDeferredInstallPrompt(): InstallPromptEvent | null {
  const promptEvent = window.__legendaryDeferredInstallPrompt ?? null;
  if (promptEvent) {
    window.__legendaryDeferredInstallPrompt = null;
    window.dispatchEvent(new Event(PWA_INSTALL_STATE_EVENT));
  }
  return promptEvent;
}

export function shouldShowManualInstallInstructions(userAgent: string): boolean {
  if (/iphone|ipad|ipod/i.test(userAgent)) return true;

  const supportsBeforeInstallPrompt =
    /(?:chrome|chromium|crios|edg(?:e|a|ios)?|opr|samsungbrowser|brave)\//i.test(userAgent);
  return !supportsBeforeInstallPrompt;
}
