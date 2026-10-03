import type { useSignIn } from "@clerk/react";

type PasswordResetSignIn = Pick<
  ReturnType<typeof useSignIn>["signIn"],
  "create" | "resetPasswordEmailCode" | "status"
>;

export async function requestPasswordResetCode(
  signIn: PasswordResetSignIn,
  email: string,
) {
  const initialized = await signIn.create({ identifier: email });
  if (initialized.error) return initialized;

  return signIn.resetPasswordEmailCode.sendCode();
}

export async function verifyPasswordResetCode(
  signIn: PasswordResetSignIn,
  code: string,
) {
  const verification = await signIn.resetPasswordEmailCode.verifyCode({ code });
  if (verification.error) return verification;

  if (signIn.status !== "needs_new_password") {
    return { error: new Error("The code did not complete a password reset. Request a new reset code and try again.") };
  }

  return { error: null };
}

export async function submitPasswordReset(
  signIn: PasswordResetSignIn,
  password: string,
) {
  const result = await signIn.resetPasswordEmailCode.submitPassword({ password });
  if (result.error) return result;

  if (signIn.status !== "complete") {
    return { error: new Error("Clerk did not complete the password reset. Please try again.") };
  }

  // Intentionally do not call signIn.finalize(): completing recovery updates
  // the password, but the user must remain signed out and return to Log In.
  return { error: null };
}