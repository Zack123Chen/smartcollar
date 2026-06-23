const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const DEFAULT_GCJ02_LAT = 45.74303224082512;
const DEFAULT_GCJ02_LNG = 126.6314330493297;
const GCJ_A = 6378245.0;
const GCJ_EE = 0.006693421622965943;

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

function transformLat(x, y) {
  let result = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  result += ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3;
  result += ((20 * Math.sin(y * Math.PI) + 40 * Math.sin((y / 3) * Math.PI)) * 2) / 3;
  result += ((160 * Math.sin((y / 12) * Math.PI) + 320 * Math.sin((y * Math.PI) / 30)) * 2) / 3;
  return result;
}

function transformLng(x, y) {
  let result = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  result += ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3;
  result += ((20 * Math.sin(x * Math.PI) + 40 * Math.sin((x / 3) * Math.PI)) * 2) / 3;
  result += ((150 * Math.sin((x / 12) * Math.PI) + 300 * Math.sin((x / 30) * Math.PI)) * 2) / 3;
  return result;
}

function wgs84ToGcj02(lat, lng) {
  const dLatBase = transformLat(lng - 105, lat - 35);
  const dLngBase = transformLng(lng - 105, lat - 35);
  const radLat = (lat / 180) * Math.PI;
  let magic = Math.sin(radLat);
  magic = 1 - GCJ_EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  const dLat = (dLatBase * 180) / (((GCJ_A * (1 - GCJ_EE)) / (magic * sqrtMagic)) * Math.PI);
  const dLng = (dLngBase * 180) / ((GCJ_A / sqrtMagic) * Math.cos(radLat) * Math.PI);
  return {
    lat: lat + dLat,
    lng: lng + dLng
  };
}

function normalizeMapCoordinates(input) {
  const rawLat = input.lat || input.latitude;
  const rawLng = input.lng || input.lon || input.longitude;
  if (rawLat === undefined || rawLat === null || rawLng === undefined || rawLng === null) {
    return { lat: DEFAULT_GCJ02_LAT, lng: DEFAULT_GCJ02_LNG };
  }

  const lat = number(rawLat, DEFAULT_GCJ02_LAT);
  const lng = number(rawLng, DEFAULT_GCJ02_LNG);
  if (String(input.coordinateSystem || input.coordSystem || "").toLowerCase() === "gcj02") {
    return { lat, lng };
  }
  return wgs84ToGcj02(lat, lng);
}

function normalizeTelemetry(input) {
  const timestamp = Number(input.timestamp || Date.now());
  const hr = number(input.hr || input.heartRate || input.bpm, 0);
  const temp = number(input.temp || input.temperature, 0);
  const coords = normalizeMapCoordinates(input);
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
    lat: coords.lat,
    lng: coords.lng,
    coordinateSystem: "gcj02",
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
