import assert from "node:assert/strict";
import { it } from "node:test";
import { googleLinkIntentCookie } from "./google-link-intent";
import { googleConnectionRequest, runBeginGoogleConnection } from "./google-link-action";
import { startGoogleConnection } from "./google-link-client";

it("sets the HttpOnly intent cookie server-side and returns only a safe ready status", async () => {
  const rawToken = "a".repeat(43);
  const intentCookie = googleLinkIntentCookie(rawToken, true);
  let stored: typeof intentCookie | null = null;
  const result = await runBeginGoogleConnection(googleConnectionRequest("session=value"), {
    create: async request => {
      assert.equal(request.headers.get("cookie"), "session=value");
      assert.equal(request.headers.get("authorization"), null);
      return { status: "ready", cookie: intentCookie };
    },
    setCookie: async cookie => { stored = cookie; }
  });
  assert.deepEqual(result, { status: "ready" });
  assert.deepEqual(stored, intentCookie);
  assert.deepEqual(Object.keys(result), ["status"]);
  assert.doesNotMatch(JSON.stringify(result), /a{43}|user|binding|intent/i);
  assert.deepEqual(intentCookie.options, {
    httpOnly: true, sameSite: "lax", secure: true, path: "/api/auth", maxAge: 600
  });
});

it("does not set a cookie for an already-connected account", async () => {
  let writes = 0;
  const result = await runBeginGoogleConnection(googleConnectionRequest("session=value"), {
    create: async () => ({ status: "already_connected" }),
    setCookie: async () => { writes++; }
  });
  assert.deepEqual(result, { status: "already_connected" });
  assert.equal(writes, 0);
});

it("fails safely when the canonical cookie session is missing or invalid", async () => {
  let writes = 0;
  const original = console.error;
  const logs: unknown[][] = [];
  console.error = (...values: unknown[]) => { logs.push(values); };
  try {
    const result = await runBeginGoogleConnection(googleConnectionRequest(null), {
      create: async request => {
        assert.equal(request.headers.get("cookie"), null);
        assert.equal(request.headers.get("authorization"), null);
        throw new Error("synthetic private failure");
      },
      setCookie: async () => { writes++; }
    });
    assert.deepEqual(result, { status: "error" });
    assert.equal(writes, 0);
    assert.deepEqual(logs, [["AUTH_GOOGLE_LINK_START_FAILED"]]);
  } finally {
    console.error = original;
  }
});

it("starts OAuth only after a ready result", async () => {
  let starts = 0;
  assert.equal(await startGoogleConnection(async () => ({ status: "error" }), async () => { starts++; }), "error");
  assert.equal(await startGoogleConnection(async () => ({ status: "already_connected" }),
    async () => { starts++; }), "already_connected");
  assert.equal(starts, 0);
  assert.equal(await startGoogleConnection(async () => ({ status: "ready" }), async () => { starts++; }),
    "redirecting");
  assert.equal(starts, 1);
});
