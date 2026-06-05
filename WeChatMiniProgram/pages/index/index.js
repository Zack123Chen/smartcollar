const mqtt = require("mqtt");

const app = getApp();
const HISTORY_KEY = "careguard.telemetry.history";

function clampHistory(history) {
  return history.slice(-60);
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function formatTime(timestamp = Date.now()) {
  const date = new Date(timestamp);
  return [
    String(date.getHours()).padStart(2, "0"),
    String(date.getMinutes()).padStart(2, "0"),
    String(date.getSeconds()).padStart(2, "0")
  ].join(":");
}

Page({
  data: {
    connected: false,
    connecting: false,
    alarmActive: false,
    alarmMuted: false,
    statusLabel: "等待连接",
    lastUpdated: "--:--:--",
    telemetry: {
      state: "等待数据",
      displayState: "等待数据",
      hr: 0,
      temp: 0,
      battery: 100,
      lat: 45.751167,
      lng: 126.629339,
      source: "none"
    },
    alertMessage: "",
    historyCount: 0,
    logs: [
      { time: "--:--:--", type: "系统", text: "小程序控制台待命。" }
    ],
    controls: [
      { code: "BEEP", label: "蜂鸣召回", desc: "发送远程召回蜂鸣声音频信号" },
      { code: "LIGHT_ON", label: "灯光寻宠", desc: "开启项圈 LED 夜间高亮指示" },
      { code: "ECO_MODE", label: "省电模式", desc: "切换项圈至低功耗采集模式" }
    ]
  },

  onLoad() {
    const history = wx.getStorageSync(HISTORY_KEY) || [];
    this.setData({ historyCount: history.length });
    this.connectBroker();
  },

  onUnload() {
    if (this.client) {
      this.client.end(true);
      this.client = null;
    }
  },

  connectBroker() {
    if (this.client || this.data.connecting) return;

    const { brokerUrl, telemetryTopic, alertTopic } = app.globalData;
    const clientId = `WX_CareGuard_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
    this.setData({ connecting: true, statusLabel: "连接中" });
    this.appendLog("系统", "正在接入 MQTT 守护链路。");

    this.client = mqtt.connect(brokerUrl, {
      clientId,
      clean: true,
      protocolVersion: 4,
      reconnectPeriod: 3000,
      connectTimeout: 8000,
      keepalive: 30
    });

    this.client.on("connect", () => {
      this.setData({
        connected: true,
        connecting: false,
        statusLabel: "实时监听"
      });
      this.client.subscribe([telemetryTopic, alertTopic], { qos: 0 });
      this.appendLog("系统", "已订阅遥测与报警主题。");
    });

    this.client.on("reconnect", () => {
      this.setData({ connected: false, connecting: true, statusLabel: "重连中" });
    });

    this.client.on("close", () => {
      this.setData({ connected: false, connecting: false, statusLabel: "连接断开" });
    });

    this.client.on("error", error => {
      this.appendLog("纠错", `MQTT 连接异常: ${error.message}`);
    });

    this.client.on("message", (topic, message) => {
      this.handleMqttMessage(topic, message);
    });
  },

  handleMqttMessage(topic, message) {
    let payload;
    try {
      payload = JSON.parse(message.toString());
    } catch (error) {
      this.appendLog("纠错", "收到无法解析的遥测报文。");
      return;
    }

    if (topic === app.globalData.alertTopic) {
      payload = {
        ...payload,
        isAlarm: true,
        state: payload.state || "异常体温预警",
        displayState: "状态预警"
      };
    }

    this.processTelemetry(payload);
  },

  processTelemetry(payload) {
    const hr = toNumber(payload.hr ?? payload.heartRate ?? payload.bpm);
    const temp = toNumber(payload.temp ?? payload.temperature, 38.5);
    const battery = Math.max(1, Math.min(100, Math.round(toNumber(payload.battery, 100))));
    const state = payload.state || "日常慢步";
    const isAlarm = Boolean(payload.isAlarm || payload.alert || temp > 40 || (hr > 150 && hr !== 0) || String(state).includes("ALARM") || state === "异常体温预警");
    const displayState = isAlarm ? "状态预警" : this.normalizeState(state, hr);
    const wasAlarmActive = this.data.alarmActive;
    const nextTelemetry = {
      state,
      displayState,
      hr,
      temp: Number(temp.toFixed(1)),
      battery,
      lat: toNumber(payload.lat ?? payload.latitude, this.data.telemetry.lat),
      lng: toNumber(payload.lng ?? payload.lon ?? payload.longitude, this.data.telemetry.lng),
      source: payload.source || (payload.isSimulator ? "simulator" : "hardware")
    };

    this.persistTelemetry(nextTelemetry);
    this.setData({
      telemetry: nextTelemetry,
      lastUpdated: formatTime(payload.timestamp || Date.now()),
      statusLabel: isAlarm ? "异常预警" : "体征正常",
      alarmActive: isAlarm,
      alertMessage: isAlarm
        ? (payload.message || "检测到体温或心率偏离正常阈值，请立即查看宠物状态。")
        : ""
    });

    if (isAlarm && !wasAlarmActive) {
      this.raiseAlarm(nextTelemetry, payload.message);
    } else if (!isAlarm && wasAlarmActive) {
      this.appendLog("系统", "生命体征恢复正常，报警状态已解除。");
      wx.showToast({ title: "体征已恢复", icon: "success" });
    }
  },

  normalizeState(state, hr) {
    if (state === "熟睡" || state === "Sleep" || hr < 70) return "熟睡模式";
    if (state === "快速奔跑" || state === "奔跑" || state === "Running" || hr > 130) return "快速奔跑";
    return "日常慢步";
  },

  raiseAlarm(telemetry, message) {
    this.appendLog("警告", `收到小程序报警: ${telemetry.temp}°C / ${telemetry.hr}BPM`);
    if (!this.data.alarmMuted) {
      wx.vibrateLong();
      wx.showModal({
        title: "宠物体征预警",
        content: message || "Web 仿真端触发报警，请立即查看小七状态。",
        confirmText: "我知道了",
        showCancel: false
      });
    }
  },

  sendCommand(event) {
    const { code, desc } = event.currentTarget.dataset;
    const { controlTopic } = app.globalData;
    const payload = {
      command: code,
      timestamp: Date.now(),
      operator: "WX_Guardian_Center"
    };

    if (!this.client || !this.data.connected) {
      wx.showToast({ title: "链路未连接", icon: "none" });
      return;
    }

    this.client.publish(controlTopic, JSON.stringify(payload), { qos: 0 });
    this.appendLog("操作", `已下发 ${code}: ${desc}`);
    wx.showToast({ title: "指令已发送", icon: "success" });
  },

  toggleMute() {
    this.setData({ alarmMuted: !this.data.alarmMuted });
    wx.showToast({
      title: this.data.alarmMuted ? "报警已静音" : "报警震动已开启",
      icon: "none"
    });
  },

  persistTelemetry(sample) {
    const history = clampHistory([...(wx.getStorageSync(HISTORY_KEY) || []), {
      ...sample,
      recordedAt: new Date().toISOString()
    }]);
    wx.setStorageSync(HISTORY_KEY, history);
    this.setData({ historyCount: history.length });
  },

  appendLog(type, text) {
    const logs = [
      ...this.data.logs,
      { time: formatTime(), type, text }
    ].slice(-8);
    this.setData({ logs });
  }
});
