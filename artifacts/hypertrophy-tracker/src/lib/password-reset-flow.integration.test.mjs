import assert from "node:assert/strict";
import test from "node:test";
import {
  requestPasswordResetCode,
  submitPasswordReset,
  verifyPasswordResetCode,
} from "./password-reset-flow.ts";

function createSignInMock() {
  const calls = [];
  const signIn = {
    status: "needs_identifier",
    create: async (params) => {
      calls.push(["create", params]);
      return { error: null };
    },
    resetPasswordEmailCode: {
      sendCode: async () => {
        calls.push("send-password-reset-code");
        return { error: null };
      },
      verifyCode: async ({ code }) => {
        calls.push(["verify-password-reset-code", code]);
        signIn.status = "needs_new_password";
        return { error: null };
      },
      submitPassword: async () => {
        calls.push("submit-new-password");
        signIn.status = "complete";
        return { error: null };
      },
    },
    emailCode: {
      verifyCode: async () => {
        calls.push("verify-email-code-sign-in");
        signIn.status = "complete";
        return { error: null };
      },
    },
    finalize: async () => {
      calls.push("finalize-session");
      return { error: null };
    },
  };

  return { signIn, calls };
}

test("password recovery uses Clerk's reset-code strategy and stops before session finalization", async () => {
  const { signIn, calls } = createSignInMock();

  const sendResult = await requestPasswordResetCode(signIn, "athlete@example.com");
  assert.equal(sendResult.error, null);

  const verifyResult = await verifyPasswordResetCode(signIn, "123456");
  assert.equal(verifyResult.error, null);
  assert.equal(signIn.status, "needs_new_password");

  const resetResult = await submitPasswordReset(signIn, "test-only-password");
  assert.equal(resetResult.error, null);
  assert.equal(signIn.status, "complete");
  assert.deepEqual(calls, [
    ["create", { identifier: "athlete@example.com" }],
    "send-password-reset-code",
    ["verify-password-reset-code", "123456"],
    "submit-new-password",
  ]);
});

test("code verification cannot advance to password entry unless Clerk reports needs_new_password", async () => {
  const { signIn } = createSignInMock();
  signIn.resetPasswordEmailCode.verifyCode = async () => {
    signIn.status = "complete";
    return { error: null };
  };

  const result = await verifyPasswordResetCode(signIn, "123456");
  assert.match(result.error.message, /did not complete a password reset/);
});

test("a Clerk error while requesting a reset code is returned without sending a code", async () => {
  const { signIn, calls } = createSignInMock();
  const clerkError = { message: "Request failed" };
  signIn.create = async () => {
    calls.push("create-failed");
    return { error: clerkError };
  };

  const result = await requestPasswordResetCode(signIn, "athlete@example.com");
  assert.equal(result.error, clerkError);
  assert.deepEqual(calls, ["create-failed"]);
});