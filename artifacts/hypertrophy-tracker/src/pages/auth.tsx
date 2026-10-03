import { useState, type FormEvent, type ReactNode } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListProfilesQueryKey,
  listProfiles,
  updateProfile,
} from "@workspace/api-client-react";
import { SignIn, useSignUp } from "@clerk/react";
import { Link, useLocation } from "wouter";
import { basePath, stripBase } from "@/lib/clerk";
import {
  createPasswordSignup,
  finalizeSignupAndSaveName,
  saveSignupNameToProfile,
} from "@/lib/signup-flow";
import "./auth.css";

type ClerkOperationError = {
  code?: string;
  longMessage?: string;
  message?: string;
  errors?: Array<{ code?: string; longMessage?: string; message?: string }>;
};

function authError(error: unknown): string {
  const clerkError = error as ClerkOperationError | null;
  const first = clerkError?.errors?.[0];
  if ((clerkError?.code ?? first?.code) === "form_identifier_exists") {
    return "An account with this email already exists. Log in instead.";
  }
  return clerkError?.longMessage || first?.longMessage || first?.message || clerkError?.message
    || "We couldn't complete that request. Check your details and try again.";
}

function AuthFrame({ children, eyebrow = "LEGENDARY PROGRESSION" }: { children: ReactNode; eyebrow?: string }) {
  return (
    <main className="lp-auth">
      <header className="lp-auth__top">
        <Link href="/" className="lp-auth__brand" aria-label="Legendary Progression home">
          <span className="lp-auth__sigil" aria-hidden="true"><span>L</span></span>
          <span>LEGENDARY PROGRESSION</span>
        </Link>
        <span className="lp-auth__edition">TRAIN FOR THE LONG GAME</span>
      </header>
      <section className="lp-auth__content">
        <div className="lp-auth__eyebrow">{eyebrow}</div>
        {children}
        <p className="lp-auth__privacy">Your training record is private to your account.</p>
      </section>
      <footer className="lp-auth__footer">
        <span>TRAIN WITH PURPOSE</span>
        <span>EVERY SESSION COUNTS</span>
      </footer>
    </main>
  );
}

export function SignInPage() {
  return (
    <AuthFrame eyebrow="WELCOME BACK">
      <div className="lp-auth__clerk">
        <SignIn
          routing="path"
          path={`${basePath}/sign-in`}
          signUpUrl={`${basePath}/sign-up`}
          forceRedirectUrl={`${basePath}/`}
          appearance={{
            elements: {
              rootBox: { width: "100%" },
              cardBox: { width: "100%", maxWidth: "440px" },
              card: {
                width: "100%",
                maxWidth: "440px",
                padding: "18px 18px 0",
                overflow: "hidden",
                border: "1px solid rgba(231, 189, 75, .28)",
                borderRadius: "12px",
                backgroundColor: "#11110f",
                boxShadow: "0 20px 48px rgba(0, 0, 0, .28)",
              },
              header: { display: "none" },
              logoBox: { display: "none" },
              logoImage: { display: "none" },
              headerTitle: { display: "none" },
              headerSubtitle: { display: "none" },
              socialButtons: { display: "none" },
              socialButtonsBlockButton: { display: "none" },
              socialButtonsIconButton: { display: "none" },
              dividerRow: { display: "none" },
              form: { gap: "18px" },
              formFieldRow: {
                gap: "8px",
                marginBottom: "14px",
              },
              formFieldLabel: {
                color: "#e1ddd4",
                fontSize: "12px",
                fontWeight: "700",
              },
              formFieldInput: {
                width: "100%",
                margin: "0",
                minHeight: "50px",
                border: "1px solid #494437",
                borderRadius: "8px",
                color: "#f4f0e7",
                backgroundColor: "#191815",
                fontSize: "14px",
                boxShadow: "none",
              },
              formFieldAction: {
                color: "#f4d36e",
                fontWeight: "700",
              },
              formButtonPrimary: {
                width: "100%",
                minHeight: "50px",
                margin: "0 0 8px",
                border: "1px solid transparent",
                borderRadius: "8px",
                color: "#17140c",
                background: "linear-gradient(180deg, #f0ce69, #d5a832)",
                fontFamily: "var(--app-font-mono, monospace)",
                fontSize: "11px",
                fontWeight: "700",
                letterSpacing: ".11em",
                textTransform: "uppercase",
                boxShadow: "none",
              },
              footer: {
                padding: "10px 16px",
                borderTop: "1px solid rgba(231, 189, 75, .16)",
                backgroundColor: "transparent",
                boxShadow: "none",
              },
              footerAction: { display: "none" },
            },
          }}
        />
      </div>
      <p className="lp-auth__switch">
        New here? <Link href="/sign-up">CREATE AN ACCOUNT</Link>
      </p>
    </AuthFrame>
  );
}

export function SignUpPage() {
  const { signUp, fetchStatus } = useSignUp();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [showPasswords, setShowPasswords] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [sessionFinalized, setSessionFinalized] = useState(false);
  const [finalizedDestination, setFinalizedDestination] = useState(`${basePath}/`);

  const navigateToDestination = (destination: string) => {
    if (destination.startsWith("https://") || destination.startsWith("http://")) {
      window.location.assign(destination);
    } else {
      navigate(stripBase(destination));
    }
  };

  const persistNameAndContinue = async (destination: string) => {
    const fullName = name.trim().replace(/\s+/g, " ");
    await saveSignupNameToProfile({ listProfiles, updateProfile }, fullName);
    await queryClient.invalidateQueries({ queryKey: getListProfilesQueryKey() });
    navigateToDestination(destination);
  };

  const finishSession = async () => {
    let didFinalizeSession = false;
    try {
      const result = await finalizeSignupAndSaveName(
        signUp,
        { listProfiles, updateProfile },
        name.trim().replace(/\s+/g, " "),
        `${basePath}/`,
        (destination) => {
          didFinalizeSession = true;
          setFinalizedDestination(destination);
          setSessionFinalized(true);
        },
      );
      if (result.error) {
        setError(authError(result.error));
        return;
      }
      await queryClient.invalidateQueries({ queryKey: getListProfilesQueryKey() });
      navigateToDestination(result.destination);
    } catch (caught) {
      setError(
        didFinalizeSession
          ? "Your account is verified, but we couldn't finish saving your training profile. Try again."
          : authError(caught),
      );
    }
  };

  const retryProfileSetup = async () => {
    setError("");
    setPending(true);
    try {
      await persistNameAndContinue(finalizedDestination);
    } catch {
      setError("Your account is verified, but we couldn't finish saving your training profile. Try again.");
    } finally {
      setPending(false);
    }
  };

  const createAccount = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setNotice("");
    if (fetchStatus === "fetching") return;

    const fullName = name.trim().replace(/\s+/g, " ");
    const normalizedEmail = email.trim().toLowerCase();
    if (fullName.length < 2) {
      setError("Enter your name to continue.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setError("Enter a valid email address.");
      return;
    }
    if (!password) {
      setError("Enter a password.");
      return;
    }
    if (!confirmation) {
      setError("Confirm your password.");
      return;
    }
    if (password !== confirmation) {
      setError("The passwords do not match.");
      return;
    }

    setPending(true);
    try {
      const result = await createPasswordSignup(signUp, normalizedEmail, password);
      if (result.error) {
        setError(authError(result.error));
        return;
      }
      if (signUp.status === "complete") {
        await finishSession();
        return;
      }
      if (
        signUp.missingFields.length > 0
        || !signUp.unverifiedFields.includes("email_address")
      ) {
        setError("Your account needs another verification step. Please contact support or try logging in.");
        return;
      }
      const verification = await signUp.verifications.sendEmailCode();
      if (verification.error) {
        setError(authError(verification.error));
        return;
      }
      setVerifying(true);
    } catch (caught) {
      setError(authError(caught));
    } finally {
      setPending(false);
    }
  };

  const verifyEmail = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setNotice("");
    if (fetchStatus === "fetching") return;
    if (!/^\d{4,10}$/.test(code.trim())) {
      setError("Enter the verification code from your email.");
      return;
    }
    setPending(true);
    try {
      const verification = await signUp.verifications.verifyEmailCode({ code: code.trim() });
      if (verification.error) {
        setError(authError(verification.error));
        return;
      }
      if (signUp.status === "complete") {
        await finishSession();
      } else {
        setError("The email code was accepted, but the account is missing required information. Please try again.");
      }
    } catch (caught) {
      setError(authError(caught));
    } finally {
      setPending(false);
    }
  };

  const resendCode = async () => {
    setError("");
    setNotice("");
    if (fetchStatus === "fetching") return;
    setPending(true);
    try {
      const verification = await signUp.verifications.sendEmailCode();
      if (verification.error) {
        setError(authError(verification.error));
      } else {
        setNotice("A new verification code has been sent.");
      }
    } catch (caught) {
      setError(authError(caught));
    } finally {
      setPending(false);
    }
  };

  return (
    <AuthFrame
      eyebrow={
        sessionFinalized
          ? "FINISH YOUR ACCOUNT"
          : verifying
            ? "VERIFY YOUR EMAIL"
            : "CREATE YOUR ACCOUNT"
      }
    >
      {sessionFinalized ? (
        <>
          <div className="lp-auth__heading">
            <h1>Finish setting up your account</h1>
            <p>Your email is verified. Save your name to your private training profile to continue.</p>
          </div>
          {error && <p role="alert" className="lp-auth__error">{error}</p>}
          <button
            className="lp-auth__submit"
            type="button"
            onClick={() => void retryProfileSetup()}
            disabled={pending}
          >
            {pending ? "Saving profile…" : "Continue"}
          </button>
        </>
      ) : !verifying ? (
        <>
          <div className="lp-auth__heading">
            <h1>Create your account</h1>
            <p>One account. One private training record.</p>
          </div>
          <form className="lp-auth__form" onSubmit={createAccount} noValidate>
            <label className="lp-auth__field">
              <span>Name</span>
              <input
                autoComplete="name"
                required
                maxLength={120}
                value={name}
                onChange={(event) => setName(event.target.value)}
                disabled={pending || fetchStatus === "fetching"}
                data-testid="input-signup-name"
              />
            </label>
            <label className="lp-auth__field">
              <span>Email</span>
              <input
                type="email"
                inputMode="email"
                autoComplete="email"
                required
                maxLength={254}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={pending || fetchStatus === "fetching"}
                data-testid="input-signup-email"
              />
            </label>
            <label className="lp-auth__field">
              <span>Password</span>
              <input
                type={showPasswords ? "text" : "password"}
                autoComplete="new-password"
                required
                maxLength={256}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={pending || fetchStatus === "fetching"}
                data-testid="input-signup-password"
              />
            </label>
            <label className="lp-auth__field">
              <span>Confirm password</span>
              <div className="lp-auth__password">
                <input
                  type={showPasswords ? "text" : "password"}
                  autoComplete="new-password"
                  required
                  maxLength={256}
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  disabled={pending || fetchStatus === "fetching"}
                  data-testid="input-signup-confirm-password"
                />
                <button
                  type="button"
                  className="lp-auth__reveal"
                  aria-label={showPasswords ? "Hide passwords" : "Show passwords"}
                  aria-pressed={showPasswords}
                  onClick={() => setShowPasswords((shown) => !shown)}
                >
                  {showPasswords ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </label>
            {error && <p role="alert" className="lp-auth__error">{error}</p>}
            <button className="lp-auth__submit" type="submit" disabled={pending || fetchStatus === "fetching"}>
              {pending ? "Creating account…" : "Create account"}
            </button>
          </form>
          <p className="lp-auth__switch">
            Already have an account? <Link href="/sign-in">Log in</Link>
          </p>
        </>
      ) : (
        <>
          <div className="lp-auth__heading">
            <h1>Check your email</h1>
            <p>Enter the verification code sent to <strong>{email}</strong>.</p>
          </div>
          <form className="lp-auth__form" onSubmit={verifyEmail}>
            <label className="lp-auth__field">
              <span>Email verification code</span>
              <input
                autoFocus
                autoComplete="one-time-code"
                inputMode="numeric"
                pattern="[0-9]*"
                required
                maxLength={10}
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
                disabled={pending}
                data-testid="input-email-verification-code"
              />
            </label>
            {error && <p role="alert" className="lp-auth__error">{error}</p>}
            {notice && <p role="status" className="lp-auth__notice">{notice}</p>}
            <button className="lp-auth__submit" type="submit" disabled={pending || fetchStatus === "fetching"}>
              {pending ? "Verifying…" : "Verify email"}
            </button>
          </form>
          <div className="lp-auth__verify-actions">
            <button type="button" className="lp-auth__text-button" onClick={() => void resendCode()} disabled={pending}>
              Resend code
            </button>
            <button type="button" className="lp-auth__text-button" onClick={() => { setVerifying(false); setError(""); setNotice(""); }} disabled={pending}>
              Back to account details
            </button>
          </div>
        </>
      )}
    </AuthFrame>
  );
}