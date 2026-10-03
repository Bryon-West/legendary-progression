import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPasswordSignupPayload,
  createPasswordSignup,
  finalizeSignupAndSaveName,
} from "./signup-flow.ts";

test("signup sends only Clerk-supported credentials and saves the entered name after verification", async () => {
  const calls = [];
  let passwordPayload;
  let savedProfileName;
  let finalizedDestination;

  const signUp = {
    password: async (params) => {
      calls.push("password");
      passwordPayload = { ...params };
      return { error: null };
    },
    verifications: {
      verifyEmailCode: async ({ code }) => {
        assert.equal(code, "384921");
        calls.push("verify-email");
        return { error: null };
      },
    },
    finalize: async ({ navigate }) => {
      calls.push("finalize-session");
      navigate({ decorateUrl: (url) => `https://tracker.example${url}` });
      return { error: null };
    },
  };

  const payload = buildPasswordSignupPayload("jordan@example.com", "a-long-test-password");
  assert.deepEqual(payload, {
    emailAddress: "jordan@example.com",
    password: "a-long-test-password",
  });
  assert.deepEqual(Object.keys(payload).sort(), ["emailAddress", "password"]);

  const signupResult = await createPasswordSignup(
    signUp,
    "jordan@example.com",
    "a-long-test-password",
  );
  assert.equal(signupResult.error, null);
  await signUp.verifications.verifyEmailCode({ code: "384921" });

  const profileApi = {
    listProfiles: async (options) => {
      assert.deepEqual(options, { credentials: "include" });
      calls.push("provision-account-profile");
      return [{ id: 71, name: "Athlete" }];
    },
    updateProfile: async (profileId, data, options) => {
      assert.equal(profileId, 71);
      assert.deepEqual(data, { name: "Jordan Example" });
      assert.deepEqual(options, { credentials: "include" });
      savedProfileName = data.name;
      calls.push("save-profile-name");
      return { id: profileId, name: data.name };
    },
  };

  const finishResult = await finalizeSignupAndSaveName(
    signUp,
    profileApi,
    "Jordan Example",
    "/",
    (destination) => {
      finalizedDestination = destination;
      calls.push("session-active");
    },
  );

  assert.equal(finishResult.error, null);
  assert.deepEqual(passwordPayload, {
    emailAddress: "jordan@example.com",
    password: "a-long-test-password",
  });
  assert.deepEqual(Object.keys(passwordPayload).sort(), ["emailAddress", "password"]);
  assert.equal(savedProfileName, "Jordan Example");
  assert.equal(finalizedDestination, "https://tracker.example/");
  assert.deepEqual(calls, [
    "password",
    "verify-email",
    "finalize-session",
    "session-active",
    "provision-account-profile",
    "save-profile-name",
  ]);
});

test("a Clerk finalization error does not provision or update an application profile", async () => {
  let profileApiCalls = 0;
  let sessionFinalized = false;

  const result = await finalizeSignupAndSaveName(
    {
      finalize: async () => ({ error: new Error("Clerk finalization failed") }),
    },
    {
      listProfiles: async () => {
        profileApiCalls += 1;
        return [{ id: 71 }];
      },
      updateProfile: async () => {
        profileApiCalls += 1;
        return { id: 71 };
      },
    },
    "Jordan Example",
    "/",
    () => {
      sessionFinalized = true;
    },
  );

  assert.match(result.error.message, /Clerk finalization failed/);
  assert.equal(profileApiCalls, 0);
  assert.equal(sessionFinalized, false);
});