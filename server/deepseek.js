import fs from "node:fs";
import path from "node:path";

export function loadLocalEnv(root = process.cwd()) {
  for (const filename of [".env.local", ".env"]) {
    const file = path.join(root, filename);
    if (!fs.existsSync(file)) continue;

    const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const equalsAt = trimmed.indexOf("=");
      if (equalsAt === -1) continue;
      const key = trimmed.slice(0, equalsAt).trim();
      const value = trimmed.slice(equalsAt + 1).trim().replace(/^["']|["']$/g, "");
      if (key && process.env[key] === undefined) process.env[key] = value;
    }
  }
}

export function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function summarizeSamples(samples = []) {
  if (!samples.length) return "暂无历史样本";
  return samples
    .slice(-20)
    .map(sample => {
      const time = sample.recordedAt || sample.timestamp || "";
      const battery = sample.battery == null ? "未接入" : `${sample.battery}%`;
      return `${time} 状态=${sample.state}, 心率=${sample.hr}BPM, 体温=${sample.temp}°C, 电量=${battery}, GPS=${sample.hasGps ? `${sample.lng},${sample.lat}` : "无"}`;
    })
    .join("\n");
}

export async function analyzePetHealth({ current, recent = [], profile = {} }) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    const error = new Error("DEEPSEEK_API_KEY is not configured");
    error.statusCode = 500;
    throw error;
  }

  const model = process.env.DEEPSEEK_MODEL || "deepseek-chat";
  const apiUrl = process.env.DEEPSEEK_API_URL || "https://api.deepseek.com/chat/completions";
  const messages = [
    {
      role: "system",
      content: [
        "你是宠物健康监测产品中的 AI 健康分析助手。",
        "请用中文输出，风格冷静、简洁、可执行。",
        "不要做确定性诊断，不替代兽医；遇到高风险指标要建议线下就医或联系兽医。",
        "输出结构固定为：总体判断、风险信号、行动建议、饮水饮食、后续观察。"
      ].join("")
    },
    {
      role: "user",
      content: [
        `宠物资料：${JSON.stringify(profile || {})}`,
        `当前体征：${JSON.stringify(current || {})}`,
        "最近体征样本：",
        summarizeSamples(recent)
      ].join("\n")
    }
  ];

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.35,
      max_tokens: 900,
      stream: false
    })
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(result?.error?.message || `DeepSeek request failed with ${response.status}`);
    error.statusCode = response.status;
    throw error;
  }

  return {
    analysis: result?.choices?.[0]?.message?.content || "AI 未返回有效分析。",
    model,
    generatedAt: new Date().toISOString()
  };
}
