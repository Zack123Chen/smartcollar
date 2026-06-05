function utf8Bytes(text) {
  if (typeof TextEncoder !== "undefined") {
    return Array.from(new TextEncoder().encode(String(text)));
  }

  const encoded = unescape(encodeURIComponent(String(text)));
  const bytes = [];
  for (let index = 0; index < encoded.length; index += 1) {
    bytes.push(encoded.charCodeAt(index));
  }
  return bytes;
}

function utf8Text(bytes) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (typeof TextDecoder !== "undefined") {
    return new TextDecoder("utf-8").decode(view);
  }

  let binary = "";
  for (let index = 0; index < view.length; index += 1) {
    binary += String.fromCharCode(view[index]);
  }
  return decodeURIComponent(escape(binary));
}

function encodeString(text) {
  const bytes = utf8Bytes(text);
  return [bytes.length >> 8, bytes.length & 0xff].concat(bytes);
}

function encodeRemainingLength(length) {
  const bytes = [];
  let value = length;

  do {
    let encodedByte = value % 128;
    value = Math.floor(value / 128);
    if (value > 0) encodedByte |= 128;
    bytes.push(encodedByte);
  } while (value > 0);

  return bytes;
}

function packet(type, body) {
  const bytes = [type].concat(encodeRemainingLength(body.length), body);
  return new Uint8Array(bytes).buffer;
}

function parsePackets(data) {
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data || []);
  const packets = [];
  let offset = 0;

  while (offset < bytes.length) {
    const header = bytes[offset++];
    let multiplier = 1;
    let length = 0;
    let encodedByte = 0;

    do {
      if (offset >= bytes.length) return packets;
      encodedByte = bytes[offset++];
      length += (encodedByte & 127) * multiplier;
      multiplier *= 128;
    } while ((encodedByte & 128) !== 0);

    const end = offset + length;
    if (end > bytes.length) return packets;
    packets.push({ type: header >> 4, flags: header & 0x0f, body: bytes.slice(offset, end) });
    offset = end;
  }

  return packets;
}

function buildConnect(options) {
  const keepalive = options.keepalive || 30;
  const body = []
    .concat(encodeString("MQTT"))
    .concat([4, 2, keepalive >> 8, keepalive & 0xff])
    .concat(encodeString(options.clientId));
  return packet(0x10, body);
}

function buildSubscribe(packetId, topics) {
  const filters = topics.reduce((result, topic) => result.concat(encodeString(topic), [0]), []);
  return packet(0x82, [packetId >> 8, packetId & 0xff].concat(filters));
}

function buildPublish(topic, message) {
  const payload = message instanceof ArrayBuffer
    ? Array.from(new Uint8Array(message))
    : utf8Bytes(message);
  return packet(0x30, encodeString(topic).concat(payload));
}

function normalizeUrl(url) {
  return String(url || "").replace(/^wxs:\/\//, "wss://").replace(/^wx:\/\//, "ws://");
}

function createEmitter() {
  const listeners = {};
  return {
    on(event, handler) {
      listeners[event] = listeners[event] || [];
      listeners[event].push(handler);
      return this;
    },
    emit(event) {
      const args = Array.prototype.slice.call(arguments, 1);
      (listeners[event] || []).forEach(handler => handler.apply(null, args));
    }
  };
}

function connect(url, options) {
  return new MiniMqttClient(url, options || {});
}

class MiniMqttClient {
  constructor(url, options) {
    this.url = normalizeUrl(url);
    this.options = options;
    this.emitter = createEmitter();
    this.packetId = 1;
    this.subscriptions = [];
    this.manualClose = false;
    this.connected = false;
    this.connectTimer = null;
    this.pingTimer = null;
    this.reconnectTimer = null;
    this.openSocket();
  }

  on(event, handler) {
    this.emitter.on(event, handler);
    return this;
  }

  emit(event) {
    const args = Array.prototype.slice.call(arguments, 1);
    this.emitter.emit.apply(this.emitter, [event].concat(args));
  }

  openSocket() {
    this.clearReconnect();
    this.socket = wx.connectSocket({
      url: this.url,
      protocols: ["mqtt"]
    });

    this.connectTimer = setTimeout(() => {
      this.emit("error", new Error("MQTT connect timeout"));
      this.closeSocket();
    }, this.options.connectTimeout || 8000);

    this.socket.onOpen(() => {
      this.send(buildConnect({
        clientId: this.options.clientId || `WX_CareGuard_${Date.now()}`,
        keepalive: this.options.keepalive || 30
      }));
    });

    this.socket.onMessage(event => {
      parsePackets(event.data).forEach(item => this.handlePacket(item));
    });

    this.socket.onError(error => {
      const message = error.errMsg || "MQTT socket error";
      this.emit("error", new Error(message));
      if (String(message).includes("domain list")) {
        this.manualClose = true;
        this.closeSocket();
      }
    });

    this.socket.onClose(() => {
      const wasConnected = this.connected;
      this.connected = false;
      this.clearTimers();
      this.emit("close");
      if (!this.manualClose) {
        if (wasConnected) this.emit("reconnect");
        this.scheduleReconnect();
      }
    });
  }

  handlePacket(item) {
    if (item.type === 2) {
      clearTimeout(this.connectTimer);
      const returnCode = item.body[1];
      if (returnCode !== 0) {
        this.emit("error", new Error(`MQTT CONNACK failed: ${returnCode}`));
        this.closeSocket();
        return;
      }

      this.connected = true;
      this.emit("connect");
      this.startPing();
      if (this.subscriptions.length) this.subscribe(this.subscriptions);
      return;
    }

    if (item.type === 3) {
      const topicLength = (item.body[0] << 8) + item.body[1];
      const topic = utf8Text(item.body.slice(2, 2 + topicLength));
      const payload = item.body.slice(2 + topicLength).buffer;
      this.emit("message", topic, {
        toString() {
          return utf8Text(payload);
        }
      });
      return;
    }

    if (item.type === 13) {
      return;
    }
  }

  subscribe(topics) {
    const list = Array.isArray(topics) ? topics : [topics];
    this.subscriptions = Array.from(new Set(this.subscriptions.concat(list)));
    if (!this.connected) return;
    this.send(buildSubscribe(this.nextPacketId(), list));
  }

  publish(topic, message) {
    if (!this.connected) {
      this.emit("error", new Error("MQTT socket is not connected"));
      return;
    }
    this.send(buildPublish(topic, message));
  }

  end() {
    this.manualClose = true;
    if (this.connected) this.send(packet(0xe0, []));
    this.closeSocket();
  }

  send(data) {
    if (!this.socket) return;
    this.socket.send({
      data,
      fail: error => this.emit("error", new Error(error.errMsg || "MQTT send failed"))
    });
  }

  startPing() {
    clearInterval(this.pingTimer);
    this.pingTimer = setInterval(() => {
      if (this.connected) this.send(packet(0xc0, []));
    }, Math.max(10, this.options.keepalive || 30) * 500);
  }

  scheduleReconnect() {
    const delay = this.options.reconnectPeriod || 3000;
    this.reconnectTimer = setTimeout(() => this.openSocket(), delay);
  }

  nextPacketId() {
    this.packetId += 1;
    if (this.packetId > 65535) this.packetId = 1;
    return this.packetId;
  }

  closeSocket() {
    if (this.socket) {
      this.socket.close({});
      this.socket = null;
    }
  }

  clearReconnect() {
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  clearTimers() {
    clearTimeout(this.connectTimer);
    clearInterval(this.pingTimer);
    this.connectTimer = null;
    this.pingTimer = null;
  }
}

module.exports = { connect };
