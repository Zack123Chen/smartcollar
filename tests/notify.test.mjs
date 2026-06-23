import test from "node:test";
import assert from "node:assert/strict";

import { buildAlertNotification } from "../server/notify.js";

test("alert notification includes vital signs and GPS", () => {
  const notification = buildAlertNotification({
    petName: "小七",
    state: "异常体温预警",
    hr: 168,
    temp: 41.3,
    battery: 92,
    lat: 45.744112,
    lng: 126.627215,
    message: "Web 仿真端触发小程序报警"
  });

  assert.equal(notification.title, "宠物体征预警：小七");
  assert.match(notification.desp, /异常体温预警/);
  assert.match(notification.desp, /168 BPM/);
  assert.match(notification.desp, /41.3 °C/);
  assert.match(notification.desp, /126.627215, 45.744112/);
});

test("alert notification falls back when optional fields are absent", () => {
  const notification = buildAlertNotification({});

  assert.equal(notification.title, "宠物体征预警：小七");
  assert.match(notification.desp, /生命体征预警/);
  assert.match(notification.desp, /心率：未接入/);
  assert.match(notification.desp, /GPS：未接入/);
});
