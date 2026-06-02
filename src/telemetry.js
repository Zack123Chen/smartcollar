const STATE_LABELS = {
  active: "日常慢步",
  walk: "日常慢步",
  walking: "日常慢步",
  patrol: "日常慢步",
  run: "快速奔跑",
  running: "快速奔跑",
  charge: "快速奔跑",
  sleep: "熟睡",
  rest: "熟睡",
  fever: "异常体温预警",
  alarm: "异常体温预警",
  panic: "异常体温预警"
};

function firstDefined(...values) {
  return values.find(value => value !== undefined && value !== null && value !== "");
}

function toNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const normalized = value.trim().replace(/[^\d.+-]/g, "");
    if (!normalized) return null;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeState(value) {
  const raw = String(firstDefined(value, "Active")).trim();
  const key = raw.toLowerCase().replace(/[\s_-]/g, "");
  return STATE_LABELS[key] || raw;
}

function toBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return ["true", "1", "yes", "sim", "simulator"].includes(value.trim().toLowerCase());
  return false;
}

export function parseTelemetryMessage(rawMessage) {
  if (typeof rawMessage !== "string") return rawMessage;

  try {
    return JSON.parse(rawMessage);
  } catch {
    const pairs = rawMessage
      .trim()
      .split(/[;,，\s]+/)
      .map(part => part.split(/[:=]/))
      .filter(pair => pair.length >= 2);

    if (!pairs.length) {
      throw new Error(`Unsupported telemetry message: ${rawMessage.slice(0, 80)}`);
    }

    return Object.fromEntries(pairs.map(([key, ...rest]) => [key.trim(), rest.join(":").trim()]));
  }
}

export function normalizeTelemetryPayload(input) {
  const payload = input?.data && typeof input.data === "object" ? input.data : input;
  if (!payload || typeof payload !== "object") {
    throw new Error("Telemetry payload must be an object");
  }

  const gps = payload.gps || payload.location || payload.position || {};
  const coords = Array.isArray(payload.coords) ? payload.coords : Array.isArray(payload.gps) ? payload.gps : null;
  const lat = toNumber(firstDefined(
    payload.lat,
    payload.latitude,
    payload.gpsLat,
    payload.gps_lat,
    gps.lat,
    gps.latitude,
    coords?.[0]
  ));
  const lng = toNumber(firstDefined(
    payload.lng,
    payload.lon,
    payload.long,
    payload.longitude,
    payload.gpsLng,
    payload.gpsLon,
    payload.gps_lng,
    payload.gps_lon,
    gps.lng,
    gps.lon,
    gps.longitude,
    coords?.[1]
  ));

  const hr = toNumber(firstDefined(
    payload.hr,
    payload.heartRate,
    payload.heart_rate,
    payload.bpm,
    payload.heart,
    payload.pulse
  ));
  const temp = toNumber(firstDefined(
    payload.temp,
    payload.temperature,
    payload.bodyTemp,
    payload.body_temp,
    payload.coreTemp,
    payload.core_temp
  ));
  const battery = toNumber(firstDefined(
    payload.battery,
    payload.bat,
    payload.batteryPct,
    payload.battery_pct,
    payload.power,
    payload.soc
  ));

  return {
    raw: payload,
    state: normalizeState(firstDefined(payload.state, payload.status, payload.motion, payload.mode, payload.activity)),
    hr: hr ?? 80,
    temp: temp ?? 38.5,
    battery: battery ?? 100,
    lat,
    lng,
    hasGps: lat !== null && lng !== null,
    isSimulator: toBoolean(payload.isSimulator)
  };
}

export function formatGpsLabel(telemetry) {
  return telemetry.hasGps ? `[${telemetry.lng.toFixed(5)}, ${telemetry.lat.toFixed(5)}]` : "无有效定位";
}
