# AGENTS.md · CareGuard Live

> 给在本仓库工作的 AI 的速读手册。开工前先读完本文件，能避开本项目特有的坑。

## 这是什么

智能宠物项圈的**实时监测大屏**（Web 前端 + 轻量 Node 后端代理）。校赛答辩展示 + 硬件联调用。
核心能力：地图寻宠、生命体征曲线、MQTT 遥测、远程控制、仿真演示、IndexedDB 历史复盘、AI 健康建议。

## 技术栈

- **构建**：Vite 8（原生 JS，**无框架**，非 React/Vue/TS）
- **样式**：Tailwind 3 + 自定义 CSS（`src/styles.css`）
- **库**：Leaflet（地图）、Chart.js（曲线）、paho-mqtt（MQTT over WebSocket）、lucide（图标）
- **后端**：Node 原生 `http`（`server.mjs`），仅一个接口 `/api/health-analysis`
- **存储**：浏览器 IndexedDB（无服务端数据库）
- **测试**：`node --test`（`tests/telemetry.test.mjs` + `tests/security.test.mjs`）

## 目录与职责

| 文件 | 职责 |
|---|---|
| `index.html` | 大屏 UI 结构；按钮通过 `onclick="xxx()"` 调用 `window` 上挂的函数 |
| `src/main.js` | **主逻辑**（~1200 行）：地图、图表、MQTT、仿真器、AI 渲染、模式切换。文件末尾 `Object.assign(window, {...})` 暴露给 HTML 的函数 |
| `src/telemetry.js` | 报文解析 + 字段归一化（**纯函数，有单测**） |
| `src/storage.js` | IndexedDB 读写（telemetry / missions 两个 store） |
| `server/deepseek.js` | DeepSeek 代理 + `.env` 加载 + 请求体解析（被 `server.mjs` 和 `vite.config.js` 共用） |
| `server/security.js` | AI 接口来源校验 + 静态文件目录边界校验 |
| `server.mjs` | 生产静态服务 + AI 接口 |
| `vite.config.js` | dev 期通过中间件挂载同一个 AI 接口；`base` 随 `GITHUB_PAGES` 切换 |

## 数据流（务必理解）

```
MQTT(HIT/PetData) ┐
                  ├─ parseTelemetryMessage → normalizeTelemetryPayload → processIncomingTelemetry → 渲染(KPI/地图/图表/日志) + 存 IndexedDB
仿真器(2s/tick)   ┘
                                                                         ↘ updateAIRecommendationsSilent(仅仿真)
AI 分析: startBioScan → runAiHealthAnalysis → POST /api/health-analysis → deepseek.js → DeepSeek
                                            (失败则降级 generateComplexDiagnosis 本地规则)
```

## 关键约定 / 易踩的坑

1. **真实 vs 仿真双模式隔离**：每条仿真报文带 `isSimulator: true`。
   - 真实模式 (`isDemoMode=false`) 只处理**无**该标记的报文；仿真模式只处理**有**标记的。
   - 改 MQTT/遥测逻辑时别破坏这个过滤（`onMessageArrived` 内），否则演示数据会污染硬件联调。

2. **公共 MQTT broker = 不可信输入**：`broker-cn.emqx.io` 任何人可发布。
   - **凡是外部报文字段进 `innerHTML` / `setPopupContent`，必须过 `escapeHtml()`**（`main.js` 内已有该函数）。`state` 字段尤其危险（未匹配时原样返回）。新增渲染点务必遵守。

3. **电量「诚实数据」约定**：硬件**没有**电量检测。
   - `telemetry.js` 中电量缺失为 `battery: null` + `hasBattery: false`，UI 显示「未接入」，**不要伪造数值**。
   - 仿真器用模块级浮点 `simBattery` 累计耗电（别再用 DOM 读回的整数算，会因 `round` 回弹卡死）。

4. **密钥安全**：DeepSeek key 只在 `.env.local`（已 gitignore），经后端代理使用，**绝不能进前端 bundle**。

5. **AI 接口不要重新裸奔**：`server/security.js` 现在负责 `/api/health-analysis` 的来源校验。
   - 默认 dev / preview / serve 都只监听 `127.0.0.1`。
   - 局域网演示需要显式 `HOST=0.0.0.0 npm run dev` 或 `HOST=0.0.0.0 npm run serve`。
   - 保持同源浏览器请求可用，拦截远程无 Origin / 跨 Origin 的直接滥用。

6. **静态文件路径边界**：`server.mjs` 使用 `isPathInsideDirectory()` 判断 `dist/` 内文件，别退回 `startsWith(distDir)`，否则会重新引入同前缀目录绕过。

7. **HTML 调函数靠 window**：新增供按钮调用的函数，记得加进 `main.js` 末尾的 `Object.assign(window, {...})`。

8. **AI 报告分段**：主框 (`reportConclusion`) 用 `buildConclusionHtml` 渲染，会**剔除**「行动建议/饮水饮食」段（它们进独立小框），避免重复。改动 AI 渲染时注意别让内容重复。

## 命令

```bash
npm run dev     # 开发（含 AI 接口），默认 http://127.0.0.1:5173/
npm test        # 单测（改 telemetry.js 后必跑）
npm run build   # 生产构建
npm run serve   # 跑 dist/ + AI 接口
```

> 用预览/截图工具时，仓库已有 `.claude/launch.json`（server 名 `careguard-dev`，端口 5173）。

## 工作纪律

- **改前先读**相关文件，确认数据流再动手。
- 改 `telemetry.js`、`server/security.js` 或 `/api/health-analysis` 相关逻辑后**必须 `npm test`**；改前端逻辑后**必须 `npm run build`** 确认无误，最好用浏览器实跑一遍仿真场景。
- 中文优先回复；提交信息说清楚"改了什么 + 为什么"。

## 已知待办（非紧急）

- bundle ~792KB：Leaflet/Chart.js 可改动态 `import()` 懒加载以瘦身。
- `main.js` 偏大（>1200 行），可按模块拆分（地图 / 图表 / MQTT / 仿真 / AI）。
- `clientId` 用了废弃的 `substr`，可换 `crypto.randomUUID()`。
