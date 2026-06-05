const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

exports.main = async () => {
  try {
    const result = await db.collection("latestTelemetry").doc("current").get();
    return {
      ok: true,
      telemetry: result.data || null
    };
  } catch (error) {
    return {
      ok: true,
      telemetry: null
    };
  }
};
