# SmartCollar 微信小程序

这是 `smartcollar` 的微信小程序端，用于接收 Web 前端仿真报警、查看宠物生命体征，并下发远程控制指令。

## 导入方式

1. 打开微信开发者工具。
2. 选择“导入项目”。
3. 项目目录选择 `Fronter/WeChatMiniProgram`。
4. 公开仓库默认使用 `touristappid`，本地导入后再把 `project.config.json` 里的 AppID 替换为你自己的小程序 AppID。
5. 开通并绑定微信云开发环境。
6. 分别右键 `cloudfunctions/pushTelemetry`、`cloudfunctions/getLatestTelemetry`、`cloudfunctions/pushCommand`，选择“上传并部署：云端安装依赖”。
7. 直接编译预览；当前小程序端不需要执行“工具 -> 构建 npm”。

## CloudBase 数据链路

正式版小程序默认通过 CloudBase 同步数据：

- `latestTelemetry/current`：最新体征
- `alerts`：报警记录
- `commands`：远程控制记录

小程序前台每 2.5 秒调用 `getLatestTelemetry`。Web 前端点击“推送小程序报警”后，经后端 `/api/mini-relay` 调用 `pushTelemetry`，小程序收到报警后会保持预警状态，直到收到恢复正常的体征数据。

项目仍保留 MQTT 备用链路，必要时可在 `app.js` 中将 `useCloudRelay` 改为 `false` 进行开发者工具调试。

## 正式发布注意

1. 确认三个云函数已部署。
2. 微信开发者工具点击“上传”，版本号建议 `1.0.0`。
3. 微信公众平台“版本管理”中设为体验版，先用手机扫码验收。
4. 验收通过后提交审核，审核通过再发布。
