import { readJsonBody } from "./deepseek.js";

const DEFAULT_GCJ02_LAT = 45.74303224082512;
const DEFAULT_GCJ02_LNG = 126.6314330493297;
const GCJ_A = 6378245.0;
const GCJ_EE = 0.006693421622965943;

function pickNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function pickBoolean(value) {
  return value === true || value === "true" || value === 1 || value === "1";
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

function normalizeMapCoordinates(body) {
  const rawLat = body.lat ?? body.latitude;
  const rawLng = body.lng ?? body.lon ?? body.longitude;
  if (rawLat === undefined || rawLat === null || rawLng === undefined || rawLng === null) {
    return { lat: DEFAULT_GCJ02_LAT, lng: DEFAULT_GCJ02_LNG };
  }

  const lat = pickNumber(rawLat, DEFAULT_GCJ02_LAT);
  const lng = pickNumber(rawLng, DEFAULT_GCJ02_LNG);
  if (String(body.coordinateSystem || body.coordSystem || "").toLowerCase() === "gcj02") {
    return { lat, lng };
  }
  return wgs84ToGcj02(lat, lng);
}

export function normalizeMiniRelayPayload(body = {}) {
  const timestamp = Number(body.timestamp || Date.now());
  const hr = pickNumber(body.hr ?? body.heartRate ?? body.bpm, 0);
  const temp = pickNumber(body.temp ?? body.temperature, 0);
  const { lat, lng } = normalizeMapCoordinates(body);
  const state = String(body.state || body.displayState || "等待数据");
  const isAlarm = Boolean(
    pickBoolean(body.isAlarm) ||
    pickBoolean(body.alert) ||
    temp > 40 ||
    (hr > 150 && hr !== 0) ||
    state.includes("ALARM") ||
    state.includes("异常") ||
    state.includes("预警")
  );

  return {
    event: String(body.event || (isAlarm ? "MINI_PROGRAM_ALARM" : "TELEMETRY")),
    isAlarm,
    alert: isAlarm,
    state,
    displayState: isAlarm ? "状态预警" : String(body.displayState || state),
    hr,
    temp: Number(temp.toFixed(1)),
    battery: body.battery == null ? null : Math.max(1, Math.min(100, Math.round(pickNumber(body.battery, 100)))),
    lat,
    lng,
    coordinateSystem: "gcj02",
    hasGps: body.hasGps !== false,
    source: String(body.source || "web"),
    message: String(body.message || (isAlarm ? "检测到宠物生命体征异常，请立即查看。" : "生命体征同步更新。")),
    timestamp,
    recordedAt: body.recordedAt || new Date(timestamp).toISOString()
  };
}

export async function pushMiniRelay(payload, env = process.env) {
  const endpoint = env.CLOUDBASE_RELAY_URL || env.MINI_RELAY_URL;
  if (!endpoint) {
    return {
      ok: false,
      skipped: true,
      reason: "CLOUDBASE_RELAY_URL is not configured",
      payload
    };
  }

  const headers = { "Content-Type": "application/json" };
  const token = env.CLOUDBASE_RELAY_TOKEN || env.MINI_RELAY_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(payload)
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.ok === false) {
    const error = new Error(result.error || result.message || `CloudBase relay failed with ${response.status}`);
    error.statusCode = response.status || 502;
    throw error;
  }

  return {
    ok: true,
    provider: "cloudbase-http",
    result
  };
}

export async function handleMiniRelay(req) {
  const body = await readJsonBody(req);
  const payload = normalizeMiniRelayPayload(body);
  return pushMiniRelay(payload);
}
