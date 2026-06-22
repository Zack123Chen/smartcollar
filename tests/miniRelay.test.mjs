import test from "node:test";
import assert from "node:assert/strict";

import { normalizeMiniRelayPayload } from "../server/miniRelay.js";

test("mini relay normalizes alert payload for CloudBase", () => {
  const payload = normalizeMiniRelayPayload({
    state: "异常体温预警",
    hr: 168,
    temp: 41.3,
    battery: 92,
    latitude: 45.750516,
    longitude: 126.628947,
    source: "web-simulator"
  });

  assert.equal(payload.isAlarm, true);
  assert.equal(payload.displayState, "状态预警");
  assert.equal(payload.hr, 168);
  assert.equal(payload.temp, 41.3);
  assert.equal(payload.lat, 45.750516);
  assert.equal(payload.lng, 126.628947);
  assert.equal(payload.source, "web-simulator");
});

test("mini relay keeps normal telemetry non-alarm", () => {
  const payload = normalizeMiniRelayPayload({
    state: "日常慢步",
    hr: 88,
    temp: 38.4
  });

  assert.equal(payload.isAlarm, false);
  assert.equal(payload.displayState, "日常慢步");
});
