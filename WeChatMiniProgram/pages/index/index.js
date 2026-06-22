const mqtt = require("../../utils/mqtt-lite");

const app = getApp();
const HISTORY_KEY = "careguard.telemetry.history";
const DEFAULT_LAT = 45.750516;
const DEFAULT_LNG = 126.628947;

function clampHistory(history) {
  return history.slice(-60);
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function firstDefined() {
  for (let index = 0; index < arguments.length; index += 1) {
    if (arguments[index] !== undefined && arguments[index] !== null) {
      return arguments[index];
    }
  }
  return undefined;
}

function formatTime(timestamp = Date.now()) {
  const date = new Date(timestamp);
  return [
    String(date.getHours()).padStart(2, "0"),
    String(date.getMinutes()).padStart(2, "0"),
    String(date.getSeconds()).padStart(2, "0")
  ].join(":");
}

function buildMapMarkers(lat, lng, isAlarm = false) {
  return [{
    id: 1,
    latitude: lat,
    longitude: lng,
    title: isAlarm ? "宠物位置异常" : "宠物当前位置",
    width: 30,
    height: 30,
    callout: {
      content: isAlarm ? "体征预警" : "小七",
      color: "#1f2328",
      fontSize: 12,
      borderRadius: 8,
      bgColor: "#ffffff",
      padding: 7,
      display: "ALWAYS"
    }
  }];
}

Page({
  data: {
    connected: false,
    connecting: false,
    alarmActive: false,
    alarmMuted: false,
    statusLabel: "等待连接",
    statusClass: "status-wait",
    connectButtonLabel: "连接",
    alarmMuteLabel: "静音",
    alarmMetricClass: "",
    tempMetricClass: "",
    lastUpdated: "--:--:--",
    telemetry: {
      state: "等待数据",
      displayState: "等待数据",
      hr: 0,
      temp: 0,
      battery: 100,
      lat: DEFAULT_LAT,
      lng: DEFAULT_LNG,
      source: "none"
    },
    mapMarkers: buildMapMarkers(DEFAULT_LAT, DEFAULT_LNG),
    alertMessage: "",
    historyCount: 0,
    logs: [
      { id: 0, time: "--:--:--", type: "系统", text: "小程序控制台待命。" }
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
    if (app.globalData.useCloudRelay) {
      this.startCloudSync();
    } else {
      this.connectBroker();
    }
  },

  onUnload() {
    this.stopCloudSync();
    if (this.client) {
      this.client.end(true);
      this.client = null;
    }
  },

  startCloudSync() {
    if (!wx.cloud) {
      this.appendLog("纠错", "当前基础库不支持云开发，切换 MQTT 备用链路。");
      this.connectBroker();
      return;
    }

    this.setData({
      connected: true,
      connecting: false,
      statusLabel: "云端同步",
      statusClass: "status-ok",
      connectButtonLabel: "在线"
    });
    this.appendLog("系统", "已启用 CloudBase 云端同步。");
    this.fetchLatestTelemetry();
    this.cloudTimer = setInterval(() => this.fetchLatestTelemetry(), 2500);
  },

  stopCloudSync() {
    if (this.cloudTimer) {
      clearInterval(this.cloudTimer);
      this.cloudTimer = null;
    }
  },

  fetchLatestTelemetry() {
    wx.cloud.callFunction({
      name: "getLatestTelemetry",
      success: response => {
        const telemetry = response.result && response.result.telemetry;
        if (!telemetry) {
          this.setData({ statusLabel: "等待数据" });
          return;
        }
        const telemetryKey = telemetry.recordedAt || telemetry.timestamp || "";
        if (telemetryKey && telemetryKey === this.lastCloudTelemetryKey) return;
        this.lastCloudTelemetryKey = telemetryKey;
        this.processTelemetry(telemetry);
      },
      fail: error => {
        this.setData({
          connected: false,
          connecting: false,
          statusLabel: "同步异常",
          statusClass: "status-wait",
          connectButtonLabel: "连接"
        });
        this.appendLog("纠错", `云端同步失败: ${error.errMsg || "未知错误"}`);
      }
    });
  },

  connectBroker() {
    if (this.client || this.data.connecting) return;

    this.domainBlocked = false;
    const { brokerUrl, telemetryTopic, alertTopic } = app.globalData;
    const clientId = `WX_CareGuard_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
    this.setData({ connecting: true, statusLabel: "连接中", statusClass: "status-wait" });
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
        statusLabel: "实时监听",
        statusClass: "status-ok",
        connectButtonLabel: "在线"
      });
      this.client.subscribe([telemetryTopic, alertTopic], { qos: 0 });
      this.appendLog("系统", "已订阅遥测与报警主题。");
    });

    this.client.on("reconnect", () => {
      this.setData({ connected: false, connecting: true, statusLabel: "重连中", statusClass: "status-wait" });
    });

    this.client.on("close", () => {
      if (this.domainBlocked) {
        this.client = null;
        this.setData({
          connected: false,
          connecting: false,
          statusLabel: "域名未配置",
          statusClass: "status-wait",
          connectButtonLabel: "连接"
        });
        return;
      }
      this.setData({
        connected: false,
        connecting: false,
        statusLabel: "连接断开",
        statusClass: "status-wait",
        connectButtonLabel: "连接"
      });
    });

    this.client.on("error", error => {
      const message = error.message || "未知错误";
      if (message.includes("domain list")) {
        this.domainBlocked = true;
        this.setData({
          connected: false,
          connecting: false,
          statusLabel: "域名未配置",
          statusClass: "status-wait",
          connectButtonLabel: "连接"
        });
        this.appendLog("纠错", "真机需在微信后台配置 Socket 合法域名。");
        return;
      }

      this.appendLog("纠错", `MQTT 连接异常: ${message}`);
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
      payload = Object.assign({}, payload, {
        isAlarm: true,
        state: payload.state || "异常体温预警",
        displayState: "状态预警"
      });
    }

    this.processTelemetry(payload);
  },

  processTelemetry(payload) {
    const hr = toNumber(firstDefined(payload.hr, payload.heartRate, payload.bpm));
    const temp = toNumber(firstDefined(payload.temp, payload.temperature), 38.5);
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
      lat: toNumber(firstDefined(payload.lat, payload.latitude), this.data.telemetry.lat),
      lng: toNumber(firstDefined(payload.lng, payload.lon, payload.longitude), this.data.telemetry.lng),
      source: payload.source || (payload.isSimulator ? "simulator" : "hardware")
    };

    this.persistTelemetry(nextTelemetry);
    this.setData({
      telemetry: nextTelemetry,
      mapMarkers: buildMapMarkers(nextTelemetry.lat, nextTelemetry.lng, isAlarm),
      lastUpdated: formatTime(payload.timestamp || Date.now()),
      statusLabel: isAlarm ? "异常预警" : "体征正常",
      statusClass: isAlarm ? "status-wait" : "status-ok",
      alarmActive: isAlarm,
      alarmMetricClass: isAlarm ? "danger" : "",
      tempMetricClass: nextTelemetry.temp > 40 ? "danger" : "",
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

    if (app.globalData.useCloudRelay && wx.cloud) {
      wx.cloud.callFunction({
        name: "pushCommand",
        data: Object.assign({}, payload, { desc }),
        success: response => {
          if (response.result && response.result.ok === false) {
            wx.showToast({ title: "指令失败", icon: "none" });
            return;
          }
          this.appendLog("操作", `已同步 ${code}: ${desc}`);
          wx.showToast({ title: "指令已发送", icon: "success" });
        },
        fail: error => {
          this.appendLog("纠错", `云端指令失败: ${error.errMsg || "未知错误"}`);
          wx.showToast({ title: "指令失败", icon: "none" });
        }
      });
      return;
    }

    if (!this.client || !this.data.connected) {
      wx.showToast({ title: "链路未连接", icon: "none" });
      return;
    }

    this.client.publish(controlTopic, JSON.stringify(payload), { qos: 0 });
    this.appendLog("操作", `已下发 ${code}: ${desc}`);
    wx.showToast({ title: "指令已发送", icon: "success" });
  },

  toggleMute() {
    const alarmMuted = !this.data.alarmMuted;
    this.setData({
      alarmMuted,
      alarmMuteLabel: alarmMuted ? "取消静音" : "静音"
    });
    wx.showToast({
      title: alarmMuted ? "报警已静音" : "报警震动已开启",
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
    this.nextLogId = (this.nextLogId || 0) + 1;
    const logs = [
      ...this.data.logs,
      { id: this.nextLogId, time: formatTime(), type, text }
    ].slice(-6);
    this.setData({ logs });
  }
});
