const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

function parseEvent(event) {
  if (event && typeof event.body === "string") {
    try {
      return JSON.parse(event.body || "{}");
    } catch (error) {
      return {};
    }
  }
  return event || {};
}

function assertRelayToken(event) {
  const expected = process.env.CLOUDBASE_RELAY_TOKEN || process.env.MINI_RELAY_TOKEN;
  if (!expected || !event || !event.headers) return;

  const headers = event.headers || {};
  const authorization = headers.authorization || headers.Authorization || "";
  if (authorization === `Bearer ${expected}`) return;

  const error = new Error("Unauthorized relay request");
  error.statusCode = 401;
  throw error;
}

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeTelemetry(input) {
  const timestamp = Number(input.timestamp || Date.now());
  const hr = number(input.hr || input.heartRate || input.bpm, 0);
  const temp = number(input.temp || input.temperature, 0);
  const state = String(input.state || input.displayState || "等待数据");
  const isAlarm = Boolean(
    input.isAlarm ||
    input.alert ||
    temp > 40 ||
    (hr > 150 && hr !== 0) ||
    state.includes("ALARM") ||
    state.includes("异常") ||
    state.includes("预警")
  );

  return {
    event: String(input.event || (isAlarm ? "MINI_PROGRAM_ALARM" : "TELEMETRY")),
    isAlarm,
    alert: isAlarm,
    state,
    displayState: isAlarm ? "状态预警" : String(input.displayState || state),
    hr,
    temp: Number(temp.toFixed(1)),
    battery: input.battery == null ? null : Math.max(1, Math.min(100, Math.round(number(input.battery, 100)))),
    lat: number(input.lat || input.latitude, 45.751167),
    lng: number(input.lng || input.lon || input.longitude, 126.629339),
    hasGps: input.hasGps !== false,
    source: String(input.source || "web"),
    message: String(input.message || (isAlarm ? "检测到宠物生命体征异常，请立即查看。" : "生命体征同步更新。")),
    timestamp,
    recordedAt: input.recordedAt || new Date(timestamp).toISOString(),
    updatedAt: db.serverDate()
  };
}

exports.main = async (event) => {
  assertRelayToken(event);
  const telemetry = normalizeTelemetry(parseEvent(event));
  const latest = db.collection("latestTelemetry").doc("current");
  const result = {
    ok: true,
    telemetry,
    warnings: []
  };

  try {
    await latest.set({ data: telemetry });
  } catch (error) {
    await latest.update({ data: telemetry });
  }

  if (telemetry.isAlarm) {
    try {
      await db.collection("alerts").add({
        data: telemetry
      });
    } catch (error) {
      result.warnings.push("alerts collection is unavailable");
    }
  }

  return result;
};
