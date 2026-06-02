import assert from "node:assert/strict";
import test from "node:test";

import { formatGpsLabel, normalizeTelemetryPayload, parseTelemetryMessage } from "../src/telemetry.js";

test("normalizes hardware aliases and missing GPS without throwing", () => {
  const telemetry = normalizeTelemetryPayload({
    heartRate: "92 BPM",
    temperature: "38.7C",
    status: "walking",
    batteryPct: "86%"
  });

  assert.equal(telemetry.hr, 92);
  assert.equal(telemetry.temp, 38.7);
  assert.equal(telemetry.battery, 86);
  assert.equal(telemetry.state, "日常慢步");
  assert.equal(telemetry.hasGps, false);
  assert.equal(formatGpsLabel(telemetry), "无有效定位");
});

test("accepts longitude aliases and nested location objects", () => {
  const telemetry = normalizeTelemetryPayload({
    bpm: 128,
    bodyTemp: 39.2,
    activity: "running",
    location: {
      latitude: 45.751167,
      longitude: 126.629339
    }
  });

  assert.equal(telemetry.state, "快速奔跑");
  assert.equal(telemetry.hasGps, true);
  assert.equal(formatGpsLabel(telemetry), "[126.62934, 45.75117]");
});

test("parses key-value telemetry text from MCU logs", () => {
  const payload = parseTelemetryMessage("hr=76 temp=38.4 lat=45.75 lon=126.63 battery=91 status=active isSimulator=false");
  const telemetry = normalizeTelemetryPayload(payload);

  assert.equal(telemetry.hr, 76);
  assert.equal(telemetry.temp, 38.4);
  assert.equal(telemetry.lng, 126.63);
  assert.equal(telemetry.isSimulator, false);
});

test("parses simulator truthy string deliberately", () => {
  const telemetry = normalizeTelemetryPayload({ hr: 80, temp: 38.5, isSimulator: "true" });
  assert.equal(telemetry.isSimulator, true);
});
