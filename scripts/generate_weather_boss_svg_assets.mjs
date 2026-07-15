import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const GENERATOR_VERSION = "1.0.0";
const GENERATOR_ID = `scripts/generate_weather_boss_svg_assets.mjs@${GENERATOR_VERSION}`;
const GENERATED_ON = "2026-07-15";
const LICENSE_ID = "LicenseRef-WeatherBoss-Project-Original";
const ASSET_DIR = resolve(process.cwd(), "public/assets/weather-boss");
const MANIFEST_PATH = resolve(ASSET_DIR, "manifest.json");
const CHECK_MODE = process.argv.includes("--check");

const escapeAttribute = (value) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll('"', "&quot;");

function element(name, attributes = {}, children = "") {
  const serialized = Object.entries(attributes)
    .filter(([, value]) => value !== undefined && value !== null && value !== false)
    .map(([key, value]) => `${key}="${escapeAttribute(value)}"`)
    .join(" ");
  const open = serialized ? `<${name} ${serialized}` : `<${name}`;
  return children ? `${open}>${children}</${name}>` : `${open}/>`;
}

const group = (children, attributes = {}) => element("g", attributes, children.flat(Infinity).filter(Boolean).join(""));
const path = (d, attributes = {}) => element("path", { d, ...attributes });
const line = (x1, y1, x2, y2, attributes = {}) => element("line", { x1, y1, x2, y2, ...attributes });
const rect = (x, y, width, height, attributes = {}) => element("rect", { x, y, width, height, ...attributes });
const circle = (cx, cy, r, attributes = {}) => element("circle", { cx, cy, r, ...attributes });
const polygon = (points, attributes = {}) => element("polygon", { points, ...attributes });
const polyline = (points, attributes = {}) => element("polyline", { points, ...attributes });

function panelPath(width, height, cut, inset = 0) {
  const left = inset;
  const top = inset;
  const right = width - inset;
  const bottom = height - inset;
  return `M ${left + cut} ${top} H ${right - cut} L ${right} ${top + cut} V ${bottom - cut} L ${right - cut} ${bottom} H ${left + cut} L ${left} ${bottom - cut} V ${top + cut} Z`;
}

function framePrimitive(width, height, color, options = {}) {
  const cut = options.cut ?? Math.max(8, Math.round(Math.min(width, height) * 0.06));
  const inset = options.inset ?? Math.max(4, Math.round(cut * 0.42));
  return [
    path(panelPath(width, height, cut), {
      fill: options.fill ?? "#05080A",
      "fill-opacity": options.fillOpacity ?? 0.28,
      stroke: color,
      "stroke-width": options.strokeWidth ?? 2,
      "vector-effect": "non-scaling-stroke"
    }),
    path(panelPath(width, height, Math.max(4, cut - inset), inset), {
      fill: "none",
      stroke: color,
      "stroke-opacity": options.innerOpacity ?? 0.34,
      "stroke-width": 1,
      "vector-effect": "non-scaling-stroke"
    })
  ];
}

function cornerPrimitive(size, color, transform = "") {
  const arm = Math.round(size * 0.72);
  const step = Math.round(size * 0.22);
  return group([
    path(`M 0 ${arm} V ${step} L ${step} 0 H ${arm}`, {
      fill: "none",
      stroke: color,
      "stroke-width": Math.max(2, Math.round(size * 0.07)),
      "stroke-linecap": "square",
      "stroke-linejoin": "bevel",
      "vector-effect": "non-scaling-stroke"
    }),
    line(step + 4, step + 4, arm - 4, step + 4, {
      stroke: color,
      "stroke-opacity": 0.36,
      "stroke-width": 1,
      "vector-effect": "non-scaling-stroke"
    })
  ], transform ? { transform } : {});
}

function ticksPrimitive({ x, y, count, step, vertical = false, color, majorEvery = 4, reverse = false }) {
  return Array.from({ length: count }, (_, index) => {
    const major = index % majorEvery === 0;
    const length = major ? 10 : 5;
    const offset = index * step;
    if (vertical) {
      const direction = reverse ? -1 : 1;
      return line(x, y + offset, x + direction * length, y + offset, {
        stroke: color,
        "stroke-opacity": major ? 0.8 : 0.38,
        "stroke-width": major ? 2 : 1,
        "vector-effect": "non-scaling-stroke"
      });
    }
    const direction = reverse ? -1 : 1;
    return line(x + offset, y, x + offset, y + direction * length, {
      stroke: color,
      "stroke-opacity": major ? 0.8 : 0.38,
      "stroke-width": major ? 2 : 1,
      "vector-effect": "non-scaling-stroke"
    });
  });
}

function notchPrimitive(x, y, size, color, rotation = 0, kind = "cut") {
  const shape = kind === "square"
    ? rect(x - size / 2, y - size / 2, size, size, { fill: "none", stroke: color, "stroke-width": 2 })
    : kind === "eye"
      ? path(`M ${x - size} ${y} Q ${x} ${y - size * 0.72} ${x + size} ${y} Q ${x} ${y + size * 0.72} ${x - size} ${y} Z`, { fill: "none", stroke: color, "stroke-width": 2 })
      : polygon(`${x - size},${y + size} ${x},${y - size} ${x + size},${y + size}`, { fill: "none", stroke: color, "stroke-width": 2 });
  return rotation ? group([shape], { transform: `rotate(${rotation} ${x} ${y})` }) : shape;
}

function connectorPrimitive(points, color, options = {}) {
  const nodes = (options.nodes ?? []).map((node, index) => {
    if (node.shape === "diamond") {
      return polygon(`${node.x},${node.y - 6} ${node.x + 6},${node.y} ${node.x},${node.y + 6} ${node.x - 6},${node.y}`, {
        fill: "#05080A",
        stroke: color,
        "stroke-width": index === 0 ? 2 : 1.5
      });
    }
    return circle(node.x, node.y, node.r ?? 5, { fill: "#05080A", stroke: color, "stroke-width": index === 0 ? 2 : 1.5 });
  });
  return [
    polyline(points, {
      fill: "none",
      stroke: color,
      "stroke-width": options.strokeWidth ?? 2,
      "stroke-dasharray": options.dash ?? undefined,
      "stroke-linecap": "square",
      "stroke-linejoin": "bevel",
      "vector-effect": "non-scaling-stroke"
    }),
    nodes
  ];
}

function dossierPrimitive(width, height, color, tabSide = "left") {
  const tabWidth = Math.round(width * 0.2);
  const tabHeight = Math.round(height * 0.12);
  const tabX = tabSide === "left" ? 28 : width - tabWidth - 28;
  return [
    ...framePrimitive(width, height, color, { cut: 18, fillOpacity: 0.38 }),
    path(`M ${tabX} 0 H ${tabX + tabWidth - 12} L ${tabX + tabWidth} ${tabHeight} H ${tabX}`, {
      fill: color,
      "fill-opacity": 0.1,
      stroke: color,
      "stroke-opacity": 0.72,
      "stroke-width": 2
    }),
    line(30, height - 46, width - 30, height - 46, { stroke: color, "stroke-opacity": 0.38, "stroke-width": 1 }),
    ticksPrimitive({ x: 42, y: height - 36, count: Math.max(6, Math.floor((width - 84) / 52)), step: 52, color, reverse: true })
  ];
}

function svgDocument(width, height, body) {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none" shape-rendering="geometricPrecision" aria-hidden="true">`,
    ...body.flat(Infinity).filter(Boolean).map((item) => `  ${item}`),
    "</svg>",
    ""
  ].join("\n");
}

function badgeShell(width, height, color, accent) {
  const size = Math.min(width, height);
  return [
    ...framePrimitive(width, height, color, { cut: 18, fillOpacity: 0.22, strokeWidth: 2.2 }),
    cornerPrimitive(24, accent, "translate(12 12)"),
    cornerPrimitive(24, accent, `translate(${width - 12} ${height - 12}) rotate(180)`),
    circle(width / 2, height / 2, size * 0.31, { fill: "none", stroke: color, "stroke-opacity": 0.26, "stroke-dasharray": "2 7", "stroke-width": 1 }),
    ticksPrimitive({ x: width * 0.27, y: height - 16, count: 7, step: width * 0.075, color: accent, reverse: true })
  ];
}

const glyphRenderers = {
  "event-typhoon": (cx, cy, color) => [
    path(`M ${cx - 35} ${cy + 4} C ${cx - 24} ${cy - 28} ${cx + 12} ${cy - 34} ${cx + 28} ${cy - 12} C ${cx + 41} ${cy + 6} ${cx + 24} ${cy + 30} ${cx + 2} ${cy + 28}`, { fill: "none", stroke: color, "stroke-width": 7, "stroke-linecap": "round" }),
    path(`M ${cx + 35} ${cy - 4} C ${cx + 24} ${cy + 28} ${cx - 12} ${cy + 34} ${cx - 28} ${cy + 12} C ${cx - 41} ${cy - 6} ${cx - 24} ${cy - 30} ${cx - 2} ${cy - 28}`, { fill: "none", stroke: color, "stroke-width": 7, "stroke-linecap": "round" }),
    circle(cx, cy, 7, { fill: "#05080A", stroke: color, "stroke-width": 4 })
  ],
  "event-rainstorm": (cx, cy, color) => [
    path(`M ${cx - 35} ${cy - 2} C ${cx - 36} ${cy - 18} ${cx - 20} ${cy - 27} ${cx - 7} ${cy - 20} C ${cx + 3} ${cy - 37} ${cx + 31} ${cy - 30} ${cx + 31} ${cy - 10} C ${cx + 46} ${cy - 7} ${cx + 45} ${cy + 14} ${cx + 28} ${cy + 15} H ${cx - 25} C ${cx - 43} ${cy + 14} ${cx - 47} ${cy - 4} ${cx - 35} ${cy - 2} Z`, { fill: color, "fill-opacity": 0.18, stroke: color, "stroke-width": 4, "stroke-linejoin": "round" }),
    line(cx - 25, cy + 25, cx - 32, cy + 42, { stroke: color, "stroke-width": 5, "stroke-linecap": "round" }),
    line(cx, cy + 25, cx - 7, cy + 46, { stroke: color, "stroke-width": 5, "stroke-linecap": "round" }),
    line(cx + 25, cy + 25, cx + 18, cy + 42, { stroke: color, "stroke-width": 5, "stroke-linecap": "round" })
  ],
  "event-convection": (cx, cy, color) => [
    polygon(`${cx - 42},${cy - 8} ${cx - 18},${cy - 30} ${cx + 34},${cy - 30} ${cx + 45},${cy - 12} ${cx + 28},${cy - 4} ${cx - 30},${cy - 4}`, { fill: color, "fill-opacity": 0.14, stroke: color, "stroke-width": 4, "stroke-linejoin": "bevel" }),
    path(`M ${cx + 5} ${cy - 3} L ${cx - 12} ${cy + 22} H ${cx + 2} L ${cx - 8} ${cy + 48} L ${cx + 28} ${cy + 12} H ${cx + 12} L ${cx + 24} ${cy - 3}`, { fill: color, stroke: color, "stroke-width": 2, "stroke-linejoin": "bevel" }),
    line(cx - 35, cy + 11, cx - 18, cy + 11, { stroke: color, "stroke-width": 4 }),
    line(cx + 27, cy + 28, cx + 42, cy + 28, { stroke: color, "stroke-width": 4 })
  ],
  "event-heat": (cx, cy, color) => [
    circle(cx - 15, cy - 9, 25, { fill: color, "fill-opacity": 0.12, stroke: color, "stroke-width": 4 }),
    ...Array.from({ length: 8 }, (_, index) => {
      const angle = index * Math.PI / 4;
      return line(cx - 15 + Math.cos(angle) * 34, cy - 9 + Math.sin(angle) * 34, cx - 15 + Math.cos(angle) * 43, cy - 9 + Math.sin(angle) * 43, { stroke: color, "stroke-width": 4, "stroke-linecap": "round" });
    }),
    rect(cx + 25, cy - 32, 12, 53, { rx: 6, fill: "none", stroke: color, "stroke-width": 4 }),
    circle(cx + 31, cy + 29, 13, { fill: color, "fill-opacity": 0.2, stroke: color, "stroke-width": 4 }),
    line(cx + 31, cy - 7, cx + 31, cy + 28, { stroke: color, "stroke-width": 6, "stroke-linecap": "round" })
  ],
  "event-gale-dust": (cx, cy, color) => [
    path(`M ${cx - 42} ${cy - 24} H ${cx + 16} C ${cx + 34} ${cy - 24} ${cx + 34} ${cy - 5} ${cx + 18} ${cy - 5}`, { fill: "none", stroke: color, "stroke-width": 5, "stroke-linecap": "round" }),
    path(`M ${cx - 46} ${cy} H ${cx + 38}`, { fill: "none", stroke: color, "stroke-width": 5, "stroke-linecap": "round" }),
    path(`M ${cx - 36} ${cy + 24} H ${cx + 6} C ${cx + 24} ${cy + 24} ${cx + 24} ${cy + 42} ${cx + 8} ${cy + 42}`, { fill: "none", stroke: color, "stroke-width": 5, "stroke-linecap": "round" }),
    circle(cx + 38, cy + 17, 3, { fill: color }),
    circle(cx + 47, cy + 29, 5, { fill: color, "fill-opacity": 0.62 }),
    circle(cx + 33, cy + 38, 2, { fill: color })
  ],
  "event-composite": (cx, cy, color) => [
    polygon(`${cx},${cy - 44} ${cx + 18},${cy - 10} ${cx},${cy + 1} ${cx - 18},${cy - 10}`, { fill: color, "fill-opacity": 0.22, stroke: color, "stroke-width": 4 }),
    polygon(`${cx + 42},${cy + 25} ${cx + 4},${cy + 27} ${cx},${cy + 5} ${cx + 23},${cy - 5}`, { fill: color, "fill-opacity": 0.12, stroke: color, "stroke-width": 4 }),
    polygon(`${cx - 42},${cy + 25} ${cx - 23},${cy - 5} ${cx},${cy + 5} ${cx - 4},${cy + 27}`, { fill: color, "fill-opacity": 0.32, stroke: color, "stroke-width": 4 }),
    circle(cx, cy + 6, 7, { fill: "#05080A", stroke: color, "stroke-width": 3 })
  ]
};

const sealVariants = {
  "risk-red": { token: "official-red", dash: undefined, marks: "cut", count: 3, edge: 4 },
  "risk-orange": { token: "official-orange", dash: undefined, marks: "eye", count: 2, edge: 3 },
  "risk-yellow": { token: "signal-amber", dash: undefined, marks: "cut", count: 1, edge: 2 },
  "risk-blue": { token: "telemetry-cyan", dash: "10 6", marks: "square", count: 2, edge: 2 },
  "risk-watch": { token: "signal-amber", dash: "4 9", marks: "eye", count: 1, edge: 1.5 }
};

function renderHudFrame(asset, colors) {
  const { width, height } = asset.dimensions;
  return svgDocument(width, height, [
    ...framePrimitive(width, height, colors["archive-ivory"], { cut: 42, fillOpacity: 0.18 }),
    cornerPrimitive(58, colors["telemetry-cyan"], "translate(24 24)"),
    cornerPrimitive(58, colors["telemetry-cyan"], `translate(${width - 24} 24) rotate(90)`),
    cornerPrimitive(58, colors["telemetry-cyan"], `translate(${width - 24} ${height - 24}) rotate(180)`),
    cornerPrimitive(58, colors["telemetry-cyan"], `translate(24 ${height - 24}) rotate(270)`),
    ticksPrimitive({ x: 94, y: 24, count: 18, step: (width - 188) / 17, color: colors["telemetry-cyan"] }),
    ticksPrimitive({ x: 24, y: 94, count: 12, step: (height - 188) / 11, vertical: true, color: colors["telemetry-cyan"] })
  ]);
}

function renderHudCorners(asset, colors) {
  const { width, height } = asset.dimensions;
  return svgDocument(width, height, [
    cornerPrimitive(112, colors["telemetry-cyan"], "translate(28 28)"),
    cornerPrimitive(112, colors["telemetry-cyan"], `translate(${width - 28} 28) rotate(90)`),
    cornerPrimitive(112, colors["telemetry-cyan"], `translate(${width - 28} ${height - 28}) rotate(180)`),
    cornerPrimitive(112, colors["telemetry-cyan"], `translate(28 ${height - 28}) rotate(270)`),
    ticksPrimitive({ x: 148, y: 28, count: 7, step: 15, color: colors["archive-ivory"] }),
    ticksPrimitive({ x: 28, y: 148, count: 7, step: 15, vertical: true, color: colors["archive-ivory"] })
  ]);
}

function renderEvidenceRail(asset, colors) {
  const { width, height } = asset.dimensions;
  const y = height / 2;
  return svgDocument(width, height, [
    ...connectorPrimitive(`24,${y} ${width * 0.32},${y} ${width * 0.35},${y - 10} ${width * 0.66},${y - 10} ${width * 0.69},${y} ${width - 24},${y}`, colors["telemetry-cyan"], {
      nodes: [{ x: 24, y, shape: "diamond" }, { x: width * 0.5, y: y - 10 }, { x: width - 24, y, shape: "diamond" }]
    }),
    ticksPrimitive({ x: 92, y: y + 4, count: 20, step: (width - 184) / 19, color: colors["archive-ivory"] }),
    notchPrimitive(width * 0.35, y - 10, 6, colors["signal-amber"], 90),
    notchPrimitive(width * 0.66, y - 10, 6, colors["signal-amber"], 90)
  ]);
}

function renderBadge(asset, colors, glyphId) {
  const { width, height } = asset.dimensions;
  const body = badgeShell(width, height, colors["archive-ivory"], colors["telemetry-cyan"]);
  if (glyphId) body.push(group(glyphRenderers[glyphId](width / 2, height / 2 - 2, colors["telemetry-cyan"]), { id: glyphId }));
  return svgDocument(width, height, body);
}

function renderSeal(asset, colors, variant) {
  const { width, height } = asset.dimensions;
  const config = variant ?? { token: "archive-ivory", marks: "square", count: 2, edge: 2 };
  const color = colors[config.token];
  const cut = 20;
  const marks = Array.from({ length: config.count }, (_, index) => notchPrimitive(44 + index * 34, height / 2, 8, color, index % 2 ? 180 : 0, config.marks));
  return svgDocument(width, height, [
    path(panelPath(width, height, cut, 2), { fill: colors["terminal-void"], "fill-opacity": 0.34, stroke: color, "stroke-width": config.edge, "stroke-dasharray": config.dash, "vector-effect": "non-scaling-stroke" }),
    path(panelPath(width, height, cut - 8, 10), { fill: "none", stroke: color, "stroke-opacity": variant ? 0.42 : 0.26, "stroke-width": 1, "stroke-dasharray": config.dash, "vector-effect": "non-scaling-stroke" }),
    marks,
    line(104, 18, width - 66, 18, { stroke: color, "stroke-opacity": 0.32, "stroke-width": 1 }),
    ticksPrimitive({ x: width - 250, y: height - 14, count: 8, step: 24, color, reverse: true }),
    cornerPrimitive(28, color, `translate(${width - 16} 16) rotate(90)`)
  ]);
}

function renderTimelineTrack(asset, colors) {
  const { width, height } = asset.dimensions;
  const y = height * 0.54;
  return svgDocument(width, height, [
    ...connectorPrimitive(`28,${y} ${width - 28},${y}`, colors["telemetry-cyan"], { nodes: [{ x: 28, y, shape: "diamond" }, { x: width - 28, y, shape: "diamond" }] }),
    ticksPrimitive({ x: 48, y: y - 4, count: 25, step: (width - 96) / 24, color: colors["archive-ivory"], reverse: true, majorEvery: 6 }),
    cornerPrimitive(24, colors["signal-amber"], "translate(14 12)"),
    cornerPrimitive(24, colors["signal-amber"], `translate(${width - 14} ${height - 12}) rotate(180)`)
  ]);
}

function renderTimelineScrubber(asset, colors) {
  const { width, height } = asset.dimensions;
  const cx = width / 2;
  const cy = height / 2;
  return svgDocument(width, height, [
    circle(cx, cy, 25, { fill: colors["terminal-void"], "fill-opacity": 0.5, stroke: colors["telemetry-cyan"], "stroke-width": 2 }),
    circle(cx, cy, 15, { fill: "none", stroke: colors["archive-ivory"], "stroke-opacity": 0.6, "stroke-dasharray": "2 4", "stroke-width": 1.5 }),
    polygon(`${cx - 4},${cy - 9} ${cx + 9},${cy} ${cx - 4},${cy + 9}`, { fill: colors["signal-amber"] }),
    ticksPrimitive({ x: 12, y: cy, count: 4, step: 16, color: colors["telemetry-cyan"], reverse: true })
  ]);
}

function renderLayerRail(asset, colors) {
  const { width, height } = asset.dimensions;
  const sockets = Array.from({ length: 6 }, (_, index) => {
    const x = 70 + index * ((width - 140) / 5);
    const shape = index % 3;
    if (shape === 0) return circle(x, height / 2, 13, { fill: "none", stroke: colors["telemetry-cyan"], "stroke-width": 2 });
    if (shape === 1) return rect(x - 11, height / 2 - 11, 22, 22, { fill: "none", stroke: colors["archive-ivory"], "stroke-width": 2 });
    return polygon(`${x},${height / 2 - 14} ${x + 13},${height / 2 + 11} ${x - 13},${height / 2 + 11}`, { fill: "none", stroke: colors["signal-amber"], "stroke-width": 2 });
  });
  return svgDocument(width, height, [
    ...framePrimitive(width, height, colors["archive-ivory"], { cut: 14, fillOpacity: 0.22 }),
    sockets,
    ticksPrimitive({ x: 48, y: height - 12, count: 16, step: (width - 96) / 15, color: colors["telemetry-cyan"], reverse: true }),
    cornerPrimitive(28, colors["telemetry-cyan"], "translate(10 10)")
  ]);
}

function renderSourceHealth(asset, colors) {
  const { width, height } = asset.dimensions;
  const cy = height / 2;
  const stateGroups = [
    group([circle(40, cy, 19, { fill: "none", stroke: colors["telemetry-cyan"], "stroke-width": 3 }), path(`M 30 ${cy} L 37 ${cy + 7} L 51 ${cy - 10}`, { fill: "none", stroke: colors["telemetry-cyan"], "stroke-width": 4, "stroke-linecap": "square" })], { id: "source-health-latest" }),
    group([polygon(`120,${cy - 21} 141,${cy} 120,${cy + 21} 99,${cy}`, { fill: "none", stroke: colors["signal-amber"], "stroke-width": 3 }), line(120, cy - 10, 120, cy + 2, { stroke: colors["signal-amber"], "stroke-width": 4 }), line(120, cy + 2, 130, cy + 8, { stroke: colors["signal-amber"], "stroke-width": 4 })], { id: "source-health-delayed" }),
    group([polygon(`200,${cy - 22} 219,${cy - 11} 219,${cy + 11} 200,${cy + 22} 181,${cy + 11} 181,${cy - 11}`, { fill: "none", stroke: colors["archive-ivory"], "stroke-width": 3 }), line(190, cy - 10, 210, cy + 10, { stroke: colors["archive-ivory"], "stroke-width": 3 }), line(210, cy - 10, 190, cy + 10, { stroke: colors["archive-ivory"], "stroke-width": 3 })], { id: "source-health-expired" }),
    group([polygon(`280,${cy - 23} 303,${cy + 20} 257,${cy + 20}`, { fill: "none", stroke: colors["archive-ivory"], "stroke-opacity": 0.64, "stroke-width": 3 }), line(264, cy + 14, 296, cy - 14, { stroke: colors["archive-ivory"], "stroke-opacity": 0.64, "stroke-width": 4 })], { id: "source-health-unavailable" }),
    group([rect(340, cy - 20, 40, 40, { fill: "none", stroke: colors["archive-ivory"], "stroke-opacity": 0.4, "stroke-width": 3 }), line(350, cy, 370, cy, { stroke: colors["archive-ivory"], "stroke-opacity": 0.4, "stroke-width": 3, "stroke-dasharray": "3 5" })], { id: "source-health-no-record" })
  ];
  return svgDocument(width, height, stateGroups);
}

function renderSourceConnector(asset, colors) {
  const { width, height } = asset.dimensions;
  const y = height / 2;
  return svgDocument(width, height, [
    ...connectorPrimitive(`12,${y} 180,${y} 204,${y - 9} 388,${y - 9} 412,${y} ${width - 12},${y}`, colors["telemetry-cyan"], {
      nodes: [{ x: 18, y, shape: "diamond" }, { x: 296, y: y - 9 }, { x: width - 18, y, shape: "diamond" }]
    }),
    notchPrimitive(204, y - 9, 5, colors["signal-amber"], 90),
    notchPrimitive(412, y, 5, colors["signal-amber"], 90)
  ]);
}

function renderDossier(asset, colors, city = false) {
  const { width, height } = asset.dimensions;
  const color = city ? colors["signal-amber"] : colors["telemetry-cyan"];
  const railY = city ? height * 0.68 : height * 0.62;
  return svgDocument(width, height, [
    ...dossierPrimitive(width, height, color, city ? "right" : "left"),
    ...connectorPrimitive(`36,${railY} ${width * 0.28},${railY} ${width * 0.32},${railY - 12} ${width * 0.69},${railY - 12} ${width * 0.73},${railY} ${width - 36},${railY}`, colors["telemetry-cyan"], { nodes: [{ x: 36, y: railY, shape: "diamond" }, { x: width - 36, y: railY, shape: "diamond" }] }),
    cornerPrimitive(34, colors["archive-ivory"], "translate(18 18)"),
    notchPrimitive(width - 56, 48, 9, color, city ? 90 : 0, city ? "eye" : "square")
  ]);
}

function renderEvidenceStamp(asset, colors) {
  const { width, height } = asset.dimensions;
  const cx = width / 2;
  const cy = height / 2;
  return svgDocument(width, height, [
    circle(cx, cy, 72, { fill: "none", stroke: colors["archive-ivory"], "stroke-opacity": 0.58, "stroke-width": 3, "stroke-dasharray": "44 12 8 12" }),
    circle(cx, cy, 54, { fill: "none", stroke: colors["telemetry-cyan"], "stroke-opacity": 0.46, "stroke-width": 2, "stroke-dasharray": "6 9" }),
    ticksPrimitive({ x: cx - 58, y: cy, count: 9, step: 14.5, color: colors["signal-amber"], reverse: true }),
    notchPrimitive(cx, cy - 72, 8, colors["signal-amber"], 180),
    notchPrimitive(cx, cy + 72, 8, colors["telemetry-cyan"], 0, "square")
  ]);
}

function renderWarningEdge(asset, colors) {
  const { width, height } = asset.dimensions;
  const count = 15;
  const step = (width - 80) / count;
  const chevrons = Array.from({ length: count }, (_, index) => {
    const x = 34 + index * step;
    return polyline(`${x},${height * 0.7} ${x + 18},${height * 0.3} ${x + 36},${height * 0.7}`, { fill: "none", stroke: colors["official-red"], "stroke-opacity": index % 3 === 0 ? 0.82 : 0.34, "stroke-width": index % 3 === 0 ? 4 : 2 });
  });
  return svgDocument(width, height, [
    line(24, height - 14, width - 24, height - 14, { stroke: colors["official-red"], "stroke-width": 3 }),
    chevrons,
    cornerPrimitive(32, colors["official-red"], "translate(12 12)"),
    ticksPrimitive({ x: 56, y: 16, count: 12, step: (width - 112) / 11, color: colors["signal-amber"] })
  ]);
}

function createSpecs(manifest) {
  const colors = manifest.tokens;
  const svgAssets = manifest.assets.filter((asset) => asset.filename.endsWith(".svg"));
  const uniqueRenderers = {
    "hud-frame-master": { render: renderHudFrame, composition: ["frame", "corner", "tick"] },
    "hud-corners": { render: renderHudCorners, composition: ["corner", "tick"] },
    "evidence-rail-divider": { render: renderEvidenceRail, composition: ["connector", "tick", "notch"] },
    "radar-timeline-track": { render: renderTimelineTrack, composition: ["connector", "tick", "corner"] },
    "radar-timeline-scrubber": { render: renderTimelineScrubber, composition: ["glyph", "tick"] },
    "layer-control-rail": { render: renderLayerRail, composition: ["frame", "corner", "tick", "glyph"] },
    "source-health-glyphs": { render: renderSourceHealth, composition: ["glyph"] },
    "source-health-connector": { render: renderSourceConnector, composition: ["connector", "notch"] },
    "national-dossier-fragment": { render: (asset) => renderDossier(asset, colors, false), composition: ["dossier", "frame", "connector", "corner", "tick", "notch"] },
    "city-dossier-fragment": { render: (asset) => renderDossier(asset, colors, true), composition: ["dossier", "frame", "connector", "corner", "tick", "notch"] },
    "evidence-stamp-ring": { render: renderEvidenceStamp, composition: ["glyph", "tick", "notch"] },
    "warning-edge-chevron": { render: renderWarningEdge, composition: ["corner", "tick", "notch"] }
  };

  return svgAssets.map((asset) => {
    if (asset.id === "event-badge-master") {
      return { asset, content: renderBadge(asset, colors), composition: ["frame", "corner", "tick"], derivedFrom: null };
    }
    if (glyphRenderers[asset.id]) {
      return { asset, content: renderBadge(asset, colors, asset.id), composition: ["frame", "corner", "tick", "glyph"], derivedFrom: "event-badge-master" };
    }
    if (asset.id === "risk-seal-master") {
      return { asset, content: renderSeal(asset, colors), composition: ["frame", "corner", "tick", "notch", "seal"], derivedFrom: null };
    }
    if (sealVariants[asset.id]) {
      return { asset, content: renderSeal(asset, colors, sealVariants[asset.id]), composition: ["frame", "corner", "tick", "notch", "seal"], derivedFrom: "risk-seal-master" };
    }
    const entry = uniqueRenderers[asset.id];
    if (!entry) throw new Error(`No renderer registered for SVG manifest asset: ${asset.id}`);
    const content = entry.render.length >= 2 ? entry.render(asset, colors) : entry.render(asset);
    return { asset, content, composition: entry.composition, derivedFrom: null };
  });
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function validateSvgSource(content, asset) {
  const failures = [];
  if (/<(?:text|title|desc|foreignObject|script|style|image)\b/i.test(content)) failures.push("contains a forbidden content-bearing SVG element");
  if (/[^\x09\x0A\x0D\x20-\x7E]/.test(content)) failures.push("contains non-ASCII source that could hide baked copy");
  const visibleText = content.replace(/<[^>]+>/g, "").trim();
  if (visibleText) failures.push("contains visible text nodes");
  const { width, height } = asset.dimensions;
  const rootPattern = new RegExp(`<svg[^>]*width="${width}"[^>]*height="${height}"[^>]*viewBox="0 0 ${width} ${height}"`);
  if (!rootPattern.test(content)) failures.push("does not match manifest width, height, and viewBox");
  if (!content.includes('fill="none"') || !content.includes('aria-hidden="true"')) failures.push("is not declared as a transparent decorative SVG");
  return failures;
}

async function checkOutputs(manifest, specs) {
  const failures = [];
  for (const spec of specs) {
    const outputPath = resolve(ASSET_DIR, spec.asset.filename);
    let actual;
    try {
      actual = await readFile(outputPath, "utf8");
    } catch {
      failures.push(`${spec.asset.filename}: generated file is missing`);
      continue;
    }
    if (actual !== spec.content) failures.push(`${spec.asset.filename}: output differs from deterministic generator`);
    for (const problem of validateSvgSource(actual, spec.asset)) failures.push(`${spec.asset.filename}: ${problem}`);
    const actualHash = sha256(actual);
    if (spec.asset.status !== "generated") failures.push(`${spec.asset.filename}: manifest status is not generated`);
    if (spec.asset.sha256 !== actualHash) failures.push(`${spec.asset.filename}: manifest sha256 does not match`);
    if (spec.asset.generator !== GENERATOR_ID) failures.push(`${spec.asset.filename}: manifest generator does not match`);
    if (spec.asset.generatedOn !== GENERATED_ON) failures.push(`${spec.asset.filename}: manifest generation date does not match`);
    if (spec.asset.license !== LICENSE_ID) failures.push(`${spec.asset.filename}: manifest license does not match`);
    if (JSON.stringify(spec.asset.composition) !== JSON.stringify(spec.composition)) failures.push(`${spec.asset.filename}: manifest composition does not match generator`);
    if ((spec.asset.derivedFrom ?? null) !== spec.derivedFrom) failures.push(`${spec.asset.filename}: manifest derivation does not match generator`);
  }
  const pngAssets = manifest.assets.filter((asset) => asset.filename.endsWith(".png"));
  let generatedPngCount = 0;
  let plannedPngCount = 0;
  for (const asset of pngAssets) {
    if (asset.status === "generated") generatedPngCount += 1;
    else if (asset.status === "planned") plannedPngCount += 1;
    else failures.push(`${asset.filename}: unsupported PNG status ${String(asset.status)}`);
  }
  if (failures.length) throw new Error(`Weather Boss SVG check failed:\n- ${failures.join("\n- ")}`);
  console.log(`Weather Boss SVG check passed (${specs.length} generated SVG assets, ${generatedPngCount} generated PNG assets, ${plannedPngCount} planned PNG assets).`);
}

async function generateOutputs(manifest, specs) {
  await mkdir(ASSET_DIR, { recursive: true });
  const metadataById = new Map();
  for (const spec of specs) {
    const failures = validateSvgSource(spec.content, spec.asset);
    if (failures.length) throw new Error(`${spec.asset.filename}: ${failures.join(", ")}`);
    await writeFile(resolve(ASSET_DIR, spec.asset.filename), spec.content, "utf8");
    metadataById.set(spec.asset.id, {
      status: "generated",
      generator: GENERATOR_ID,
      generatedOn: GENERATED_ON,
      license: LICENSE_ID,
      sha256: sha256(spec.content),
      reproducibility: `sha256:${sha256(spec.content)}`,
      composition: spec.composition,
      ...(spec.derivedFrom ? { derivedFrom: spec.derivedFrom } : {})
    });
  }
  const nextManifest = {
    ...manifest,
    status: "partially-generated",
    generatedAssetsPresent: true,
    generation: {
      svgGenerator: GENERATOR_ID,
      generatedOn: GENERATED_ON,
      algorithm: "deterministic-composable-svg-primitives-v1",
      license: LICENSE_ID
    },
    assets: manifest.assets.map((asset) => metadataById.has(asset.id) ? { ...asset, ...metadataById.get(asset.id) } : asset)
  };
  await writeFile(MANIFEST_PATH, `${JSON.stringify(nextManifest, null, 2)}\n`, "utf8");
  console.log(`Generated ${specs.length} Weather Boss SVG assets.`);
}

async function main() {
  const manifest = JSON.parse(await readFile(MANIFEST_PATH, "utf8"));
  const specs = createSpecs(manifest);
  if (CHECK_MODE) await checkOutputs(manifest, specs);
  else await generateOutputs(manifest, specs);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
