import { readJsonBody } from "./deepseek.js";

const MAX_TEXT_LENGTH = 1800;

function text(value, fallback = "") {
  return String(value ?? fallback).trim();
}

function formatMetric(value, unit) {
  if (value === null || value === undefined || value === "") return "未接入";
  const number = Number(value);
  return Number.isFinite(number) ? `${number}${unit}` : `${value}${unit}`;
}

export function buildAlertNotification(body = {}) {
  const petName = text(body.petName, "小七") || "小七";
  const state = text(body.state || body.displayState, "生命体征预警");
  const hr = formatMetric(body.hr ?? body.heartRate ?? body.bpm, " BPM");
  const temp = formatMetric(body.temp ?? body.temperature, " °C");
  const battery = formatMetric(body.battery, "%");
  const lat = body.lat ?? body.latitude;
  const lng = body.lng ?? body.lon ?? body.longitude;
  const gps = lat !== undefined && lng !== undefined ? `${lng}, ${lat}` : "未接入";
  const message = text(body.message, "检测到宠物生命体征异常，请立即查看。");
  const time = new Date(body.timestamp || Date.now()).toLocaleString("zh-CN", {
    hour12: false,
    timeZone: "Asia/Shanghai"
  });

  return {
    title: `宠物体征预警：${petName}`,
    desp: [
      `## ${state}`,
      "",
      message,
      "",
      `- 时间：${time}`,
      `- 心率：${hr}`,
      `- 体温：${temp}`,
      `- 电量：${battery}`,
      `- GPS：${gps}`,
      "",
      "请打开宠爱云护小程序或 Web 大屏查看实时状态。"
    ].join("\n").slice(0, MAX_TEXT_LENGTH)
  };
}

export async function sendServerChanNotification(notification, env = process.env) {
  const sendKey = env.SERVERCHAN_SENDKEY || env.FTQQ_SENDKEY || env.SCT_SENDKEY;
  if (!sendKey) {
    const error = new Error("SERVERCHAN_SENDKEY is not configured");
    error.statusCode = 500;
    throw error;
  }

  const response = await fetch(`https://sctapi.ftqq.com/${encodeURIComponent(sendKey)}.send`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded; charset=utf-8" },
    body: new URLSearchParams({
      title: notification.title,
      desp: notification.desp
    })
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok || (result.code !== undefined && result.code !== 0)) {
    const error = new Error(result.message || result.errmsg || `ServerChan request failed with ${response.status}`);
    error.statusCode = response.status || 502;
    throw error;
  }

  return {
    ok: true,
    provider: "serverchan",
    result
  };
}

export async function handleAlertNotification(req) {
  const body = await readJsonBody(req);
  const notification = buildAlertNotification(body);
  return sendServerChanNotification(notification);
}
