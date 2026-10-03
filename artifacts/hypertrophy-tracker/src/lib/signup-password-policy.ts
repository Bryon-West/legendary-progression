export const MIN_SIGNUP_PASSWORD_LENGTH = 15;

export function getSignupPasswordLengthError(password: string): string | null {
  if (password.length < MIN_SIGNUP_PASSWORD_LENGTH) {
    return `Use a password with at least ${MIN_SIGNUP_PASSWORD_LENGTH} characters.`;
  }

  return null;
}