# CareGuard Live · 宠爱云护

宠爱云护智能宠物项圈实时监测控制台。项目用于校赛答辩展示与硬件联调，支持地图寻宠、生命体征曲线、MQTT 数据监听、远程控制、仿真演示、历史轨迹复盘和 AI 健康建议面板。

---

## 创新点 / Highlights

> 以下可直接摘录进项目报告。

### 1. 真实 / 仿真「双模式隔离」引擎

控制台同时面向**物理单片机联调**和**无硬件答辩演示**两种场景，二者通过一枚 `isSimulator` 报文印章彻底隔离：

- **真实硬件模式**：只处理无 `isSimulator` 标记的物理项圈报文，主动丢弃一切仿真消息，避免 MQTT 公共中继上的回环数据污染硬件调试。
- **仿真演示模式**：本地生成带 `isSimulator: true` 的虚拟遥测，可一键切换"熟睡 / 日常慢步 / 快速奔跑 / 高热预警"四种行为场景。

切换模式时自动复位相关 UI 状态，做到"演示数据绝不冒充真实读数"。

### 2. 多源异构遥测归一化（协议未定也能接）

`telemetry.js` 实现了一个容错解析层，硬件通信协议尚未固定时即可对接：

- 同时支持 **JSON** 与 **MCU key-value 文本日志**（如 `hr=76 temp=38.4 lat=45.75 status=active`）。
- 大量字段**别名映射**：心率 `hr/heartRate/heart_rate/bpm/pulse`、经纬度 `lng/lon/longitude/gps_lng/...`、嵌套 `location` 对象、`coords` 数组等全部归一。
- 异常报文不崩溃，降级记录到行动日志。

### 3. AI 健康分析 + 本地规则「双保险」

- 接入 **DeepSeek** 做生命体征健康分析，密钥经**后端代理**注入，**绝不打进前端包**。
- 后端不可用 / 未配密钥时，自动降级到**本地规则诊断**，演示永不开天窗。
- AI 返回的 Markdown 报告按语义分段渲染（总体判断 / 风险信号 / 后续观察进主框，行动建议、饮水饮食进独立卡片，互不重复）。

### 4. 纯浏览器端数据持久化

基于 **IndexedDB** 在本地存储实时遥测样本与运动档案，无需后端数据库即可复盘历史轨迹、统计条数、一键导出 JSON 数据包。

### 5. 实时可视化套件

Leaflet 地图寻宠 + **Haversine 球面距离**累计里程 + Chart.js 双轴（心率 / 体温）生命体征曲线 + 状态异常时镜头自动跟随。

### 6. 工程严谨性：诚实数据 + 安全加固

- **诚实数据原则**：硬件无电量检测能力时，KPI 显示「未接入」而非伪造 100%。
- **安全**：后端代理隔离密钥；前端对公共 MQTT 中继（不可信输入）的所有渲染做 HTML 转义，防止 XSS 注入。

### 7. 零部署演示能力

GitHub Pages 纯静态托管即可运行（仿真 + 本地规则健康建议全部可用），AI 在线分析仅需本地后端。

---

## Project Structure

```text
Fronter/
├── index.html              # Vite 应用入口（大屏 UI 结构）
├── server.mjs              # 生产静态服务 + AI 分析接口
├── server/
│   └── deepseek.js         # DeepSeek 后端代理，不向前端暴露密钥
├── WeChatMiniProgram/      # 微信小程序端，订阅 Web 仿真报警与遥测数据
├── src/
│   ├── main.js             # 地图、图表、MQTT、仿真与交互主逻辑
│   ├── storage.js          # IndexedDB 本地遥测与档案存储
│   ├── telemetry.js        # 硬件/仿真报文解析与字段归一化
│   └── styles.css          # Tailwind 入口与大屏视觉样式
├── tests/
│   └── telemetry.test.mjs  # 遥测归一化单元测试
├── realdata_ver3.html      # 旧版单文件页面，保留作历史备份
├── package.json
├── tailwind.config.cjs
├── postcss.config.cjs
└── vite.config.js
```

## Commands

```bash
npm install
npm run dev          # 开发预览（含 /api/health-analysis），默认 http://localhost:5173/
npm run build        # 生产构建，输出 dist/
npm run build:pages  # GitHub Pages 静态构建（base = /smartcollar/）
npm run preview      # 预览构建产物
npm run serve        # 读取 dist/ 并提供 AI 接口，适合构建后本地演示
npm test             # 运行单元测试（node --test）
```

`npm run serve` 会读取 `dist/` 并提供 `/api/health-analysis`，适合构建后本地演示。服务默认只监听 `127.0.0.1`；确实需要局域网联调时可临时使用 `HOST=0.0.0.0 npm run dev` 或 `HOST=0.0.0.0 npm run serve`。

GitHub Pages 发布地址：`https://zack123chen.github.io/smartcollar/`

> 注意：GitHub Pages 只托管静态前端，AI 健康分析的 DeepSeek 后端代理需要在本地 `npm run dev` 或 `npm run serve` 下运行。

## WeChat Mini Program

小程序目录：`WeChatMiniProgram/`

导入微信开发者工具后，先安装依赖：

```bash
cd WeChatMiniProgram
npm install
```

然后在微信开发者工具里执行“工具 -> 构建 npm”。

Web 前端的“模拟 -> 推送小程序报警”按钮会向 `HIT/PetAlert` 发布报警消息，并同步写入 `HIT/PetData`。小程序收到后会震动、弹窗，并保持预警状态直到收到正常体征数据。

## Local Storage

应用会把实时遥测样本与运动档案写入浏览器 IndexedDB：

- `telemetry`：心率、体温、电量、GPS、状态、来源、预警标记
- `missions`：运动档案、平均心率、最高体温、里程和轨迹

历史档案面板会显示已存遥测条数，并支持导出 JSON 数据包。

## AI Health Analysis

AI 健康分析通过后端代理调用 DeepSeek，密钥只放在本地环境变量中，不会打进前端包。

复制 `.env.local.example` 为 `.env.local`，填写：

```bash
DEEPSEEK_API_KEY=你的 DeepSeek Key
DEEPSEEK_MODEL=deepseek-chat
DEEPSEEK_API_URL=https://api.deepseek.com/chat/completions
```

开发模式 `npm run dev` 会直接挂载 `/api/health-analysis`；构建后用 `npm run serve` 访问同一接口。若未配置密钥，页面会自动回退到本地规则健康建议。

## Data Channel

默认监听 EMQX 公共中继：

- Telemetry topic: `HIT/PetData`
- Alert topic: `HIT/PetAlert`
- Control topic: `HIT/PetControl`
- Web broker: `broker-cn.emqx.io:8083`（HTTP）/ `broker-cn.emqx.io:8084`（HTTPS/WSS）
- 小程序 broker: `wxs://broker-cn.emqx.io:8084/mqtt`

仿真演示模式会给本地虚拟数据包添加 `isSimulator: true` 标记，真实硬件模式会过滤仿真报文，避免展示数据污染硬件联调。

> 安全提示：当前使用 EMQX **公共** broker，任何人都可向上述话题发布消息。前端已对所有外部报文渲染做 HTML 转义；正式部署建议改用私有 broker + 鉴权。
