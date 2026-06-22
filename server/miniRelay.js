import { readJsonBody } from "./deepseek.js";

function pickNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function pickBoolean(value) {
  return value === true || value === "true" || value === 1 || value === "1";
}

export function normalizeMiniRelayPayload(body = {}) {
  const timestamp = Number(body.timestamp || Date.now());
  const hr = pickNumber(body.hr ?? body.heartRate ?? body.bpm, 0);
  const temp = pickNumber(body.temp ?? body.temperature, 0);
  const lat = pickNumber(body.lat ?? body.latitude, 45.750516);
  const lng = pickNumber(body.lng ?? body.lon ?? body.longitude, 126.628947);
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
