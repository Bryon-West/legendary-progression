import { useState, type FormEvent } from "react";
import { useSignIn } from "@clerk/react";
import { Link, useLocation } from "wouter";
import { requestPasswordResetCode, submitPasswordReset, verifyPasswordResetCode } from "@/lib/password-reset-flow";
import { AuthFrame } from "./auth";

type ResetStep = "email" | "code" | "password" | "success";

type ClerkOperationError = {
  longMessage?: string;
  message?: string;
  errors?: Array<{ longMessage?: string; message?: string }>;
};

function passwordResetError(error: unknown): string {
  const clerkError = error as ClerkOperationError | null;
  const first = clerkError?.errors?.[0];
  return clerkError?.longMessage || first?.longMessage || first?.message || clerkError?.message
    || "We couldn't complete that request. Check your details and try again.";
}

export default function ForgotPasswordPage() {
  const { signIn, fetchStatus } = useSignIn();
  const [, navigate] = useLocation();
  const [step, setStep] = useState<ResetStep>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = pending || fetchStatus === "fetching";

  const handleSendCode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const result = await requestPasswordResetCode(signIn, email.trim());
      if (result.error) {
        setError(passwordResetError(result.error));
        return;
      }
      setStep("code");
    } catch (requestError) {
      setError(passwordResetError(requestError));
    } finally {
      setPending(false);
    }
  };

  const handleVerifyCode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const result = await verifyPasswordResetCode(signIn, code.trim());
      if (result.error) {
        setError(passwordResetError(result.error));
        return;
      }
      setStep("password");
    } catch (verificationError) {
      setError(passwordResetError(verificationError));
    } finally {
      setPending(false);
    }
  };

  const handleSubmitPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    if (password !== confirmPassword) {
      setError("The passwords do not match.");
      return;
    }

    setPending(true);
    try {
      const result = await submitPasswordReset(signIn, password);
      if (result.error) {
        setError(passwordResetError(result.error));
        return;
      }
      setPassword("");
      setConfirmPassword("");
      setStep("success");
    } catch (resetError) {
      setError(passwordResetError(resetError));
    } finally {
      setPending(false);
    }
  };

  const handleReturnToLogin = async () => {
    setPending(true);
    setError(null);
    try {
      const result = await signIn.reset();
      if (result.error) {
        setError(passwordResetError(result.error));
        setPending(false);
        return;
      }
      setPending(false);
      navigate("/sign-in");
    } catch (resetError) {
      setError(passwordResetError(resetError));
      setPending(false);
    }
  };

  return (
    <AuthFrame eyebrow="ACCOUNT RECOVERY">
      <div className="lp-auth__heading">
        <h1>
          {step === "email" && "Reset your password"}
          {step === "code" && "Check your email"}
          {step === "password" && "Choose a new password"}
          {step === "success" && "Password updated"}
        </h1>
        <p>
          {step === "email" && "Enter the email address for your Legendary account. We'll send a password-reset code."}
          {step === "code" && <>Enter the password-reset code sent to <strong>{email}</strong>. Verifying this code will not log you in.</>}
          {step === "password" && "Set and confirm your new password to finish recovery."}
          {step === "success" && "Password updated successfully. You can now log in with your new password."}
        </p>
      </div>

      {error && <p role="alert" className="lp-auth__error">{error}</p>}

      {step === "email" && (
        <form className="lp-auth__form" onSubmit={(event) => void handleSendCode(event)}>
          <label className="lp-auth__field" htmlFor="reset-email">
            Email
            <input
              id="reset-email"
              className="lp-auth__input"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <button className="lp-auth__submit" type="submit" disabled={busy}>
            {busy ? "Sending code…" : "Send password-reset code"}
          </button>
        </form>
      )}

      {step === "code" && (
        <form className="lp-auth__form" onSubmit={(event) => void handleVerifyCode(event)}>
          <label className="lp-auth__field" htmlFor="reset-code">
            Password-reset code
            <input
              id="reset-code"
              className="lp-auth__input"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          </label>
          <button className="lp-auth__submit" type="submit" disabled={busy}>
            {busy ? "Verifying code…" : "Verify code"}
          </button>
        </form>
      )}

      {step === "password" && (
        <form className="lp-auth__form" onSubmit={(event) => void handleSubmitPassword(event)}>
          <label className="lp-auth__field" htmlFor="new-password">
            New password
            <input
              id="new-password"
              className="lp-auth__input"
              type="password"
              autoComplete="new-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <label className="lp-auth__field" htmlFor="confirm-new-password">
            Confirm new password
            <input
              id="confirm-new-password"
              className="lp-auth__input"
              type="password"
              autoComplete="new-password"
              required
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
            />
          </label>
          <button className="lp-auth__submit" type="submit" disabled={busy}>
            {busy ? "Updating password…" : "Reset password"}
          </button>
        </form>
      )}

      {step === "success" && (
        <button className="lp-auth__submit" type="button" onClick={() => void handleReturnToLogin()} disabled={busy}>
          {busy ? "Returning to Log In…" : "Return to Log In"}
        </button>
      )}

      {step !== "success" && (
        <p className="lp-auth__switch">
          Remembered your password?{" "}
          <Link
            href="/sign-in"
            onClick={(event) => {
              event.preventDefault();
              void handleReturnToLogin();
            }}
          >
            LOG IN
          </Link>
        </p>
      )}
    </AuthFrame>
  );
}