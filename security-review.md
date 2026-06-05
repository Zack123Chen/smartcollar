# Security Review

Date: 2026-06-05

Scope:

- Web frontend and Vite/Node AI proxy
- WeChat mini program client
- MQTT telemetry, alert, and control message flow
- Local storage and static hosting path handling

## Threat Model

Primary assets:

- DeepSeek API key stored in local `.env.local`
- AI health-analysis endpoint
- Pet telemetry and locally persisted movement/health history
- MQTT control topic for collar commands
- WeChat mini program alarm surface

Trust boundaries:

- Public EMQX MQTT broker is untrusted input.
- Browser-rendered MQTT telemetry can be attacker-controlled.
- GitHub Pages is static-only and cannot protect secrets.
- Local AI proxy is trusted only when bound to loopback or explicitly exposed for LAN demo.

## Findings

### Fixed: local AI proxy exposed by default dev scripts

Severity: Medium

`package.json` previously forced `vite --host 0.0.0.0` and `vite preview --host 0.0.0.0`. That exposed the local app and `/api/health-analysis` to the LAN by default. The AI endpoint has origin checks, but default LAN exposure still increases the chance of unintended key-backed model usage from nearby devices.

Resolution:

- `npm run dev` now uses `vite`.
- `npm run preview` now uses `vite preview`.
- `vite.config.js` already defaults `HOST` to `127.0.0.1`.
- LAN demos remain explicit via `HOST=0.0.0.0 npm run dev`.

### Residual: public MQTT broker allows spoofed telemetry, alarms, and controls

Severity: Medium for demo, High if used with real devices/users

The app intentionally uses `broker-cn.emqx.io` with public topics:

- `HIT/PetData`
- `HIT/PetAlert`
- `HIT/PetControl`

Anyone who knows or guesses these topic names can publish fake telemetry or alarm messages. If a real collar consumes `HIT/PetControl`, an attacker could also send control commands.

Current controls:

- Web frontend escapes MQTT-rendered strings before writing to HTML.
- Web real-hardware mode filters simulator-marked messages.
- Mini program treats broker input as untrusted display data and does not render HTML.

Recommended production control:

- Move to a private MQTT broker.
- Require per-device credentials and TLS.
- Use per-device topics, for example `smartcollar/<deviceId>/telemetry`.
- Add message authentication or server-issued short-lived tokens.

This is acceptable for校赛演示 but should not be marketed as production-secure.

## Checks Run

- `node --check src/main.js`
- `node --check server.mjs`
- `node --check server/deepseek.js`
- `node --check server/security.js`
- `node --check WeChatMiniProgram/pages/index/index.js`
- `npm test`
- `npm run build`
- `npm run build:pages`
- `npm audit --omit=dev` for Web project: 0 vulnerabilities
- `npm audit --omit=dev` for WeChat mini program: 0 vulnerabilities
- Secret scan excluding ignored local files: no real DeepSeek key found

## Result

No code-level high or critical security finding remains in the reviewed implementation.

The only material remaining issue is the demo architecture's public MQTT broker. Treat that as a known demo constraint and replace it before real production use.
