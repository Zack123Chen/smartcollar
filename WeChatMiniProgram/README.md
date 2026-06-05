# SmartCollar 微信小程序

这是 `smartcollar` 的微信小程序端，用于接收 Web 前端仿真报警、查看宠物生命体征，并下发远程控制指令。

## 导入方式

1. 打开微信开发者工具。
2. 选择“导入项目”。
3. 项目目录选择 `Fronter/WeChatMiniProgram`。
4. AppID 可先使用测试号或当前项目的正式小程序 AppID。
5. 在微信开发者工具里执行“工具 -> 构建 npm”。
6. 本地调试时可勾选“不校验合法域名、web-view、TLS 版本以及 HTTPS 证书”。

## MQTT 主题

小程序和 Web 前端使用同一组 EMQX 公共中继主题：

- 遥测订阅：`HIT/PetData`
- 报警订阅：`HIT/PetAlert`
- 控制下发：`HIT/PetControl`
- Broker：`wxs://broker-cn.emqx.io:8084/mqtt`

Web 前端点击“推送小程序报警”后，会向 `HIT/PetAlert` 发送报警消息，并同步写入 `HIT/PetData`。小程序收到报警后会保持预警状态，直到收到恢复正常的体征数据。

## 正式发布注意

微信真机发布前，需要在小程序后台配置 socket 合法域名：

`wxs://broker-cn.emqx.io`

如果只用于校赛本地演示，可以在开发者工具里关闭合法域名校验。
