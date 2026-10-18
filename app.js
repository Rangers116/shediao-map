// ============ 射雕江湖地理志 · 地图逻辑 ============
// 用 MapLibre GL JS 实现；离线时自动降级为内置中国轮廓

const MAP_DATA = SHEDIAO_DATA;

// ---------- 置信度配色 ----------
const CONF_COLORS = {
    confirmed: "#ffd700",   // 金色：确切对应
    probable:  "#50c8e8",   // 蓝色：考证确定
    inferred:  "#90ee90",   // 绿色：文学推测
    fictional: "#bbbbbb"    // 灰色：纯虚构
};

// ---------- 内置简化中国轮廓（离线兜底） ----------
// 数据量小，仅勾勒大致国界；在线时会被真实底图覆盖
const CHINA_OUTLINE = {
    type: "FeatureCollection",
    features: [{
        type: "Feature",
        properties: { name: "中国" },
        geometry: {
            type: "Polygon",
            coordinates: [[
                [73.5, 39.0], [75.5, 36.5], [78.0, 34.0], [80.0, 32.0],
                [82.5, 30.5], [86.0, 28.5], [89.0, 28.0], [92.0, 27.5],
                [94.0, 29.0], [96.5, 29.5], [98.5, 27.0], [100.0, 26.0],
                [103.0, 25.0], [105.0, 23.0], [107.0, 21.5], [108.5, 20.5],
                [110.0, 21.0], [112.0, 22.0], [114.0, 23.0], [116.0, 24.0],
                [118.0, 25.0], [120.0, 26.0], [121.5, 28.0], [122.0, 30.0],
                [122.5, 32.0], [121.0, 34.0], [119.0, 36.0], [117.0, 38.0],
                [119.0, 40.0], [121.0, 42.0], [123.5, 43.0], [125.0, 42.0],
                [124.0, 40.0], [122.0, 38.5], [120.0, 37.5], [118.0, 37.0],
                [115.0, 36.5], [112.0, 37.0], [110.0, 38.5], [108.0, 40.0],
                [106.0, 42.0], [104.0, 44.0], [102.0, 46.0], [99.0, 47.5],
                [96.0, 48.5], [93.0, 48.5], [90.0, 47.0], [87.0, 45.5],
                [85.0, 44.0], [82.0, 42.5], [79.0, 41.5], [76.0, 40.5],
                [73.5, 39.0]
            ]]
        }
    }]
};

// ---------- 地图初始化 ----------
let map;
let currentIndex = 0;
let playing = false;
let playTimer = null;

// 离线检测：尝试加载在线瓦片，失败则降级
let useOffline = false;

function initMap() {
    const style = useOffline ? {
        version: 8,
        sources: {
            china: { type: "geojson", data: CHINA_OUTLINE },
            // 简化线：轨迹线（先在外部添加）
        },
        layers: [
            {
                id: "china-fill",
                type: "fill",
                source: "china",
                paint: {
                    "fill-color": "#1a1c23",
                    "fill-opacity": 0.8
                }
            },
            {
                id: "china-border",
                type: "line",
                source: "china",
                paint: { "line-color": "#8a6f3d", "line-width": 1.5 }
            },
            {
                id: "water",
                type: "background",
                paint: { "background-color": "#0d1016" }
            }
        ]
    } : {
        version: 8,
        sources: {
            osm: {
                type: "raster",
                tiles: ["https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png"],
                tileSize: 256,
                attribution: "© OpenStreetMap Contributors © CARTO",
                maxzoom: 19
            }
        },
        layers: [
            { id: "osm", type: "raster", source: "osm" }
        ]
    };

    map = new maplibregl.Map({
        container: "map",
        style: style,
        center: [110, 35],
        zoom: 4,
        maxZoom: 10
    });

    map.on("load", () => {
        if (useOffline) {
            document.getElementById("offline-banner").style.display = "block";
        }

        // 添加地点标记（GeoJSON 点）
        map.addSource("places", {
            type: "geojson",
            data: pointsGeoJSON()
        });
        map.addLayer({
            id: "places-layer",
            type: "circle",
            source: "places",
            paint: {
                "circle-radius": ["interpolate", ["exponential", 1.5], ["zoom"], 3, 4, 6, 6, 12, 9],
                "circle-color": ["get", "color"],
                "circle-stroke-color": "#000",
                "circle-stroke-width": 1
            }
        });

        // 添加地点名称（只在较高缩放级显示）
        map.addSource("place-labels", {
            type: "geojson",
            data: pointsGeoJSON()
        });
        map.addLayer({
            id: "place-labels-layer",
            type: "symbol",
            source: "place-labels",
            minzoom: 5,
            layout: {
                "text-field": ["get", "shortName"],
                "text-size": 11,
                "text-offset": [0, 1.2]
            },
            paint: {
                "text-color": "#e8dcc8",
                "text-halo-color": "#000",
                "text-halo-width": 1
            }
        });

        // 轨迹线：初始为空，播放时加入
        map.addSource("route", {
            type: "geojson",
            data: { type: "FeatureCollection", features: [] }
        });
        map.addLayer({
            id: "route-line",
            type: "line",
            source: "route",
            paint: {
                "line-color": "#ffd700",
                "line-width": 3,
                "line-opacity": 0.85
            }
        });

        // 当前高亮点
        map.addSource("current", {
            type: "geojson",
            data: { type: "FeatureCollection", features: [] }
        });
        map.addLayer({
            id: "current-mark",
            type: "circle",
            source: "current",
            paint: {
                "circle-radius": 10,
                "circle-color": "#ff4444",
                "circle-stroke-color": "#fff",
                "circle-stroke-width": 2,
                "circle-opacity": 0.9
            }
        });

        // 点击地图弹窗
        map.on("click", "places-layer", (e) => {
            if (e.features.length) {
                const props = e.features[0].properties;
                showInfoCard(props);
            }
        });
        map.on("mouseenter", "places-layer", () => {
            map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", "places-layer", () => {
            map.getCanvas().style.cursor = "";
        });

        buildChapterList();
        updateUI(true);
    });
}

// ---------- 数据处理 ----------
function pointsGeoJSON() {
    return {
        type: "FeatureCollection",
        features: MAP_DATA.map(d => ({
            type: "Feature",
            geometry: { type: "Point", coordinates: d.coordinates },
            properties: {
                color: CONF_COLORS[d.confidence] || "#888",
                shortName: d.location_name,
                title: d.location_name,
                meta: `第${d.chapter}回 · ${d.chapter_title}`,
                event: d.event,
                characters: d.characters,
                source: d.source
            }
        }))
    };
}

function routeGeoJSON(upToIndex) {
    const coords = MAP_DATA.slice(0, upToIndex + 1).map(d => d.coordinates);
    return {
        type: "FeatureCollection",
        features: [{
            type: "Feature",
            geometry: {
                type: "LineString",
                coordinates: coords
            },
            properties: {}
        }]
    };
}

// ---------- 章节列表 ----------
function buildChapterList() {
    const list = document.getElementById("chapter-list");
    list.innerHTML = "";
    MAP_DATA.forEach((d, i) => {
        const item = document.createElement("div");
        item.className = "chapter-item";
        item.dataset.index = i;
        item.innerHTML = `<b>第${d.chapter}回</b> ${d.chapter_title} · <small>${d.location_name}</small>`;
        item.addEventListener("click", () => {
            flyToIndex(i);
            updateUI(true);
        });
        list.appendChild(item);
    });
    const bar = document.getElementById("progress-bar");
    bar.max = MAP_DATA.length - 1;
    bar.value = currentIndex;
    bar.addEventListener("input", (e) => {
        flyToIndex(parseInt(e.target.value), true);
    });
}

// ---------- UI 更新 ----------
function updateUI(silent) {
    const d = MAP_DATA[currentIndex];
    // 高亮章节列表
    document.querySelectorAll(".chapter-item").forEach((el, i) => {
        el.classList.toggle("active", i === currentIndex);
    });
    // 进度条
    const bar = document.getElementById("progress-bar");
    if (bar.max != MAP_DATA.length - 1) bar.max = MAP_DATA.length - 1;
    bar.value = currentIndex;
    // 播放按钮文本
    document.getElementById("btn-play").textContent = playing ? "⏸ 暂停" : "▶ 播放";
    // 更新轨迹线
    const route = map.getSource("route");
    if (route) route.setData(routeGeoJSON(currentIndex));
    // 当前点
    const curr = map.getSource("current");
    if (curr) {
        curr.setData({
            type: "FeatureCollection",
            features: [{
                type: "Feature",
                geometry: { type: "Point", coordinates: d.coordinates },
                properties: {}
            }]
        });
    }
    if (!silent) {
        showInfoCard({
            title: d.location_name,
            meta: `第${d.chapter}回 · ${d.chapter_title}`,
            event: d.event,
            characters: d.characters,
            source: d.source
        });
    } else {
        // 更新卡片的信心指数
        const card = document.getElementById("info-card");
        if (card.style.display !== "none") {
            // 保持卡片同步当前章节
            const props = MAP_DATA[currentIndex];
            document.getElementById("info-title").textContent = props.location_name;
            document.getElementById("info-meta").textContent = `第${props.chapter}回 · ${props.chapter_title} · ${props.year}`;
            document.getElementById("info-event").textContent = props.event;
            document.getElementById("info-source").textContent = "原著依据：" + props.source + " " + props.characters;
        }
    }
}

// ---------- 信息卡 ----------
function showInfoCard(props) {
    document.getElementById("info-title").textContent = props.title;
    document.getElementById("info-meta").textContent = props.meta + " · 角色：" + props.characters;
    document.getElementById("info-event").textContent = props.event;
    document.getElementById("info-source").textContent = "原著依据：" + props.source;
    document.getElementById("info-card").style.display = "block";
}

document.getElementById("info-close").addEventListener("click", () => {
    document.getElementById("info-card").style.display = "none";
});

// ---------- 跳转 & 播放 ----------
function flyToIndex(i, noCard) {
    if (i < 0 || i >= MAP_DATA.length) return;
    currentIndex = i;
    const d = MAP_DATA[i];
    map.flyTo({
        center: d.coordinates,
        zoom: Math.max(map.getZoom(), 5.5),
        essential: true,
        duration: 1200
    });
    updateUI(!!noCard);
}

function togglePlay() {
    if (playing) {
        playing = false;
        clearInterval(playTimer);
        playTimer = null;
        updateUI(true);
        return;
    }
    playing = true;
    updateUI(true);
    playTimer = setInterval(() => {
        if (currentIndex >= MAP_DATA.length - 1) {
            // 播放到终点自动停
            togglePlay();
            return;
        }
        flyToIndex(currentIndex + 1, true);
    }, 2800);
}

// 按钮和键盘
document.getElementById("btn-play").addEventListener("click", togglePlay);
document.getElementById("btn-prev").addEventListener("click", () => flyToIndex(currentIndex - 1));
document.getElementById("btn-next").addEventListener("click", () => flyToIndex(currentIndex + 1));

document.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT") return;
    if (e.key === "ArrowLeft") { e.preventDefault(); flyToIndex(currentIndex - 1); }
    if (e.key === "ArrowRight") { e.preventDefault(); flyToIndex(currentIndex + 1); }
    if (e.key === " ") { e.preventDefault(); togglePlay(); }
});

// ---------- 启动 ----------
// 先尝试在线瓦片，5秒无响应则降级离线
const offlineTimer = setTimeout(() => {
    useOffline = true;
    initMap();
}, 5000);

// 用一次临时请求测试在线状态
fetch("https://a.basemaps.cartocdn.com/dark_all/1/1/0.png", { mode: "cors" })
    .then(() => {
        clearTimeout(offlineTimer);
        useOffline = false;
        initMap();
    })
    .catch(() => {
        clearTimeout(offlineTimer);
        useOffline = true;
        initMap();
    });