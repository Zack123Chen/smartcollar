import './styles.css';
import 'leaflet/dist/leaflet.css';
import * as L from 'leaflet';
import Chart from 'chart.js/auto';
import PahoMqtt from 'paho-mqtt';
import { createIcons, icons } from 'lucide';
import { formatGpsLabel, normalizeTelemetryPayload, parseTelemetryMessage } from './telemetry.js';
import {
  ensureSeedMissions,
  exportStoredData,
  getAllMissions,
  getRecentTelemetry,
  getTelemetryCount,
  saveMission,
  saveTelemetrySample
} from './storage.js';

const lucide = { createIcons: () => createIcons({ icons }) };
const Paho = { MQTT: PahoMqtt };
window.Chart = Chart;

function setIconClass(icon, className) {
  if (icon) icon.setAttribute('class', className);
}

function setIconName(icon, name) {
  if (icon) icon.setAttribute('data-lucide', name);
}

// ==========================================
        // 模块 1：变量声明与初始化
        // ==========================================
        let previousPosition = null;
        let cumulativeDistance = 0; // 累计运动里程
        let routeCoordinates = [];   // 运动轨迹记录
        let routePolyline = null;    // 轨迹图层
        let isDemoMode = false;      // 默认处于“真实模式”(不干扰物理单片机信号)
        let alarmActive = false;
        let telemetrySaveCount = 0;
        let lastTelemetrySnapshot = null;
        let lastMiniRelayAt = 0;
        let aiAnalysisLockedUntil = 0;
        let bioScanRunning = false;
        const petProfile = {
            name: "小七",
            species: "犬/猫通用监测",
            device: "CareGuard Collar",
            locationAnchor: "哈尔滨工业大学"
        };

        // 历史档案物理存储 (包含轨迹)
        let archivedMissions = [
            {
                name: "晨间草坪快跑(一校区)",
                avgHr: 124,
                maxTemp: 39.2,
                distance: 842.10,
                path: [
                    [45.74366046736808, 126.63137225871596],
                    [45.751600, 126.629900],
                    [45.752200, 126.631000],
                    [45.752500, 126.632200],
                    [45.751800, 126.632500],
                    [45.751100, 126.631200],
                    [45.74366046736808, 126.63137225871596]
                ]
            },
            {
                name: "图书馆周边慢行散步",
                avgHr: 82,
                maxTemp: 38.4,
                distance: 350.50,
                path: [
                    [45.74366046736808, 126.63137225871596],
                    [45.750800, 126.628800],
                    [45.750200, 126.628500],
                    [45.750500, 126.629900],
                    [45.74366046736808, 126.63137225871596]
                ]
            }
        ];

        // 统一图标初始化
        lucide.createIcons();

        // 实时更新当前星历时间
        function updateStarDate() {
            const now = new Date();
            const year = now.getFullYear();
            const month = String(now.getMonth() + 1).padStart(2, '0');
            const day = String(now.getDate()).padStart(2, '0');
            document.getElementById('starDate').innerText = `SD-${year}.${month}.${day}`;
        }
        updateStarDate();

        // ==========================================
        // 模块 1.5：系统模式切换引擎 (真实 vs 演示)
        // ==========================================
        function renderSystemModeControls() {
            const btn = document.getElementById('modeToggleBtn');
            const icon = document.getElementById('modeToggleIcon');
            const text = document.getElementById('modeToggleText');

            if (!btn || !text) return;

            if (isDemoMode) {
                btn.className = "mode-button mode-demo";
                setIconClass(icon, "h-4 w-4");
                setIconName(icon, 'cpu');
                text.innerText = "仿真演示";
            } else {
                btn.className = "mode-button";
                setIconClass(icon, "h-4 w-4");
                setIconName(icon, 'radio');
                text.innerText = "真实硬件";
            }
            lucide.createIcons();
        }

        function enterDemoMode(options = {}) {
            const { autoStartScenario = null, source = "manual" } = options;
            const wasDemoMode = isDemoMode;
            isDemoMode = true;
            renderSystemModeControls();

            if (!wasDemoMode) {
                logAction("系统", "已成功切入【仿真演示模式】。点击下方场景按钮触发遥测运动。");
                showToast("系统模式切换", "演示模式已激活。点击场景按钮即可启动虚拟数据源！", "info");
            } else if (source === "scenario") {
                logAction("操作", "仿真演示模式已保持开启。");
            }

            if (autoStartScenario) {
                triggerSimulatedScenario(autoStartScenario);
            }
        }

        function enterHardwareMode() {
            isDemoMode = false;
            stopSimulator();
            renderSystemModeControls();

            // 复位电量显示，避免把仿真残留的电量误当成真实硬件读数（硬件不上报电量）
            const batteryEl = document.getElementById('kpiBattery');
            if (batteryEl) {
                batteryEl.innerText = "未接入";
                batteryEl.className = "kpi-value battery-value";
            }
            const batteryIcon = document.getElementById('batteryIcon');
            if (batteryIcon) {
                setIconClass(batteryIcon, "h-5 w-5");
                batteryIcon.setAttribute('data-lucide', 'battery-warning');
                lucide.createIcons();
            }

            logAction("系统", "已切换回【真实硬件模式】。控制台已切断仿真回路，纯净等待物理单片机报文。");
            showToast("系统模式切换", "已切入物理硬件直连。控制台开始全面监听物理项圈上报！", "success");
        }

        function toggleSystemMode() {
            if (isDemoMode) {
                enterHardwareMode();
            } else {
                // 默认启动日常慢步仿真，以便用户有即时视觉体验
                enterDemoMode({ autoStartScenario: 'PATROL' });
            }
        }

        // ==========================================
        // 模块 2：初始化“高精度寻宠地图”
        // ==========================================
        // 初始化中心点设在哈尔滨工业大学一校区
        const hitCoords = [45.74366046736808, 126.63137225871596];
        const map = L.map('map', {
            zoomControl: false,
            attributionControl: false
        }).setView(hitCoords, 16);
        
        // 加载 OpenStreetMap 开源瓦片地图
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19
        }).addTo(map);

        // 自定义高科技呼吸光圈 Marker
        const pulseIcon = L.divIcon({
            className: 'relative flex items-center justify-center',
            html: `
                <div class="absolute h-9 w-9 rounded-full bg-[#29745f]/15"></div>
                <div class="h-3.5 w-3.5 rounded-full border-2 border-white bg-[#29745f] shadow-sm"></div>
            `,
            iconSize: [40, 40],
            iconAnchor: [20, 20]
        });

        // 定位标记
        const petMarker = L.marker(hitCoords, { icon: pulseIcon }).addTo(map);
        petMarker.bindPopup(`
            <div class="map-popup">
                <b>爱宠芯片: K9-小七</b><br>
                状态: 等待硬件接入...<br>
                项圈GPS: 卫星握手正常
            </div>
        `).openPopup();

        // ==========================================
        // 模块 3：初始化生命指标监测图表
        // ==========================================
        const chartCtx = document.getElementById('telemetryChart').getContext('2d');
        
        // 创建漂亮的渐变色
        const hrGradient = chartCtx.createLinearGradient(0, 0, 0, 250);
        hrGradient.addColorStop(0, 'rgba(41, 116, 95, 0.22)');
        hrGradient.addColorStop(1, 'rgba(41, 116, 95, 0)');

        const tempGradient = chartCtx.createLinearGradient(0, 0, 0, 250);
        tempGradient.addColorStop(0, 'rgba(183, 95, 58, 0.18)');
        tempGradient.addColorStop(1, 'rgba(183, 95, 58, 0)');

        const telemetryChart = new Chart(chartCtx, {
            type: 'line',
            data: {
                labels: [], // 时间戳
                datasets: [
                    {
                        label: '实时心率 (BPM)',
                        yAxisID: 'y-hr',
                        borderColor: '#29745f',
                        backgroundColor: hrGradient,
                        data: [],
                        fill: true,
                        tension: 0.35,
                        borderWidth: 2.5,
                        pointRadius: 2,
                        pointHoverRadius: 6,
                        pointBackgroundColor: '#29745f'
                    },
                    {
                        label: '实时体温 (°C)',
                        yAxisID: 'y-temp',
                        borderColor: '#b75f3a',
                        backgroundColor: tempGradient,
                        data: [],
                        fill: true,
                        tension: 0.3,
                        borderWidth: 1.5,
                        pointRadius: 0,
                        borderDash: [5, 5]
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    'y-hr': {
                        type: 'linear',
                        position: 'left',
                        min: 0,
                        max: 180,
                        grid: { color: '#ece8e2' },
                        ticks: { color: '#6b6f76' },
                        title: { display: true, text: '心率 (BPM)', color: '#29745f' }
                    },
                    'y-temp': {
                        type: 'linear',
                        position: 'right',
                        min: 35,
                        max: 43,
                        grid: { drawOnChartArea: false },
                        ticks: { color: '#6b6f76' },
                        title: { display: true, text: '体温 (°C)', color: '#b75f3a' }
                    },
                    x: {
                        grid: { display: false },
                        ticks: { color: '#9aa0a6' }
                    }
                },
                plugins: {
                    legend: {
                        display: true,
                        position: 'top',
                        labels: { color: '#6b6f76', font: { size: 11 } }
                    }
                },
                animation: { duration: 200 }
            }
        });

        // ==========================================
        // 模块 4：哈弗辛距离算法 (计算累计轨迹长度)
        // ==========================================
        function computeDistance(lat1, lon1, lat2, lon2) {
            const R = 6371000; // 地球半径，单位：米
            const phi1 = lat1 * Math.PI / 180;
            const phi2 = lat2 * Math.PI / 180;
            const deltaPhi = (lat2 - lat1) * Math.PI / 180;
            const deltaLambda = (lon2 - lon1) * Math.PI / 180;

            const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
                      Math.cos(phi1) * Math.cos(phi2) *
                      Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

            return R * c; // 米
        }

        // 清空历史运动轨迹
        function clearHistoryPath() {
            if (routePolyline) {
                map.removeLayer(routePolyline);
                routePolyline = null;
            }
            routeCoordinates = [];
            cumulativeDistance = 0;
            previousPosition = null;
            document.getElementById('kpiDistance').innerText = `0.00 米`;
            logAction("操作", "历史运动轨迹图层已成功清洗。");
            showToast("轨迹重置", "已清除地图上所有轨迹折线", "info");
        }

        function buildTelemetryRecord(telemetry, displayState, isAlarm) {
            return {
                timestamp: Date.now(),
                recordedAt: new Date().toISOString(),
                source: telemetry.isSimulator ? "simulator" : "hardware",
                state: telemetry.state,
                displayState,
                isAlarm,
                hr: telemetry.hr,
                temp: telemetry.temp,
                battery: telemetry.battery,
                lat: telemetry.lat,
                lng: telemetry.lng,
                hasGps: telemetry.hasGps
            };
        }

        async function updateStoredTelemetryCount() {
            const countEl = document.getElementById('storedTelemetryCount');
            if (!countEl) return;
            try {
                countEl.innerText = String(await getTelemetryCount());
            } catch (error) {
                console.warn("读取本地存储计数失败:", error);
            }
        }

        function persistTelemetryRecord(record) {
            saveTelemetrySample(record)
                .then(() => {
                    telemetrySaveCount += 1;
                    if (telemetrySaveCount % 5 === 0) {
                        updateStoredTelemetryCount();
                    }
                })
                .catch(error => {
                    console.warn("保存遥测数据失败:", error);
                    logAction("纠错", `本地保存遥测失败: ${error.message}`);
                });
        }

        function escapeHtml(value) {
            return String(value ?? "")
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;")
                .replace(/'/g, "&#039;");
        }

        function formatAiInlineMarkdown(value) {
            return escapeHtml(value)
                .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
                .replace(/\*(.+?)\*/g, "<em>$1</em>");
        }

        function formatAiAnalysis(text) {
            const lines = String(text || "")
                .replace(/\r\n/g, "\n")
                .split("\n");
            const html = [];
            let listType = null;

            const closeList = () => {
                if (!listType) return;
                html.push(`</${listType}>`);
                listType = null;
            };

            const openList = type => {
                if (listType === type) return;
                closeList();
                html.push(`<${type}>`);
                listType = type;
            };

            lines.forEach(rawLine => {
                const line = rawLine.trim();
                if (!line) {
                    closeList();
                    return;
                }

                const heading = line.match(/^#{1,6}\s+(.+)$/);
                if (heading) {
                    closeList();
                    html.push(`<h4>${formatAiInlineMarkdown(heading[1])}</h4>`);
                    return;
                }

                const boldHeading = line.match(/^\*\*(.+?)\*\*[:：]?$/);
                if (boldHeading) {
                    closeList();
                    html.push(`<h4>${formatAiInlineMarkdown(boldHeading[1])}</h4>`);
                    return;
                }

                const unordered = line.match(/^[-*]\s+(.+)$/);
                if (unordered) {
                    openList("ul");
                    html.push(`<li>${formatAiInlineMarkdown(unordered[1])}</li>`);
                    return;
                }

                const ordered = line.match(/^\d+[.)、]\s+(.+)$/);
                if (ordered) {
                    openList("ol");
                    html.push(`<li>${formatAiInlineMarkdown(ordered[1])}</li>`);
                    return;
                }

                closeList();
                html.push(`<p>${formatAiInlineMarkdown(line)}</p>`);
            });

            closeList();
            return html.join("");
        }

        function normalizeAiHeading(value) {
            return String(value || "")
                .replace(/^#{1,6}\s*/, "")
                .replace(/\*\*/g, "")
                .replace(/[:：]\s*$/, "")
                .replace(/\s+/g, "")
                .trim();
        }

        // 按标题把 AI 文本切成块（保留标题行本身），preamble 无标题时 normalizedTitle 为空
        function splitAiIntoBlocks(text) {
            const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
            const blocks = [];
            let current = { normalizedTitle: "", lines: [] };

            const pushCurrent = () => {
                if (current.lines.length || current.normalizedTitle) blocks.push(current);
            };

            lines.forEach(rawLine => {
                const line = rawLine.trim();
                const markdownHeading = line.match(/^#{1,6}\s+(.+)$/);
                const boldHeading = line.match(/^\*\*(.+?)\*\*[:：]?$/);
                const rawTitle = markdownHeading?.[1] || boldHeading?.[1];
                if (rawTitle) {
                    pushCurrent();
                    current = { normalizedTitle: normalizeAiHeading(rawTitle), lines: [rawLine] };
                } else {
                    current.lines.push(rawLine);
                }
            });

            pushCurrent();
            return blocks;
        }

        // 渲染大框时剔除已被单独拆到小框的段落，避免内容重复
        function buildConclusionHtml(text, excludeTitles) {
            const exclude = new Set(excludeTitles);
            const kept = splitAiIntoBlocks(text)
                .filter(block => !exclude.has(block.normalizedTitle))
                .map(block => block.lines.join("\n"))
                .join("\n");
            return formatAiAnalysis(kept);
        }

        function extractAiSections(text) {
            const sections = {};
            let currentTitle = "";
            String(text || "")
                .replace(/\r\n/g, "\n")
                .split("\n")
                .forEach(rawLine => {
                    const line = rawLine.trim();
                    if (!line) return;

                    const markdownHeading = line.match(/^#{1,6}\s+(.+)$/);
                    const boldHeading = line.match(/^\*\*(.+?)\*\*[:：]?$/);
                    const title = normalizeAiHeading(markdownHeading?.[1] || boldHeading?.[1] || "");

                    if (title) {
                        currentTitle = title;
                        if (!sections[currentTitle]) sections[currentTitle] = [];
                        return;
                    }

                    if (currentTitle) {
                        sections[currentTitle].push(line);
                    }
                });
            return sections;
        }

        function stripAiMarkdown(value) {
            return String(value || "")
                .replace(/^[-*]\s+/, "")
                .replace(/^\d+[.)、]\s+/, "")
                .replace(/\*\*(.+?)\*\*/g, "$1")
                .replace(/\*(.+?)\*/g, "$1")
                .replace(/\s+/g, " ")
                .trim();
        }

        function summarizeAiSection(lines, fallback) {
            const cleaned = lines
                .map(stripAiMarkdown)
                .filter(Boolean)
                .slice(0, 3);

            if (!cleaned.length) return fallback;
            const summary = cleaned.join(" ");
            return summary.length > 150 ? `${summary.slice(0, 150)}...` : summary;
        }

        function getCurrentTelemetrySnapshot() {
            const currentHr = parseInt(telemetryChart.data.datasets[0].data.slice(-1)[0]) || 80;
            const currentTemp = parseFloat(telemetryChart.data.datasets[1].data.slice(-1)[0]) || 38.5;
            const parsedBattery = parseInt(document.getElementById('kpiBattery').innerText, 10);
            return lastTelemetrySnapshot || {
                timestamp: Date.now(),
                recordedAt: new Date().toISOString(),
                source: isDemoMode ? "simulator" : "hardware",
                state: document.getElementById('kpiState').innerText,
                displayState: document.getElementById('kpiState').innerText,
                isAlarm: currentTemp > 40.0 || currentHr > 150,
                hr: currentHr,
                temp: currentTemp,
                battery: Number.isNaN(parsedBattery) ? null : parsedBattery,
                lat: petMarker.getLatLng().lat,
                lng: petMarker.getLatLng().lng,
                hasGps: true
            };
        }

        // ==========================================
        // 模块 5：核心数据解包与状态渲染引擎
        // ==========================================
        function processIncomingTelemetry(payload) {
            try {
                const telemetry = normalizeTelemetryPayload(payload);
                // 状态机判定 (支持物理单片机的英文状态)
                const { state, hr, temp, lat, lng, battery, hasGps } = telemetry;
                const isAlarm = temp > 40.0 || (hr > 150 && hr !== 0) || state.includes("ALARM") || state === "异常体温预警";
                const displayState = isAlarm ? "异常体温预警" : state;
                const record = buildTelemetryRecord(telemetry, displayState, isAlarm);
                lastTelemetrySnapshot = record;
                persistTelemetryRecord(record);
                relayMiniProgramTelemetry(record, isAlarm);

                // 更新 KPI 卡片
                updateKPIs(displayState, hr, temp, battery);

                // 更新历史折线轨迹与距离计算
                if (hasGps) {
                    const currentPos = new L.LatLng(lat, lng);
                    
                    if (previousPosition) {
                        const segmentDist = computeDistance(previousPosition.lat, previousPosition.lng, lat, lng);
                        if (segmentDist > 0.5 && segmentDist < 500) {
                            cumulativeDistance += segmentDist;
                            document.getElementById('kpiDistance').innerText = `${cumulativeDistance.toFixed(2)} 米`;
                        }
                    }
                    previousPosition = currentPos;
                    
                    // 记录轨迹并绘制
                    routeCoordinates.push(currentPos);
                    if (routeCoordinates.length > 200) routeCoordinates.shift(); 

                    if (routePolyline) {
                        routePolyline.setLatLngs(routeCoordinates);
                    } else {
                        routePolyline = L.polyline(routeCoordinates, {
                            color: '#29745f',
                            weight: 3,
                            opacity: 0.8,
                            dashArray: '5, 8'
                        }).addTo(map);
                    }

                    // 平滑移动定位点
                    petMarker.setLatLng(currentPos);
                    
                    // 当宠物快速奔跑或体温异常或日常走动时，镜头自动聚焦
                    if (state === "快速奔跑" || state === "突击" || state === "异常体温预警" || state === "Running" || state === "Walking" || state === "日常慢步" || state === "奔跑") {
                        map.panTo(currentPos);
                    }

                    // 更新标记弹出卡片信息
                    petMarker.setPopupContent(`
                        <div class="map-popup">
                            <b>生命体征: 小七 K9</b><br>
                            活跃姿态: ${escapeHtml(state)}<br>
                            心跳频率: ${hr} BPM<br>
                            核心体温: ${temp} °C
                        </div>
                    `);
                }

                // 推进生命指标分析波形图
                const now = new Date();
                const timeLabel = String(now.getHours()).padStart(2, '0') + ":" + 
                                  String(now.getMinutes()).padStart(2, '0') + ":" + 
                                  String(now.getSeconds()).padStart(2, '0');
                
                telemetryChart.data.labels.push(timeLabel);
                telemetryChart.data.datasets[0].data.push(hr);
                telemetryChart.data.datasets[1].data.push(temp);

                if (telemetryChart.data.labels.length > 25) {
                    telemetryChart.data.labels.shift();
                    telemetryChart.data.datasets[0].data.shift();
                    telemetryChart.data.datasets[1].data.shift();
                }
                telemetryChart.update();

                // 状态栏与警报提示
                const statusEl = document.getElementById('statusBar');
                // state 可能来自公共 MQTT 话题的任意字符串，进 innerHTML 前必须转义防 XSS
                const statusText = `生命体征: ${escapeHtml(state)} | 心率: ${hr} BPM | 温度: ${temp} °C | GPS: ${formatGpsLabel(telemetry)}`;
                
                if (isAlarm) {
                    statusEl.innerHTML = `<span class="status-error">状态预警：体征偏离正常阈值，${statusText}</span>`;
                    if (!alarmActive) {
                        alarmActive = true;
                        showToast("生命体征预警", "爱宠心率或体温偏高，建议执行远程呼唤！", "error");
                    }
                } else {
                    statusEl.innerHTML = `<span class="status-ok">守护链路同步正常：${statusText}</span>`;
                    if (alarmActive) {
                        alarmActive = false;
                        showToast("状态恢复", "生命体征已回到正常监测区间。", "success");
                    }
                }

            } catch(e) {
                console.error("解析数据包故障:", e);
                logAction("纠错", `接收到异常格式遥测报文: ${e.message}`);
            }
        }

        // 更新 KPI 卡片的视觉状态
        function updateKPIs(state, hr, temp, battery) {
            const kpiState = document.getElementById('kpiState');
            const stateIcon = document.getElementById('stateIcon');
            const kpiTemp = document.getElementById('kpiTemp');
            const kpiBattery = document.getElementById('kpiBattery');
            const batteryIcon = document.getElementById('batteryIcon');

            // 活跃姿态双语适配与视觉同步
            if (state === "熟睡" || state === "Sleep") {
                kpiState.innerText = "熟睡模式";
                kpiState.className = "kpi-value state-sleep";
                stateIcon.parentNode.className = "icon-tile state-icon-wrap";
                stateIcon.setAttribute('data-lucide', 'moon');
            } else if (state === "快速奔跑" || state === "突击" || state === "奔跑" || state === "Running") {
                kpiState.innerText = "快速奔跑";
                kpiState.className = "kpi-value state-running";
                stateIcon.parentNode.className = "icon-tile state-icon-wrap";
                stateIcon.setAttribute('data-lucide', 'flame');
            } else if (state === "异常体温预警" || state === "发烧异常" || state === "Panic" || state.includes("ALARM")) {
                kpiState.innerText = "状态预警";
                kpiState.className = "kpi-value state-alert";
                stateIcon.parentNode.className = "icon-tile state-icon-wrap";
                stateIcon.setAttribute('data-lucide', 'alert-triangle');
            } else { // 日常慢步 / Walking / Active
                kpiState.innerText = "日常慢步";
                kpiState.className = "kpi-value state-active";
                stateIcon.parentNode.className = "icon-tile state-icon-wrap";
                stateIcon.setAttribute('data-lucide', 'footprints');
            }
            lucide.createIcons(); 

            // 体温高亮
            kpiTemp.innerText = `${temp.toFixed(1)} °C`;
            if (temp > 39.5) {
                kpiTemp.className = "kpi-value temp-high";
            } else if (temp < 37.5) {
                kpiTemp.className = "kpi-value temp-low";
            } else {
                kpiTemp.className = "kpi-value temp-normal";
            }

            // 电量状态（硬件未上报电量时显示「未接入」，不伪造数值）
            const hasBattery = battery !== null && battery !== undefined && !Number.isNaN(battery);
            if (!hasBattery) {
                kpiBattery.innerText = "未接入";
                kpiBattery.className = "kpi-value battery-value";
                if (batteryIcon) {
                    setIconClass(batteryIcon, "h-5 w-5");
                    batteryIcon.setAttribute('data-lucide', 'battery-warning');
                }
            } else if (battery < 20) {
                kpiBattery.innerText = `${battery} %`;
                kpiBattery.className = "kpi-value battery-low";
                if (batteryIcon) {
                    setIconClass(batteryIcon, "h-5 w-5");
                    batteryIcon.setAttribute('data-lucide', 'battery-low');
                }
            } else {
                kpiBattery.innerText = `${battery} %`;
                kpiBattery.className = "kpi-value battery-value";
                if (batteryIcon) {
                    setIconClass(batteryIcon, "h-5 w-5");
                    batteryIcon.setAttribute('data-lucide', 'battery');
                }
            }
            lucide.createIcons();
        }

        // 行动日志控制
        function logAction(type, info) {
            const logBox = document.getElementById('actionLog');
            const now = new Date();
            const timeStr = String(now.getHours()).padStart(2, '0') + ":" + 
                            String(now.getMinutes()).padStart(2, '0') + ":" + 
                            String(now.getSeconds()).padStart(2, '0');
            
            let colorClass = "log-info";
            if (type === "操作") colorClass = "log-action";
            if (type === "系统") colorClass = "log-system";
            if (type === "警告") colorClass = "log-warning";
            if (type === "纠错") colorClass = "log-error";

            // info 可能携带原始报文片段（解析失败时），转义后再写入 innerHTML
            logBox.innerHTML += `<br>[${timeStr}] <span class="${colorClass}">[${type}]</span> ${escapeHtml(info)}`;
            logBox.scrollTop = logBox.scrollHeight;
        }

        // ==========================================
        // 模块 6：远程控制与召回指令
        // ==========================================
        function sendCommand(cmdCode, description) {
            logAction("操作", `向智能项圈打包下发召回逻辑包... [CMD: ${cmdCode}]`);
            
            // 尝试通过活跃的 MQTT 信道广播控制报文
            if (client && client.isConnected()) {
                try {
                    const payload = JSON.stringify({
                        command: cmdCode,
                        timestamp: Date.now(),
                        operator: "HIT_Guardian_Center"
                    });
                    const message = new Paho.MQTT.Message(payload);
                    message.destinationName = "HIT/PetControl";
                    client.send(message);
                    logAction("操作", `指令已安全发出，执行结果: ${description}`);
                    showToast("远程控制触发", `设备执行中：${description}`, "success");
                } catch (err) {
                    logAction("纠错", `遥控包广播失败: ${err.message}`);
                }
            } else {
                logAction("操作", `【无网仿真】未检测到公共中继，已对项圈执行本地召回虚拟反馈：${description}`);
                showToast("本地召回响应", description, "info");
            }
        }

        function sendMiniProgramAlarm() {
            const current = getCurrentTelemetrySnapshot();
            const alertPayload = {
                event: "MINI_PROGRAM_ALARM",
                alert: true,
                isAlarm: true,
                source: "web-simulator",
                state: "异常体温预警",
                displayState: "状态预警",
                hr: Math.max(current.hr || 0, 168),
                temp: Math.max(current.temp || 0, 41.3),
                battery: current.battery || 92,
                lat: current.lat,
                lng: current.lng,
                hasGps: current.hasGps !== false,
                message: "Web 仿真端触发小程序报警，请立即查看宠物生命体征。",
                timestamp: Date.now(),
                recordedAt: new Date().toISOString()
            };

            if (!isDemoMode) {
                enterDemoMode({ source: "scenario" });
            }

            processIncomingTelemetry({ ...alertPayload, isSimulator: true });
            updateAIRecommendationsSilent(alertPayload);
            relayMiniProgramTelemetry(alertPayload, true, { immediate: true });
            sendServiceAlertNotification(alertPayload);

            if (client && client.isConnected()) {
                try {
                    const alertMessage = new Paho.MQTT.Message(JSON.stringify(alertPayload));
                    alertMessage.destinationName = "HIT/PetAlert";
                    client.send(alertMessage);

                    const telemetryMessage = new Paho.MQTT.Message(JSON.stringify({
                        ...alertPayload,
                        isSimulator: true
                    }));
                    telemetryMessage.destinationName = "HIT/PetData";
                    client.send(telemetryMessage);

                    logAction("警告", "已向 HIT/PetAlert 推送小程序报警，并同步写入遥测主题。");
                    showToast("小程序报警已发送", "微信小程序收到后会保持预警，直到体征恢复正常。", "error");
                } catch (err) {
                    logAction("纠错", `小程序报警推送失败: ${err.message}`);
                    showToast("推送失败", "MQTT 报警消息发送失败，请检查中继连接。", "error");
                }
            } else {
                logAction("纠错", "MQTT 尚未连接，无法向微信小程序推送报警。");
                showToast("推送等待", "MQTT 尚未连接，稍后再试。", "error");
            }
        }

        async function sendServiceAlertNotification(alertPayload) {
            try {
                const response = await fetch("/api/alert-notify", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        ...alertPayload,
                        petName: "小七"
                    })
                });

                if (!response.ok) {
                    const body = await response.json().catch(() => ({}));
                    throw new Error(body.error || `HTTP ${response.status}`);
                }

                logAction("警告", "已触发方糖/Server酱服务号报警通知。");
            } catch (error) {
                logAction("纠错", `服务号通知未发送: ${error.message}`);
            }
        }

        async function relayMiniProgramTelemetry(payload, isAlarm = false, options = {}) {
            const now = Date.now();
            if (!options.immediate && !isAlarm && now - lastMiniRelayAt < 3000) return;
            lastMiniRelayAt = now;

            try {
                const response = await fetch("/api/mini-relay", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        ...payload,
                        alert: isAlarm || payload.alert,
                        isAlarm: isAlarm || payload.isAlarm,
                        timestamp: payload.timestamp || now
                    })
                });

                if (!response.ok) {
                    const body = await response.json().catch(() => ({}));
                    throw new Error(body.error || `HTTP ${response.status}`);
                }
            } catch (error) {
                logAction("纠错", `小程序云端同步未完成: ${error.message}`);
            }
        }

        // ==========================================
        // 模块 7：通用提示面板
        // ==========================================
        function showToast(title, message, type = "info") {
            const toast = document.getElementById('customToast');
            const toastTitle = document.getElementById('toastTitle');
            const toastMsg = document.getElementById('toastMessage');
            const toastIconDiv = document.getElementById('toastIcon');

            toastTitle.innerText = title;
            toastMsg.innerText = message;

            if (type === "success") {
                toast.className = "toast toast-success";
                toastIconDiv.className = "toast-icon toast-icon-success";
                toastIconDiv.innerHTML = `<i data-lucide="check-circle" class="h-5 w-5"></i>`;
            } else if (type === "error") {
                toast.className = "toast toast-error";
                toastIconDiv.className = "toast-icon toast-icon-error";
                toastIconDiv.innerHTML = `<i data-lucide="alert-octagon" class="h-5 w-5"></i>`;
            } else {
                toast.className = "toast";
                toastIconDiv.className = "toast-icon";
                toastIconDiv.innerHTML = `<i data-lucide="info" class="h-5 w-5"></i>`;
            }
            lucide.createIcons();

            toast.classList.remove('translate-y-20', 'opacity-0');
            toast.classList.add('translate-y-0', 'opacity-100');

            setTimeout(() => {
                toast.classList.remove('translate-y-0', 'opacity-100');
                toast.classList.add('translate-y-20', 'opacity-0');
            }, 4000);
        }

        // ==========================================
        // 模块 8：安全通讯 - 接入公共中继网络
        // ==========================================
        const isHttps = window.location.protocol === "https:";
        // EMQX 公共 broker: 8083 是明文 WS，8084 是 WSS；HTTPS 页面必须走 8084。
        const mqttPort = isHttps ? 8084 : 8083;
        const clientId = "Web_HIT_HQ_" + Math.random().toString(16).substr(2, 8);
        const client = new Paho.MQTT.Client("broker-cn.emqx.io", mqttPort, clientId);

        document.getElementById('secureChannelLabel').innerText = isHttps ? "MQTT / TLS 安全加密" : "MQTT / WS 基础中继";
        document.getElementById('nodeLabel').innerText = `基站接入节点: broker-cn.emqx.io:${mqttPort}`;

        client.onConnectionLost = function(responseObject) {
            document.getElementById('statusIndicator').className = "status-dot status-error";
            document.getElementById('statusBar').innerHTML = "<span class='status-error'>链路连通性衰减，3秒后自动重新连接...</span>";
            logAction("纠错", "基站信号中断，失去与 EMQX 中继器握手。");
            setTimeout(connectMQTT, 3000); 
        };

        client.onMessageArrived = function(message) {
            try {
                const payload = parseTelemetryMessage(message.payloadString);
                const telemetry = normalizeTelemetryPayload(payload);
                
                if (isDemoMode) {
                    // 【演示模式下】：仅接收处理并展示来自本地/远程的仿真循环报文
                    if (telemetry.isSimulator) {
                        processIncomingTelemetry(telemetry);
                    }
                } else {
                    // 【真实模式下】：强制过滤、无视一切仿真消息（避免MQTT回环回路污染），只处理真实的物理单片机消息
                    if (!telemetry.isSimulator) {
                        processIncomingTelemetry(telemetry);
                    }
                }
            } catch(e) {
                console.error("MQTT 解包异常", e);
                logAction("纠错", `MQTT 报文无法解析: ${e.message}`);
            }
        };

        function connectMQTT() {
            logAction("操作", `正在握手通信基站 [broker-cn.emqx.io:${mqttPort}]，协议: ${isHttps ? "WSS (Secure)" : "WS"}`);
            
            client.connect({
                onSuccess: function() {
                    document.getElementById('statusIndicator').className = "status-dot status-ok";
                    document.getElementById('statusBar').innerHTML = `<span class='status-ok'>守护通道握手就绪 (${isHttps ? 'WSS 安全连接' : 'WS 连接'})，侦听频道: HIT/PetData...</span>`;
                    client.subscribe("HIT/PetData");
                    logAction("操作", `云控制台接入正常，生命体征监测就绪。`);
                },
                onFailure: function(err) {
                    console.error("MQTT 连接失败:", err);
                    document.getElementById('statusIndicator').className = "status-dot status-error";
                    document.getElementById('statusBar').innerHTML = `<span class='status-error'>通道建立失败: ${err.errorMessage || "超时"}，3秒后自动挂起重试...</span>`;
                    logAction("纠错", `中继站连接挂起: ${err.errorMessage || "连接超时"}`);
                    setTimeout(connectMQTT, 3000);
                },
                useSSL: isHttps,
                timeout: 5,
                keepAliveInterval: 30,
                cleanSession: true
            });
        }

        connectMQTT();


        // ==========================================
        // 模块 9：日常健康行为数据仿真器
        // ==========================================
        let simInterval = null;
        let simLat = hitCoords[0];
        let simLng = hitCoords[1];
        let simBattery = 100;          // 仿真电量用浮点累计，避免每步取整后回弹
        let currentScenario = 'PATROL';

        // 安全停用虚拟仿真
        function stopSimulator() {
            if (simInterval) {
                clearInterval(simInterval);
                simInterval = null;
            }
            const simLabel = document.getElementById('simulatorStatus');
            if (simLabel) {
                simLabel.className = "sim-status";
                simLabel.innerHTML = `
                    <span class="sim-dot"></span>
                    SIMULATOR STANDBY
                `;
            }
        }

        function triggerSimulatedScenario(scenario) {
            // 如处于真实模式，点击任意场景即自动切入仿真演示，避免用户以为按钮失效。
            if (!isDemoMode) {
                enterDemoMode({ source: "scenario" });
            }

            currentScenario = scenario;
            logAction("操作", `切换至遥测行为场景：${scenario}`);
            
            if (simInterval) clearInterval(simInterval);

            // 高亮仿真运行指示器
            const simLabel = document.getElementById('simulatorStatus');
            if (simLabel) {
                simLabel.className = "sim-status sim-status-active";
                simLabel.innerHTML = `
                    <span class="sim-dot"></span>
                    SIMULATOR ACTIVE (${scenario})
                `;
            }

            simInterval = setInterval(() => {
                let walkStep = 0.00015;
                let heartRate = 80;
                let temperature = 38.4;
                let batteryDrain = 0.1;   // 每个 2s tick 的耗电量，按活动强度区分
                let stateName = "日常慢步";

                if (currentScenario === 'REST') {
                    walkStep = 0.00001;
                    heartRate = 60 + Math.floor(Math.random() * 8);
                    temperature = 37.8 + Math.random() * 0.4;
                    batteryDrain = 0.05;
                    stateName = "熟睡";
                } else if (currentScenario === 'PATROL') {
                    walkStep = 0.00012;
                    heartRate = 85 + Math.floor(Math.random() * 20);
                    temperature = 38.3 + Math.random() * 0.5;
                    batteryDrain = 0.1;
                    stateName = "日常慢步";
                } else if (currentScenario === 'CHARGE') {
                    walkStep = 0.00045;
                    heartRate = 135 + Math.floor(Math.random() * 30);
                    temperature = 39.1 + Math.random() * 0.8;
                    batteryDrain = 0.25;
                    stateName = "快速奔跑";
                } else if (currentScenario === 'ALARM_FEVER') {
                    walkStep = 0.0002;
                    heartRate = 155 + Math.floor(Math.random() * 20);
                    temperature = 41.2 + Math.random() * 0.6;
                    batteryDrain = 0.2;
                    stateName = "异常体温预警";
                }

                simLat += (Math.random() - 0.5) * walkStep;
                simLng += (Math.random() - 0.5) * walkStep;

                // 浮点累计耗电，最低保留 1%，显示时再取整
                simBattery = Math.max(1, simBattery - batteryDrain);

                const payload = {
                    state: stateName,
                    hr: heartRate,
                    temp: parseFloat(temperature.toFixed(2)),
                    lat: parseFloat(simLat.toFixed(6)),
                    lng: parseFloat(simLng.toFixed(6)),
                    battery: Math.round(simBattery),
                    isSimulator: true // 加上核心仿真防护印章，不与硬件信号冲突
                };

                processIncomingTelemetry(payload);
                updateAIRecommendationsSilent(payload);

                if (client && client.isConnected()) {
                    try {
                        const message = new Paho.MQTT.Message(JSON.stringify(payload));
                        message.destinationName = "HIT/PetData";
                        client.send(message);
                    } catch(err) {}
                }

            }, 2000); 

            showToast("仿真系统启动", `成功模拟场景: ${scenario}。`, "info");
        }

        window.onload = async function() {
            logAction("系统", "物联网安全控制链路就绪。系统已默认锁定【真实硬件监听】。");
            try {
                await ensureSeedMissions(archivedMissions);
                archivedMissions = await getAllMissions();
                refreshArchiveTableUI();
                await updateStoredTelemetryCount();
                logAction("系统", "本地数据存储已启用。");
            } catch (error) {
                console.warn("初始化本地存储失败:", error);
                refreshArchiveTableUI();
                logAction("纠错", `本地存储初始化失败: ${error.message}`);
            }
        };

        // ==========================================
        // 模块 10：历史数据档案归档与复盘
        // ==========================================
        async function archiveCurrentSession() {
            if (routeCoordinates.length < 2) {
                showToast("归档失败", "尚未产生有效的日常运动记录，暂无法生成档案。", "error");
                return;
            }

            const hrData = telemetryChart.data.datasets[0].data;
            const tempData = telemetryChart.data.datasets[1].data;
            const avgHr = hrData.length ? Math.round(hrData.reduce((p, c) => p + c, 0) / hrData.length) : 80;
            const maxTemp = tempData.length ? Math.max(...tempData) : 38.5;

            const newMission = {
                name: `运动归档_${new Date().toLocaleTimeString()}`,
                avgHr: avgHr,
                maxTemp: parseFloat(maxTemp.toFixed(1)),
                distance: parseFloat(cumulativeDistance.toFixed(2)),
                path: routeCoordinates.map(c => [c.lat, c.lng])
            };

            try {
                await saveMission(newMission);
                archivedMissions = await getAllMissions();
                refreshArchiveTableUI();
                showToast("档案归档", `成功存储新健康档案: ${newMission.name}`, "success");
                logAction("数据", `航线成功存入档案库，同步写入 ${routeCoordinates.length} 组高精体征信包。`);
            } catch (error) {
                console.warn("保存档案失败:", error);
                showToast("归档失败", "本地数据库写入失败，请刷新后重试。", "error");
            }
        }

        function refreshArchiveTableUI() {
            const tableBody = document.getElementById('missionArchiveTableBody');
            tableBody.innerHTML = '';
            archivedMissions.forEach((mission, index) => {
                tableBody.innerHTML += `
                    <tr onclick="loadArchivedMission(${index})">
                        <td>${escapeHtml(mission.name)}</td>
                        <td>${mission.avgHr} BPM</td>
                        <td>${mission.maxTemp} °C</td>
                        <td>${mission.distance.toFixed(1)} 米</td>
                        <td><button class="text-link">复盘</button></td>
                    </tr>
                `;
            });
        }

        async function exportStoredDataFile() {
            try {
                const data = await exportStoredData();
                const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                const link = document.createElement("a");
                link.href = url;
                link.download = `careguard-data-${new Date().toISOString().slice(0, 10)}.json`;
                document.body.appendChild(link);
                link.click();
                link.remove();
                URL.revokeObjectURL(url);
                showToast("数据导出", "本地遥测与档案数据已导出。", "success");
            } catch (error) {
                console.warn("导出数据失败:", error);
                showToast("导出失败", "无法读取本地数据库。", "error");
            }
        }

        function loadArchivedMission(index) {
            const mission = archivedMissions[index];
            if (!mission) return;

            // 关闭实时模拟
            stopSimulator();

            if (routePolyline) {
                map.removeLayer(routePolyline);
            }

            const points = mission.path.map(p => new L.LatLng(p[0], p[1]));
            routePolyline = L.polyline(points, {
                color: '#b75f3a',
                weight: 4,
                opacity: 0.9,
                dashArray: 'none'
            }).addTo(map);

            const bounds = L.latLngBounds(points);
            map.fitBounds(bounds, { padding: [30, 30] });

            if(points.length) {
                petMarker.setLatLng(points[0]);
                petMarker.setPopupContent(`
                    <div class="map-popup">
                        <b>体征档案离线复盘</b><br>
                        档案名称: ${escapeHtml(mission.name)}<br>
                        平均心率: ${mission.avgHr} BPM<br>
                        今日步频: ${mission.distance} 米
                    </div>
                `).openPopup();
            }

            telemetryChart.data.labels = points.map((_, i) => `T-${i * 5}s`);
            telemetryChart.data.datasets[0].data = points.map((_, i) => mission.avgHr + (Math.sin(i) * 5));
            telemetryChart.data.datasets[1].data = points.map((_, i) => mission.maxTemp - (i * 0.05));
            telemetryChart.update();

            document.getElementById('kpiState').innerText = "离线复盘";
            document.getElementById('kpiState').className = "kpi-value state-review";
            document.getElementById('kpiTemp').innerText = `${mission.maxTemp} °C`;
            document.getElementById('kpiDistance').innerText = `${mission.distance} 米`;

            logAction("数据", `已加载并重绘体征档案: '${mission.name}'，涵盖 [${points.length}点] 轨迹网络。`);
            showToast("历史重绘完成", `正在重播历史健康档案: ${mission.name}`, "success");
        }


        // ==========================================
        // 模块 11：AI 生物医学健康诊断逻辑
        // ==========================================
        function startBioScan() {
            if (bioScanRunning) return;
            bioScanRunning = true;

            const overlay = document.getElementById('scanOverlay');
            const progress = document.getElementById('scanProgress');
            const scanText = document.getElementById('scanText');
            
            overlay.classList.remove('is-hidden');
            progress.style.width = '0%';
            
            let percent = 0;
            const interval = setInterval(async () => {
                percent += 10;
                progress.style.width = `${percent}%`;
                scanText.innerText = `AI HEALTH CHECK: 生命体征全谱扫描中 ${percent}%`;
                
                if (percent >= 100) {
                    clearInterval(interval);
                    scanText.innerText = "AI HEALTH CHECK: 正在生成健康建议...";
                    await runAiHealthAnalysis();
                    overlay.classList.add('is-hidden');
                    bioScanRunning = false;
                }
            }, 150);
        }

        async function runAiHealthAnalysis() {
            const current = getCurrentTelemetrySnapshot();

            try {
                const recent = await getRecentTelemetry(30);
                const response = await fetch("/api/health-analysis", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        current,
                        recent,
                        profile: petProfile
                    })
                });
                const result = await response.json().catch(() => ({}));
                if (!response.ok) {
                    throw new Error(result.error || "AI 服务暂不可用");
                }

                renderAiHealthReport(result.analysis, result.model);
                showToast("AI 健康分析完成", "已根据近期生命体征生成护理建议。", "success");
                logAction("数据", `AI 健康分析已生成，模型: ${result.model || "DeepSeek"}`);
            } catch (error) {
                console.warn("AI 健康分析失败:", error);
                generateComplexDiagnosis(current);
                showToast("AI 分析不可用", "已切换为本地规则健康建议。请检查后端环境变量。", "error");
                logAction("纠错", `AI 健康分析失败: ${error.message}`);
            }
        }

        function renderAiHealthReport(analysis, model = "DeepSeek") {
            const conc = document.getElementById('reportConclusion');
            const head = document.getElementById('reportHeadline');
            const sport = document.getElementById('sportAdvice');
            const diet = document.getElementById('dietAdvice');

            head.innerHTML = `<i data-lucide="sparkles" class="h-4 w-4"></i> AI 健康分析: ${escapeHtml(model)}`;
            conc.className = "ai-analysis-text";
            // 大框只渲染未被下方小框单独拆出的段落，避免「行动建议/饮水饮食」重复出现
            conc.innerHTML = buildConclusionHtml(analysis, [
                "行动建议", "活动建议",
                "饮水饮食", "饮水饮食建议", "饮食建议"
            ]);

            const sections = extractAiSections(analysis);
            sport.innerText = summarizeAiSection(
                sections["行动建议"] || sections["活动建议"] || [],
                "AI 已生成健康报告，但本次未单独返回行动建议。请优先参考上方完整报告。"
            );
            diet.innerText = summarizeAiSection(
                sections["饮水饮食"] || sections["饮水饮食建议"] || sections["饮食建议"] || [],
                "AI 已生成健康报告，但本次未单独返回饮水饮食建议。请优先参考上方完整报告。"
            );
            aiAnalysisLockedUntil = Date.now() + 45000;
            lucide.createIcons();
        }

        function updateAIRecommendationsSilent(payload) {
            if (Date.now() < aiAnalysisLockedUntil) return;

            const conc = document.getElementById('reportConclusion');
            const head = document.getElementById('reportHeadline');
            conc.className = "";
            if(payload.temp > 40.0) {
                head.innerHTML = `<i data-lucide="alert-triangle" class="h-4 w-4"></i> 生态异常健康评估: 异常高热预警`;
                conc.innerHTML = `<span class="status-error">警告：爱宠处于高体温运行区（${payload.temp}°C）</span>，可能遭受热应激、强烈温差不适、或体表有炎症迹象。心率（${payload.hr}BPM）呈现应激加速反应。`;
            } else if(payload.state === "快速奔跑" || payload.hr > 130 || payload.state === "Running") {
                head.innerHTML = `<i data-lucide="trending-up" class="h-4 w-4"></i> 生能运动状态评估: 心肺载荷激活`;
                conc.innerHTML = `<span class="status-ok">体征提示：正处于高能心肺活跃区间。</span>基础血液携氧效率极高，肌体代谢水准进入燃脂与强化锻炼区间。`;
            } else if(payload.state === "熟睡" || payload.hr < 70 || payload.state === "Sleep") {
                head.innerHTML = `<i data-lucide="moon" class="h-4 w-4"></i> 生物节律状态评估: 深度休眠修复`;
                conc.innerHTML = `<span class="text-muted">体征提示：处于深层肌肉生长与抗体自愈期。</span>新陈代谢率收敛至基础耗能，机体全面重启休整。`;
            } else {
                head.innerHTML = `<i data-lucide="heart" class="h-4 w-4"></i> 生命指标健康度评估: 指标稳定`;
                conc.innerHTML = `各项生理健康参数运行于黄金稳态区间。环境气温适应性优良，抗病阻抗指标饱满，非常适合进行长时间户外中强度慢跑。`;
            }
            lucide.createIcons();
        }

        function generateComplexDiagnosis(payload) {
            const conc = document.getElementById('reportConclusion');
            const head = document.getElementById('reportHeadline');
            const sport = document.getElementById('sportAdvice');
            const diet = document.getElementById('dietAdvice');
            const temp = payload.temp;
            const hr = payload.hr;
            conc.className = "";

            if (temp > 40.0) {
                head.innerHTML = `<i data-lucide="alert-triangle" class="h-4 w-4"></i> 生物异常预警: 发热过载`;
                conc.innerHTML = `<span class="status-error">机体过载预警：检测到明显热应激或体温偏高</span><br>核心体温高达 ${temp}°C 伴随心率加速，宠物可能存在过热中暑或免疫炎症防御。`;
                sport.innerHTML = `<span class="status-error">运动建议：</span>立刻中止任何快速奔跑拉练，强制将其转移至阴凉通风处休整。`;
                diet.innerHTML = `<span class="status-error">调理配方：</span>鼓励并引导其适量饮用常温纯净水，物理冰敷足垫部位。若发热超1小时未见退去，建议在线一键报案或联系兽医。`;
            } else if (hr > 130) {
                head.innerHTML = `<i data-lucide="zap" class="h-4 w-4"></i> 运动监测评估: 高效能区间`;
                conc.innerHTML = `<span class="status-ok">运动负荷优良：肌肉效能正在全面重塑</span><br>心肺泵氧高效，骨骼肌泵处于扩张阶段，适合增强敏捷及耐力底座。`;
                sport.innerHTML = `恢复方案：建议单次快跑负荷不超过25分钟。运动结束后用 5-10 分钟缓慢慢步随行帮助心率和体温降温。`;
                diet.innerHTML = `营养补充：运动刚结束时不宜暴饮暴食。30分钟后建议补充不饱和脂肪酸（鱼油）及高蛋白质，促使肌肉纤维科学恢复。`;
            } else if (hr < 70 && hr !== 0) {
                head.innerHTML = `<i data-lucide="shield" class="h-4 w-4"></i> 免疫监测评估: 黄金睡眠`;
                conc.innerHTML = `<span class="text-muted">深度恢复期：生长激素加速分泌与自我免疫强化</span><br>各项指标降至最健康安静心率曲线，植物神经重构工作顺利。`;
                sport.innerHTML = `深度安抚：保持环境幽暗、安静，避免高分贝噪音。深度睡眠是宠物保护软骨关节和心血管弹性免受损害的最佳期。`;
                diet.innerHTML = `日常膳食：清晨或睡醒后，可投喂膳食纤维偏高、配比科学的无谷天然粗粮，帮助肠道免疫菌群健康。`;
            } else {
                head.innerHTML = `<i data-lucide="check" class="h-4 w-4"></i> 综合健康监护评估: 正常稳态`;
                conc.innerHTML = `<span class="status-ok">综合指标健康监测中</span><br>心率数值处于标准侦听基线，守护系统实时跟进中。`;
                sport.innerHTML = `训练建议：可执行 1.5小时 哈工大一校区自由漫步。搭配抛球捡回，训练其专注力并提高其对陌生环境的安全认知。`;
                diet.innerHTML = `膳食调理：建议按照标定量投喂高纤维脱水鲜肉日粮，在水里加入适量电解质粉，使其维持黄金代谢水准。`;
            }
            lucide.createIcons();
        }

Object.assign(window, {
  archiveCurrentSession,
  clearHistoryPath,
  exportStoredDataFile,
  loadArchivedMission,
  sendCommand,
  sendMiniProgramAlarm,
  startBioScan,
  toggleSystemMode,
  triggerSimulatedScenario
});
