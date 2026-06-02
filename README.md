# CareGuard Live

宠爱云护智能宠物项圈实时监测控制台。项目用于校赛答辩展示与硬件联调，支持地图寻宠、生命体征曲线、MQTT 数据监听、远程控制、仿真演示、历史轨迹复盘和健康建议面板。

## Project Structure

```text
Fronter/
├── index.html              # Vite 应用入口
├── server.mjs              # 生产静态服务与 AI 分析接口
├── server/
│   └── deepseek.js         # DeepSeek 后端代理，不向前端暴露密钥
├── src/
│   ├── main.js             # 地图、图表、MQTT、仿真与交互逻辑
│   ├── storage.js          # IndexedDB 本地遥测与档案存储
│   ├── telemetry.js        # 硬件/仿真报文解析与标准化
│   └── styles.css          # Tailwind 入口与大屏视觉样式
├── realdata_ver3.html      # 旧版单文件页面，保留作历史备份
├── package.json
├── tailwind.config.cjs
├── postcss.config.cjs
└── vite.config.js
```

## Commands

```bash
npm install
npm run dev
npm run build
npm run build:pages
npm run preview
npm run serve
```

开发预览默认地址：`http://localhost:5173/`

生产构建输出目录：`dist/`

`npm run serve` 会读取 `dist/` 并提供 `/api/health-analysis`，适合构建后本地演示。

GitHub Pages 静态构建使用 `npm run build:pages`，发布地址：

`https://zack123chen.github.io/smartcollar/`

注意：GitHub Pages 只托管静态前端，AI 健康分析的 DeepSeek 后端代理需要在本地 `npm run dev` 或 `npm run serve` 下运行。

## Local Storage

应用会把实时遥测样本与运动档案写入浏览器 IndexedDB：

- telemetry: 心率、体温、电量、GPS、状态、来源、预警标记
- missions: 运动档案、平均心率、最高体温、里程和轨迹

历史档案面板会显示已存遥测条数，并支持导出 JSON 数据包。

## AI Health Analysis

AI 健康分析通过后端代理调用 DeepSeek，密钥只放在本地环境变量中，不会打进前端包。

复制 `.env.local.example` 为 `.env.local`，填写：

```bash
DEEPSEEK_API_KEY=你的 DeepSeek Key
DEEPSEEK_MODEL=deepseek-chat
```

开发模式 `npm run dev` 会直接挂载 `/api/health-analysis`；构建后用 `npm run serve` 访问同一接口。若未配置密钥，页面会自动回退到本地规则健康建议。

## Data Channel

默认监听 EMQX 公共中继：

- Telemetry topic: `HIT/PetData`
- Control topic: `HIT/PetControl`
- Broker: `broker-cn.emqx.io:8083`

仿真演示模式会给本地虚拟数据包添加 `isSimulator: true` 标记，真实硬件模式会过滤仿真报文，避免展示数据污染硬件联调。
