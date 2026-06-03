import test from "node:test";
import assert from "node:assert/strict";

import {
  isAiRequestAllowed,
  isPathInsideDirectory
} from "../server/security.js";

function request(headers, remoteAddress) {
  return {
    headers,
    socket: { remoteAddress }
  };
}

test("static path guard rejects sibling directories with a shared prefix", () => {
  assert.equal(isPathInsideDirectory("/app/dist", "/app/dist/index.html"), true);
  assert.equal(isPathInsideDirectory("/app/dist", "/app/dist/assets/app.js"), true);
  assert.equal(isPathInsideDirectory("/app/dist", "/app/dist-secret/keys.txt"), false);
  assert.equal(isPathInsideDirectory("/app/dist", "/app/package.json"), false);
});

test("AI API allows loopback tooling without an Origin header", () => {
  assert.equal(isAiRequestAllowed(request({ host: "localhost:5173" }, "127.0.0.1")), true);
  assert.equal(isAiRequestAllowed(request({ host: "localhost:5173" }, "::1")), true);
});

test("AI API blocks remote no-origin requests and cross-origin browsers", () => {
  assert.equal(isAiRequestAllowed(request({ host: "demo.local:5173" }, "192.168.1.24")), false);
  assert.equal(
    isAiRequestAllowed(request({ host: "demo.local:5173", origin: "https://evil.example" }, "192.168.1.24")),
    false
  );
});

test("AI API permits same-origin browser requests for LAN demos", () => {
  assert.equal(
    isAiRequestAllowed(request({ host: "demo.local:5173", origin: "http://demo.local:5173" }, "192.168.1.24")),
    true
  );
});
