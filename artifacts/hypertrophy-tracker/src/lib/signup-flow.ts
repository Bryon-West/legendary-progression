import type { useSignUp } from "@clerk/react";
import type { listProfiles, updateProfile } from "@workspace/api-client-react";
import { getSignupPasswordLengthError } from "./signup-password-policy.ts";

type SignUpResource = ReturnType<typeof useSignUp>["signUp"];

export type SignupProfileApi = {
  listProfiles: typeof listProfiles;
  updateProfile: typeof updateProfile;
};

export function buildPasswordSignupPayload(
  emailAddress: string,
  password: string,
): Parameters<SignUpResource["password"]>[0] {
  const passwordError = getSignupPasswordLengthError(password);
  if (passwordError) throw new Error(passwordError);

  return { emailAddress, password };
}

export function createPasswordSignup(
  signUp: Pick<SignUpResource, "password">,
  emailAddress: string,
  password: string,
) {
  return signUp.password(buildPasswordSignupPayload(emailAddress, password));
}

export async function saveSignupNameToProfile(
  profileApi: SignupProfileApi,
  fullName: string,
) {
  const profiles = await profileApi.listProfiles({ credentials: "include" });
  const profile = profiles[0];
  if (!profile) {
    throw new Error("No account-owned training profile was returned after signup.");
  }

  return profileApi.updateProfile(
    profile.id,
    { name: fullName },
    { credentials: "include" },
  );
}

export async function finalizeSignupAndSaveName(
  signUp: Pick<SignUpResource, "finalize">,
  profileApi: SignupProfileApi,
  fullName: string,
  redirectPath: string,
  onSessionFinalized: (destination: string) => void,
) {
  let destination = redirectPath;
  const result = await signUp.finalize({
    navigate: ({ decorateUrl }) => {
      destination = decorateUrl(redirectPath);
    },
  });
  if (result.error) return { error: result.error, destination };

  onSessionFinalized(destination);
  const profile = await saveSignupNameToProfile(profileApi, fullName);
  return { error: null, destination, profile };
}