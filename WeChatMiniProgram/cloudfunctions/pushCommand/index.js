const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

exports.main = async (event = {}) => {
  const command = {
    command: String(event.command || ""),
    desc: String(event.desc || ""),
    operator: String(event.operator || "WX_Guardian_Center"),
    timestamp: Number(event.timestamp || Date.now()),
    createdAt: db.serverDate()
  };

  if (!command.command) {
    return {
      ok: false,
      error: "command is required"
    };
  }

  try {
    await db.collection("commands").add({ data: command });
  } catch (error) {
    return {
      ok: true,
      command,
      warnings: ["commands collection is unavailable"]
    };
  }

  return {
    ok: true,
    command
  };
};
