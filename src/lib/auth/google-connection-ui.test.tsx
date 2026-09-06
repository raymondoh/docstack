import assert from "node:assert/strict";
import { it } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { GoogleConnectionButtonView } = require("../../components/account/google-connection-button-view.tsx");
const { GoogleConnectionCardView } = require("../../components/account/google-connection-card-view.tsx");

const email = "buyer@example.com";

it("renders connected state without a Connect or replacement action", () => {
  const html = renderToStaticMarkup(<GoogleConnectionCardView email={email}
    connection={{ googleConnected: true, canConnectGoogle: false }} flow="connected" />);
  assert.match(html, /Google was connected successfully/);
  assert.match(html, /Connected/);
  assert.doesNotMatch(html, /Connect Google|Disconnect|Replace|Change Google/);
});

it("renders unlinked and corrupt states safely and never trusts a forged success query", () => {
  const control = <button>Connect Google</button>;
  const unlinked = renderToStaticMarkup(<GoogleConnectionCardView email={email}
    connection={{ googleConnected: false, canConnectGoogle: true }} flow="connected" connectControl={control} />);
  assert.match(unlinked, /Not connected/);
  assert.match(unlinked, /Connect Google/);
  assert.doesNotMatch(unlinked, /connected successfully/);
  const unavailable = renderToStaticMarkup(<GoogleConnectionCardView email={email}
    connection={{ googleConnected: false, canConnectGoogle: false }} connectControl={control} />);
  assert.match(unavailable, /temporarily unavailable/);
  assert.doesNotMatch(unavailable, /Connect Google/);
});

it("renders pending, start-failure and returned-link failure states with generic copy", () => {
  const pending = renderToStaticMarkup(<GoogleConnectionButtonView state="connecting" />);
  assert.match(pending, /disabled/);
  assert.match(pending, /Connecting/);
  const failed = renderToStaticMarkup(<GoogleConnectionButtonView state="error" />);
  assert.match(failed, /couldn&#x27;t start the Google connection/);
  const returned = renderToStaticMarkup(<GoogleConnectionCardView email={email}
    connection={{ googleConnected: false, canConnectGoogle: true }} flow="error" />);
  assert.match(returned, /couldn&#x27;t connect that Google account/);
  assert.doesNotMatch(returned, /subject|providerAccountId|identity key|user ID/i);
});
