import { publishableKeyFromHost } from "@clerk/react/internal";
import { shadcn } from "@clerk/themes";

export const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

export const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);

export const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

if (!clerkPubKey) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY");
}

export function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

export const clerkAppearance = {
  theme: shadcn,
  cssLayerName: "clerk",
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: "#e7bd4b",
    colorForeground: "#f4f0e7",
    colorMutedForeground: "#aaa69d",
    colorDanger: "#f87171",
    colorBackground: "#11110f",
    colorInput: "#191815",
    colorInputForeground: "#f4f0e7",
    colorNeutral: "#494437",
    fontFamily: "'DM Sans', sans-serif",
    borderRadius: "8px",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox: "bg-[#11110f] border border-[#39362e] rounded-xl w-[440px] max-w-full overflow-hidden",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    headerTitle: "text-[#f4f0e7]",
    headerSubtitle: "text-[#aaa69d]",
    formFieldLabel: "text-[#e1ddd4]",
    formFieldInput: "bg-[#191815] border-[#494437] text-[#f4f0e7]",
    formButtonPrimary: "bg-[#e7bd4b] text-[#16140d] hover:bg-[#f1d16c]",
    footerActionLink: "text-[#e7bd4b]",
    footerActionText: "text-[#aaa69d]",
    dividerText: "text-[#aaa69d]",
    dividerLine: "bg-[#39362e]",
    alertText: "text-[#f4f0e7]",
    otpCodeFieldInput: "bg-[#191815] border-[#494437] text-[#f4f0e7]",
  },
};