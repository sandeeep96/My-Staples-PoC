// Client deck for Pat: intro, Category Recommendations (decision picture), Tech Architecture, thank you.
// Every number comes from Outputs_v3/final/summary_v3.json (written by run_framework.py).
// Run:  cd Codes/ppt_build && node build_ppt.js        (env PPT_VERSION=v2 for the next version)
// Output: ppt/Staples_Category_Recommendations_<version>.pptx  - one file per version, never overwrite a shared one.
const fs = require("fs");
const path = require("path");
const pptxgen = require("pptxgenjs");
const React = require("react");
const ReactDOMServer = require("react-dom/server");
const sharp = require("sharp");
const fa = require("react-icons/fa");
const { applyTheme } = require("./apply_theme.js");

const VERSION = process.env.PPT_VERSION || "v1";
const ROOT = path.resolve(__dirname, "..", "..");
const S = JSON.parse(fs.readFileSync(path.join(ROOT, "Outputs_v3", "final", "summary_v3.json"), "utf8"));
const OUT = path.join(ROOT, "ppt", `Staples_Category_Recommendations_${VERSION}.pptx`);

// ---------------------------------------------------------------------------------------
// Theme and palette (zone colours match the HTML report and the Excel workbook)
const THEME = {
  name: "Staples Category PoC",
  headFontFace: "Calibri",
  bodyFontFace: "Calibri",
  colors: {
    dk1: "1B1F2A", lt1: "FFFFFF", dk2: "14213D", lt2: "EEF3FB",
    accent1: "1F4E9A", accent2: "008300", accent3: "2A78D6", accent4: "EDA100", accent5: "E34948", accent6: "CC0000",
    hlink: "1F4E9A", folHlink: "6B4FA0",
  },
};
const HEX = { ink: "1B1F2A", muted: "5B6170", faint: "8A909C", rule: "C9CED8", navy: "14213D", blue: "1F4E9A",
  ice: "D6E4FA", tint: "EEF3FB", red: "CC0000", white: "FFFFFF" };
const ZONE = {
  "CURATE": { fill: "008300", text: "006B00", short: "CURATE" },
  "VERTICAL EXTENSION": { fill: "2A78D6", text: "1F5FB0", short: "VERTICAL EXT" },
  "REVIEW": { fill: "EDA100", text: "8F6000", short: "REVIEW" },
  "1P-CORE GAP": { fill: "E34948", text: "B8282A", short: "1P-CORE GAP" },
  "OFF-BRAND": { fill: "8C8C8C", text: "6E6E6E", short: "OFF-BRAND" },
};
const fmt = (n) => Number(n).toLocaleString("en-US");

const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE"; // 13.333 x 7.5 in
pres.author = "Analytics team";
pres.title = "Staples marketplace - category recommendations";
pres.theme = { headFontFace: THEME.headFontFace, bodyFontFace: THEME.bodyFontFace };
const C = pres.SchemeColor;
const W = 13.333, H = 7.5;

// ---------------------------------------------------------------------------------------
// Layouts
pres.defineSlideMaster({
  title: "DARK_TITLE",
  background: { color: C.text2 },
  objects: [
    { placeholder: { options: { name: "kicker", type: "body", x: 0.8, y: 1.9, w: 8.4, h: 0.4, fontSize: 14, bold: true,
      color: "F2A7A7", charSpacing: 3, margin: 0 }, text: "" } },
    { placeholder: { options: { name: "title", type: "title", x: 0.8, y: 2.35, w: 8.6, h: 1.6, fontSize: 44, bold: true,
      color: C.background1, align: "left", valign: "top", margin: 0 }, text: "" } },
    { placeholder: { options: { name: "body", type: "body", x: 0.8, y: 4.05, w: 8.3, h: 1.1, fontSize: 18,
      color: "C9D3E6", valign: "top", margin: 0 }, text: "" } },
    { placeholder: { options: { name: "footer", type: "body", x: 0.8, y: 6.55, w: 8.0, h: 0.35, fontSize: 12,
      color: "9AA6BF", margin: 0 }, text: "" } },
  ],
});
pres.defineSlideMaster({
  title: "DARK_CLOSE",
  background: { color: C.text2 },
  objects: [
    { placeholder: { options: { name: "kicker", type: "body", x: 0.8, y: 2.3, w: 8.4, h: 0.4, fontSize: 14, bold: true,
      color: "F2A7A7", charSpacing: 3, margin: 0 }, text: "" } },
    { placeholder: { options: { name: "title", type: "title", x: 0.8, y: 2.75, w: 8.6, h: 1.0, fontSize: 54, bold: true,
      color: C.background1, align: "left", valign: "top", margin: 0 }, text: "" } },
    { placeholder: { options: { name: "body", type: "body", x: 0.8, y: 3.95, w: 7.6, h: 0.5, fontSize: 20,
      color: "C9D3E6", valign: "top", margin: 0 }, text: "" } },
    { placeholder: { options: { name: "footer", type: "body", x: 0.8, y: 6.55, w: 8.0, h: 0.35, fontSize: 12,
      color: "9AA6BF", margin: 0 }, text: "" } },
  ],
});
pres.defineSlideMaster({
  title: "CONTENT",
  background: { color: C.background1 },
  objects: [
    { placeholder: { options: { name: "kicker", type: "body", x: 0.6, y: 0.32, w: 9, h: 0.3, fontSize: 12, bold: true,
      color: C.accent6, charSpacing: 2, margin: 0 }, text: "" } },
    { placeholder: { options: { name: "title", type: "title", x: 0.6, y: 0.6, w: 12.1, h: 0.62, fontSize: 32, bold: true,
      color: C.text2, align: "left", valign: "middle", margin: 0 }, text: "" } },
    { placeholder: { options: { name: "body", type: "body", x: 0.6, y: 1.22, w: 12.1, h: 0.34, fontSize: 14,
      color: "5B6170", valign: "middle", margin: 0 }, text: "" } },
  ],
  slideNumber: { x: 12.45, y: 7.08, w: 0.5, h: 0.25, fontSize: 10, color: "8A909C", align: "right" },
});

// ---------------------------------------------------------------------------------------
// Helpers
const zoneCounts = S.opportunities.by_zone;
const OPP = S.opportunities.table;
const shortName = (x, n = 30) => {
  x = String(x).split(" (e.g.")[0];
  return x.length <= n ? x : x.slice(0, n - 1).trimEnd() + "…";
};

async function icon(Comp, color, size = 256) {
  const svg = ReactDOMServer.renderToStaticMarkup(React.createElement(Comp, { size, color: "#" + color }));
  const buf = await sharp(Buffer.from(svg)).png().toBuffer();
  return "image/png;base64," + buf.toString("base64");
}

// Decorative bubble motif for the dark slides (echoes the decision picture)
function bubbleMotif(slide) {
  const b = [
    [10.7, 1.25, 1.7, "CURATE", 5], [9.75, 3.05, 1.05, "VERTICAL EXTENSION", 5], [11.5, 3.3, 1.35, "REVIEW", 5],
    [10.45, 4.85, 0.75, "1P-CORE GAP", 5], [12.0, 5.2, 0.5, "CURATE", 30], [9.35, 5.45, 0.4, "REVIEW", 30],
    [12.4, 1.1, 0.38, "VERTICAL EXTENSION", 30],
  ];
  b.forEach(([x, y, d, z, t], i) => slide.addShape(pres.shapes.OVAL, {
    x, y, w: d, h: d, fill: { color: ZONE[z].fill, transparency: t }, line: { color: HEX.navy, width: 0 },
    objectName: `motif_bubble_${i + 1}` }));
}

// ---------------------------------------------------------------------------------------
// Slide 1 - intro
function slideIntro() {
  pres.addSection({ title: "Introduction" });
  const s = pres.addSlide({ masterName: "DARK_TITLE", sectionTitle: "Introduction" });
  bubbleMotif(s);
  s.addText("STAPLES.COM MARKETPLACE  ·  CATEGORY PoC", { placeholder: "kicker" });
  s.addText("Where Staples can grow its marketplace", { placeholder: "title" });
  s.addText("Which categories Staples could open to marketplace sellers: what Office Depot, West Elm, Wayfair, "
    + "Amazon and Walmart carry that Staples does not", { placeholder: "body" });
  s.addText("Prepared for Pat  ·  October 2026", { placeholder: "footer" });
  s.addNotes("Purpose: show Pat which categories Staples could open to marketplace sellers, and how we arrived at them. "
    + "Two slides: the recommendations (one decision picture), then the architecture behind them.");
}

// ---------------------------------------------------------------------------------------
// Slide 2 - category recommendations: opportunities on AAS x CRS, top 5 labelled per zone
function slideRecommendations() {
  pres.addSection({ title: "Category recommendations" });
  const s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Category recommendations" });
  const cfg = S.config;
  const nOpen = (zoneCounts["CURATE"] || 0) + (zoneCounts["VERTICAL EXTENSION"] || 0);
  s.addText("CATEGORY RECOMMENDATIONS", { placeholder: "kicker" });
  s.addText(`${nOpen} category opportunities to open to marketplace sellers`, { placeholder: "title" });
  s.addText(`${OPP.length} opportunities by adjacency and cannibalisation risk  ·  bubble size = opportunity score  ·  `
    + "labels = top 5 per zone (1P-CORE GAP not labelled)", { placeholder: "body" });

  // plot frame
  const XMIN = -4, XMAX = 92, YMIN = 35, YMAX = 103;
  const PX0 = 1.15, PX1 = 12.75, PY0 = 1.78, PY1 = 5.92;
  const SX = (PX1 - PX0) / (XMAX - XMIN), SY = (PY1 - PY0) / (YMAX - YMIN);
  const X = (c) => PX0 + (c - XMIN) * SX;
  const Y = (a) => PY1 - (a - YMIN) * SY;

  // zone bands
  const bands = [
    ["1P-CORE GAP", cfg.crs_hi, XMAX, YMIN, YMAX], ["REVIEW", cfg.crs_lo, cfg.crs_hi, YMIN, YMAX],
    ["CURATE", XMIN, cfg.crs_lo, cfg.aas_hi, YMAX], ["VERTICAL EXTENSION", XMIN, cfg.crs_lo, cfg.aas_lo, cfg.aas_hi],
    ["OFF-BRAND", XMIN, cfg.crs_lo, YMIN, cfg.aas_lo],
  ];
  bands.forEach(([z, x0, x1, y0, y1]) => s.addShape(pres.shapes.RECTANGLE, {
    x: X(x0), y: Y(y1), w: X(x1) - X(x0), h: Y(y0) - Y(y1), fill: { color: ZONE[z].fill, transparency: 91 },
    line: { color: ZONE[z].fill, width: 0, transparency: 100 }, objectName: `zone_${z}` }));
  // zone boundaries (dashed)
  const dash = { color: "9AA0AA", width: 1, dashType: "dash" };
  [cfg.crs_lo, cfg.crs_hi].forEach((c) => s.addShape(pres.shapes.LINE, { x: X(c), y: PY0, w: 0, h: PY1 - PY0, line: dash }));
  [cfg.aas_lo, cfg.aas_hi].forEach((a) => s.addShape(pres.shapes.LINE, { x: PX0, y: Y(a), w: X(cfg.crs_lo) - PX0, h: 0, line: dash }));
  // axes
  s.addShape(pres.shapes.LINE, { x: PX0, y: PY1, w: PX1 - PX0, h: 0, line: { color: "7A808C", width: 1 } });
  s.addShape(pres.shapes.LINE, { x: PX0, y: PY0, w: 0, h: PY1 - PY0, line: { color: "7A808C", width: 1 } });
  const tick = { fontSize: 11, color: HEX.muted, margin: 0, isTextBox: true };
  [0, 20, 40, 60, 80].forEach((c) => s.addText(String(c), { ...tick, x: X(c) - 0.3, y: PY1 + 0.05, w: 0.6, h: 0.22, align: "center" }));
  [40, 60, 80, 100].forEach((a) => s.addText(String(a), { ...tick, x: PX0 - 0.5, y: Y(a) - 0.11, w: 0.42, h: 0.22, align: "right" }));
  s.addText("Cannibalisation risk to Staples 1P  (CRS, 0–100)  →", { ...tick, fontSize: 12, bold: true, color: HEX.ink,
    x: PX0, y: PY1 + 0.3, w: PX1 - PX0, h: 0.26, align: "center" });
  s.addText("Adjacency to what Staples sells  (AAS)  →", { ...tick, fontSize: 12, bold: true, color: HEX.ink,
    x: 0.42 - 2.07, y: (PY0 + PY1) / 2 - 0.13, w: 4.14, h: 0.26, align: "center", rotate: 270 });

  // zone tags (also obstacles for labels)
  const obstacles = [];
  const tag = (txt, z, x, y, w, align) => {
    s.addText(txt, { x, y, w, h: 0.26, fontSize: 12, bold: true, color: ZONE[z].text, align, margin: 0, isTextBox: true,
      charSpacing: 1, objectName: `tag_${z}` });
    obstacles.push({ x, y, w, h: 0.26 });
  };
  tag("CURATE", "CURATE", X(XMIN) + 0.1, PY0 + 0.06, 1.2, "left");
  tag("VERTICAL EXTENSION", "VERTICAL EXTENSION", X(cfg.crs_lo) - 2.3, Y(cfg.aas_lo) - 0.32, 2.2, "right");
  tag("OFF-BRAND  (pass, not plotted)", "OFF-BRAND", X(XMIN) + 0.1, Y(cfg.aas_lo) + 0.02, 3.0, "left");
  tag("REVIEW", "REVIEW", X(cfg.crs_lo) + 0.1, PY1 - 0.34, 1.2, "left");
  tag("1P-CORE GAP", "1P-CORE GAP", PX1 - 1.8, PY1 - 0.34, 1.7, "right");

  // bubbles
  const Omax = Math.max(...OPP.map((r) => r.O_sum));
  const diam = (o) => 0.16 + 0.32 * Math.sqrt(Math.max(o, 0) / Omax);
  const pts = OPP.map((r) => ({ r, cx: X(Math.min(r.CRS, XMAX)), cy: Y(Math.min(Math.max(r.AAS, YMIN), YMAX)), d: diam(r.O_sum) }));
  const order = ["1P-CORE GAP", "REVIEW", "VERTICAL EXTENSION", "CURATE"];
  order.forEach((z) => pts.filter((p) => p.r.label === z).sort((a, b) => b.d - a.d).forEach((p) =>
    s.addShape(pres.shapes.OVAL, { x: p.cx - p.d / 2, y: p.cy - p.d / 2, w: p.d, h: p.d,
      fill: { color: ZONE[z].fill, transparency: 22 }, line: { color: HEX.white, width: 1 },
      objectName: `bubble_${p.r.opportunity_id || shortName(p.r.lead)}` })));

  // labels: top 5 per zone (1P-CORE GAP unlabelled), greedy placement away from bubbles, labels and tags
  const LBL_H = 0.25;
  const textW = (t) => 0.088 * t.length + 0.16;
  const toLabel = [];
  ["CURATE", "VERTICAL EXTENSION", "REVIEW"].forEach((z) =>
    pts.filter((p) => p.r.label === z).sort((a, b) => a.r.rank_in_zone - b.r.rank_in_zone).slice(0, 5)
      .forEach((p) => toLabel.push({ ...p, text: shortName(p.r.lead), z })));
  const overlap = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x))
    * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  // the band (zone rectangle) each bubble sits in: its label stays inside it
  const bandOf = (L) => {
    const c = L.r.CRS, aa = L.r.AAS;
    if (c >= cfg.crs_lo) return { x: X(cfg.crs_lo), y: PY0, w: X(cfg.crs_hi) - X(cfg.crs_lo), h: PY1 - PY0 };
    if (aa >= cfg.aas_hi) return { x: PX0, y: PY0, w: X(cfg.crs_lo) - PX0, h: Y(cfg.aas_hi) - PY0 };
    return { x: PX0, y: Y(cfg.aas_hi), w: X(cfg.crs_lo) - PX0, h: Y(cfg.aas_lo) - Y(cfg.aas_hi) };
  };
  const segX = (p1, p2, p3, p4) => {
    const d = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    return d(p1, p2, p3) * d(p1, p2, p4) < 0 && d(p3, p4, p1) * d(p3, p4, p2) < 0;
  };
  // manual placement after visual QA: { "Lead name": [dx, dy, mode] } label anchor relative to the bubble centre (inches);
  // mode "l" = dx is the label's left edge
  const OVERRIDE = { "Forklift Booms": [-0.43, -0.6, "l"], "Microscope Sample Slides": [0.3, 0], "Calibration": [0.3, 0.31] };
  const boxFor = (L, dx, dy, mode) => {
    const w = textW(L.text), ax = L.cx + dx, ay = L.cy + dy;
    const box = { x: dx >= 0 ? ax : ax - w, y: ay - LBL_H / 2, w, h: LBL_H };
    if (Math.abs(dx) < 0.2) box.x = ax - w / 2;
    if (mode === "l") box.x = ax;
    // leader end = nearest point of the box to the bubble centre
    box.tx = Math.min(Math.max(L.cx, box.x), box.x + box.w);
    box.ty = Math.min(Math.max(L.cy, box.y), box.y + box.h);
    return box;
  };
  const costOf = (L, box, others) => {
    const lead = Math.hypot(box.tx - L.cx, box.ty - L.cy);
    let cost = 2.0 * lead;
    const band = bandOf(L);
    const inside = overlap(box, band);
    cost += 60 * (box.w * box.h - inside);
    if (box.x < PX0 + 0.03 || box.x + box.w > PX1 || box.y < PY0 + 0.02 || box.y + box.h > PY1 - 0.02) cost += 100;
    obstacles.forEach((q) => { cost += 400 * overlap(box, q); });
    pts.forEach((p) => {
      cost += 200 * overlap(box, { x: p.cx - p.d / 2 + 0.03, y: p.cy - p.d / 2 + 0.03, w: p.d - 0.06, h: p.d - 0.06 });
      if (p.r !== L.r && segCircle(L.cx, L.cy, box.tx, box.ty, p)) cost += 1.2;
    });
    others.forEach((q) => {
      cost += 400 * overlap(box, { x: q.x - 0.04, y: q.y - 0.03, w: q.w + 0.08, h: q.h + 0.06 });
      if (segX({ x: L.cx, y: L.cy }, { x: box.tx, y: box.ty }, { x: q.L.cx, y: q.L.cy }, { x: q.tx, y: q.ty })) cost += 20;
      if (segBox(L.cx, L.cy, box.tx, box.ty, q)) cost += 20;
      if (segBox(q.L.cx, q.L.cy, q.tx, q.ty, box)) cost += 20;
    });
    return cost;
  };
  const cands = [];
  for (const rad of [0.3, 0.45, 0.6, 0.8, 1.0, 1.25, 1.55])
    for (let ang = 0; ang < 360; ang += 15) cands.push([rad * Math.cos(ang * Math.PI / 180), -rad * Math.sin(ang * Math.PI / 180) * 0.8]);
  const bestFor = (L, others) => {
    const list = OVERRIDE[L.text] ? [OVERRIDE[L.text]] : cands;
    let best = null;
    for (const [dx, dy, mode] of list) {
      const box = boxFor(L, dx, dy, mode), cost = costOf(L, box, others);
      if (!best || cost < best.cost) best = { ...box, cost, L };
    }
    return best;
  };
  const crowd = (L) => pts.filter((p) => Math.hypot(p.cx - L.cx, p.cy - L.cy) < 0.7).length;
  toLabel.sort((a, b) => crowd(b) - crowd(a) || b.d - a.d);
  let placed = [];
  toLabel.forEach((L) => placed.push(bestFor(L, placed)));
  for (let pass = 0; pass < 6; pass++)            // improvement passes: re-place each label given all the others
    placed = placed.map((b, i) => bestFor(b.L, placed.filter((_, j) => j !== i)));
  function segCircle(x0, y0, x1, y1, p) {
    for (let t = 0.15; t <= 1; t += 0.05) {
      const x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
      if (Math.hypot(x - p.cx, y - p.cy) < p.d / 2 - 0.02) return true;
    }
    return false;
  }
  function segBox(x0, y0, x1, y1, b) {
    for (let t = 0; t <= 0.97; t += 0.05) {
      const x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
      if (x > b.x && x < b.x + b.w && y > b.y && y < b.y + b.h) return true;
    }
    return false;
  }
  placed.forEach((b) => {
    const { L } = b;
    // leader line from bubble edge to the label's nearest edge
    const tx = b.tx, ty = b.ty;
    const dist = Math.hypot(tx - L.cx, ty - L.cy);
    if (dist > L.d / 2 + 0.04) {
      const ux = (tx - L.cx) / dist, uy = (ty - L.cy) / dist;
      const sx = L.cx + ux * L.d / 2 * 0.9, sy = L.cy + uy * L.d / 2 * 0.9;
      s.addShape(pres.shapes.LINE, { x: Math.min(sx, tx), y: Math.min(sy, ty), w: Math.abs(tx - sx), h: Math.abs(ty - sy),
        flipH: (tx < sx) !== (ty < sy) ? true : false, line: { color: ZONE[L.z].text, width: 0.9 },
        objectName: `leader_${L.text}` });
    }
    s.addText(L.text, { x: b.x, y: b.y, w: b.w, h: b.h, fontSize: 12, bold: true, color: ZONE[L.z].text,
      align: "center", valign: "middle", margin: 0, isTextBox: true, fill: { color: HEX.white, transparency: 12 },
      objectName: `label_${L.text}` });
  });

  // zone legend strip: count + action per zone
  const actions = {
    "CURATE": "Open to curated sellers now",
    "VERTICAL EXTENSION": "Phase 2, via a vertical Staples serves",
    "REVIEW": "Merchant call: sits next to a 1P line",
    "1P-CORE GAP": "Keep in 1P, fix the range",
  };
  const LX0 = 0.6, LW = (12.3 - LX0 - 3 * 0.2) / 4, LY = 6.58;
  order.slice().reverse().forEach((z, i) => {
    const x = LX0 + i * (LW + 0.2);
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y: LY, w: LW, h: 0.62, rectRadius: 0.08,
      fill: { color: ZONE[z].fill, transparency: 90 }, line: { color: ZONE[z].fill, width: 0, transparency: 100 },
      objectName: `legend_${z}` });
    s.addShape(pres.shapes.OVAL, { x: x + 0.14, y: LY + 0.2, w: 0.22, h: 0.22, fill: { color: ZONE[z].fill },
      line: { color: HEX.white, width: 0.75 } });
    s.addText([
      { text: `${zoneCounts[z] || 0}  ${ZONE[z].short}`, options: { bold: true, color: ZONE[z].text, fontSize: 13, breakLine: true } },
      { text: actions[z], options: { color: HEX.ink, fontSize: 11 } },
    ], { x: x + 0.46, y: LY + 0.04, w: LW - 0.52, h: 0.54, valign: "middle", margin: 0, isTextBox: true });
  });

  const top5 = (z) => OPP.filter((r) => r.label === z).sort((a, b) => a.rank_in_zone - b.rank_in_zone).slice(0, 5)
    .map((r) => `${shortName(r.lead, 60)} (${r.units.split(" | ").slice(1, 3).join(", ") || "single sub-category"})`).join("; ");
  s.addNotes(
    `How to read: each bubble is one category opportunity, i.e. related sub-categories in one zone and one Staples department. `
    + `Up = closer to what Staples already sells (AAS, Adjacency Affinity Score). Right = more risk of taking sales from Staples' own range `
    + `(CRS, Cannibalisation Risk Score). Bubble size = total opportunity score O. Only sub-categories carried by 2+ competitors count.\n\n`
    + `CURATE (${zoneCounts["CURATE"]}), open to curated sellers now: ${top5("CURATE")}.\n\n`
    + `VERTICAL EXTENSION (${zoneCounts["VERTICAL EXTENSION"]}), phase 2 through a vertical Staples already serves: ${top5("VERTICAL EXTENSION")}.\n\n`
    + `REVIEW (${zoneCounts["REVIEW"]}), merchant decision with sales and margin data: ${top5("REVIEW")}.\n\n`
    + `1P-CORE GAP (${zoneCounts["1P-CORE GAP"]}), keep in 1P and fix the range (not labelled). `
    + `Off-brand and brand-unsafe categories (e.g. adult, weapons, livestock) are screened out and not plotted.`);
}

// ---------------------------------------------------------------------------------------
// Slide 3 - tech architecture (phase arrows over dashed stage boxes, in the style of the shared sample)
async function slideArchitecture() {
  pres.addSection({ title: "Tech architecture" });
  const s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Tech architecture" });
  s.addText("TECH ARCHITECTURE", { placeholder: "kicker" });
  s.addText("How the recommendations are built", { placeholder: "title" });
  s.addText("Six navigation trees → two independent matching engines → one scoring and decision framework",
    { placeholder: "body" });

  const rr = S.row_reconciliation, lab = S.labelled_rows, ver = S.verification, cfg = S.config;
  const nTrees = Object.keys(S.retailers).length;
  const kappa = S.label_agreement.kappa.toFixed(2);

  // columns
  const X0 = 0.6, X1 = 12.73, GAP = 0.26, NC = 6;
  const CW = (X1 - X0 - GAP * (NC - 1)) / NC;
  const cx = (i) => X0 + i * (CW + GAP);
  const BLUE = "1F4E9A", ICE = "C9DAF8", ICE2 = "DCE7FB";

  // super-phase arrows (row 1) and phase arrows (row 2)
  const arrow = (x, y, w, h, txt, fill, name, fs = 13) => s.addText(txt, {
    shape: pres.shapes.RIGHT_ARROW, x, y, w, h, fill: { color: fill }, line: { color: fill, width: 0 },
    fontSize: fs, bold: true, color: HEX.navy, align: "center", valign: "middle", margin: [0, 18, 0, 6], objectName: name });
  const supers = [["Data foundation", 0, 1], ["Matching engine", 2, 3], ["Decision framework", 4, 5]];
  supers.forEach(([t, a, b]) => arrow(cx(a), 1.72, cx(b) + CW - cx(a) + 0.12, 0.44, t, ICE, `phase_${t}`, 14));
  const phases = ["Acquire", "Clean & harmonise", "Match (V ∥ G)", "Combine & verify", "Score", "Zone & rank"];
  phases.forEach((t, i) => arrow(cx(i), 2.24, CW + 0.12, 0.38, `${i + 1}  ${t}`, ICE2, `step_${i + 1}`, 12));

  // dashed stage boxes
  const BY = 2.78, BH = 3.72;
  for (let i = 0; i < NC; i++) {
    s.addShape(pres.shapes.RECTANGLE, { x: cx(i), y: BY, w: CW, h: BH, fill: { color: i === 2 || i === 3 ? "F5F8FD" : HEX.white },
      line: { color: "8DA2C8", width: 1, dashType: "dash" }, objectName: `stage_${i + 1}` });
    if (i < NC - 1) s.addShape(pres.shapes.RIGHT_ARROW, { x: cx(i) + CW + 0.03, y: BY + BH / 2 - 0.1, w: GAP - 0.06, h: 0.2,
      fill: { color: BLUE }, line: { color: BLUE, width: 0 } });
  }
  const txt = (t, x, y, w, h, o = {}) => s.addText(t, { x, y, w, h, fontSize: 11, color: HEX.ink, margin: 0, isTextBox: true,
    valign: "top", ...o });
  const ic = async (Comp, x, y, d, color = BLUE) => s.addImage({ data: await icon(Comp, color), x, y, w: d, h: d });

  // 1 Acquire: six trees
  {
    const x = cx(0), names = ["Staples", "Office Depot", "West Elm", "Wayfair", "Amazon", "Walmart"];
    for (let k = 0; k < 6; k++) {
      const cw = (CW - 0.1) / 2, col = k % 2, row = Math.floor(k / 2), xx = x + 0.05 + col * cw, yy = BY + 0.2 + row * 0.86;
      await ic(fa.FaFileExcel, xx + (cw - 0.44) / 2, yy, 0.44, k === 0 ? HEX.red : "1D6F42");
      txt(names[k], xx, yy + 0.48, cw, 0.24, { align: "center", fontSize: 11, bold: k === 0 });
    }
    txt([{ text: `${nTrees} navigation trees`, options: { bold: true, breakLine: true } },
      { text: `${fmt(rr.total_rows)} rows · ${rr.sheets} sheets`, options: { breakLine: true } },
      { text: "Staples = focal tree" }], x + 0.1, BY + 2.85, CW - 0.2, 0.9, { align: "center" });
  }
  // 2 Clean & harmonise
  {
    const x = cx(1);
    const items = [
      [fa.FaFilter, "One shared scope", "same departments for every retailer"],
      [fa.FaLayerGroup, "Fold & place", "deep levels folded, orphan pages placed"],
      [fa.FaClipboardCheck, "Row reconciliation", "every Excel row used or explained"],
    ];
    for (let k = 0; k < items.length; k++) {
      const yy = BY + 0.2 + k * 0.9;
      await ic(items[k][0], x + 0.12, yy + 0.04, 0.4);
      txt([{ text: items[k][1], options: { bold: true, breakLine: true } }, { text: items[k][2], options: { color: HEX.muted } }],
        x + 0.6, yy, CW - 0.68, 0.8);
    }
    txt([{ text: `${fmt(S.competitor_shelves_compared)} competitor shelves`, options: { bold: true, breakLine: true } },
      { text: `${fmt(rr.mismatched_sheets)} unexplained rows` }], x + 0.1, BY + 2.85, CW - 0.2, 0.9, { align: "center" });
  }
  // 3 Match: two independent engines
  {
    const x = cx(2);
    const eng = [
      [fa.FaDatabase, "V · Vector", "bge-base embeddings in a Qdrant vector DB; nearest Staples shelf"],
      [fa.FaProjectDiagram, "G · Graph", "knowledge graph of all six trees; similarity flooding + PageRank"],
    ];
    for (let k = 0; k < 2; k++) {
      const yy = BY + 0.14 + k * 1.32;
      s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: x + 0.08, y: yy, w: CW - 0.16, h: 1.18, rectRadius: 0.06,
        fill: { color: HEX.white }, line: { color: "B8C7E3", width: 0.75 } });
      await ic(eng[k][0], x + 0.16, yy + 0.1, 0.34);
      txt(eng[k][1], x + 0.58, yy + 0.12, CW - 0.66, 0.3, { bold: true, fontSize: 12, color: HEX.navy, valign: "middle" });
      txt(eng[k][2], x + 0.16, yy + 0.5, CW - 0.32, 0.64, { color: HEX.muted });
    }
    txt("run independently, in parallel", x + 0.08, BY + 2.62, CW - 0.16, 0.22, { align: "center", italic: true,
      color: BLUE, fontSize: 10 });
    txt([{ text: `Calibrated per competitor`, options: { bold: true, breakLine: true } },
      { text: `${fmt(lab.total)} labelled checks` }], x + 0.1, BY + 2.95, CW - 0.2, 0.8, { align: "center" });
  }
  // 4 Combine & verify
  {
    const x = cx(3);
    const items = [
      [fa.FaCodeBranch, "Ensemble", "a gap only when both engines find no match"],
      [fa.FaUserCheck, "Verification loop", `${fmt(ver.checked)} flagged gaps reviewed by hand`],
      [fa.FaCheckDouble, "Second opinion", `blind relabel agrees: κ = ${kappa}`],
    ];
    for (let k = 0; k < items.length; k++) {
      const yy = BY + 0.2 + k * 0.9;
      await ic(items[k][0], x + 0.12, yy + 0.04, 0.4);
      txt([{ text: items[k][1], options: { bold: true, breakLine: true } }, { text: items[k][2], options: { color: HEX.muted } }],
        x + 0.6, yy, CW - 0.68, 0.8);
    }
    txt([{ text: "Hand labels override models", options: { bold: true, breakLine: true } },
      { text: `${fmt(ver.carried_under_other_name)} "gaps" were already sold under another name` }],
    x + 0.08, BY + 2.82, CW - 0.16, 0.85, { align: "center" });
  }
  // 5 Score: score chips
  {
    const x = cx(4);
    const chips = [["AAS", "Adjacency to Staples"], ["CRS", "Risk to 1P sales"], ["BFS", "Workplace brand fit"],
      ["EASE", "Ease of launch"], ["PC", "Peer consensus"]];
    chips.forEach(([a, b], k) => {
      const yy = BY + 0.16 + k * 0.5;
      s.addText(a, { shape: pres.shapes.ROUNDED_RECTANGLE, x: x + 0.12, y: yy, w: 0.66, h: 0.38, rectRadius: 0.05,
        fill: { color: BLUE }, line: { color: BLUE, width: 0 }, color: HEX.white, bold: true, fontSize: 11,
        align: "center", valign: "middle", margin: 0 });
      txt(b, x + 0.86, yy, CW - 0.92, 0.38, { valign: "middle" });
    });
    s.addText("O  opportunity score", { shape: pres.shapes.ROUNDED_RECTANGLE, x: x + 0.12, y: BY + 2.74, w: CW - 0.24,
      h: 0.4, rectRadius: 0.05, fill: { color: HEX.navy }, line: { color: HEX.navy, width: 0 }, color: HEX.white,
      bold: true, fontSize: 12, align: "center", valign: "middle", margin: 0 });
    txt("CRS discounts the score", x + 0.1, BY + 3.26, CW - 0.2, 0.5, { align: "center", color: HEX.muted });
  }
  // 6 Zone & rank
  {
    const x = cx(5);
    const zs = [["CURATE", "CURATE"], ["VERTICAL EXTENSION", "VERTICAL EXT"], ["REVIEW", "REVIEW"],
      ["1P-CORE GAP", "1P-CORE GAP"], ["OFF-BRAND", "OFF-BRAND · PASS"]];
    zs.forEach(([z, t], k) => s.addText(t, { shape: pres.shapes.ROUNDED_RECTANGLE, x: x + 0.12, y: BY + 0.16 + k * 0.5,
      w: CW - 0.24, h: 0.38, rectRadius: 0.05, fill: { color: ZONE[z].fill }, line: { color: ZONE[z].fill, width: 0 },
      color: HEX.white, bold: true, fontSize: 11, align: "center", valign: "middle", margin: 0 }));
    txt([{ text: `${OPP.length} opportunities`, options: { bold: true, breakLine: true } },
      { text: "zone × Staples department", options: { breakLine: true } },
      { text: `${fmt(cfg.n_sensitivity)}-run stress test`, options: { color: HEX.muted } }],
      x + 0.1, BY + 2.74, CW - 0.2, 1.0, { align: "center" });
  }
  // outputs ribbon
  s.addText([
    { text: "Outputs:  ", options: { bold: true, color: HEX.navy } },
    { text: "interactive HTML report  ·  Excel workbook with every sub-category, score and row  ·  this deck",
      options: { color: HEX.ink } }],
  { x: X0, y: 6.7, w: X1 - X0, h: 0.28, fontSize: 12, margin: 0, isTextBox: true, align: "center" });

  s.addNotes(
    "Left to right. 1 Acquire: the Staples tree plus five competitor trees, every row accounted for. "
    + "2 Clean: one shared scope, deep levels folded into their parents, Office Depot's orphan pages placed, row reconciliation. "
    + "3 Match: two independent engines. Method V reads category names with a sentence-embedding model (bge-base) and searches a "
    + "Qdrant vector database for the nearest Staples shelf. Method G builds a knowledge graph of all six trees and spreads "
    + "similarity through it (similarity flooding, PageRank). Each is calibrated per competitor on labelled checks. "
    + "4 Combine: a category counts as missing only when both engines agree; flagged gaps were reviewed by hand, and labelled rows "
    + "override the models. 5 Score: AAS adjacency, CRS cannibalisation risk, BFS workplace brand fit, EASE ease of launch and PC "
    + "peer consensus roll up into one opportunity score O, discounted by CRS. 6 Zone & rank: each category lands in a zone; "
    + "related sub-categories in the same zone and Staples department form one opportunity. A 500-run stress test and 200 "
    + "label bootstraps check that the zones hold.");
}

// ---------------------------------------------------------------------------------------
// Slide 4 - thank you
function slideThanks() {
  pres.addSection({ title: "Close" });
  const s = pres.addSlide({ masterName: "DARK_CLOSE", sectionTitle: "Close" });
  bubbleMotif(s);
  s.addText("STAPLES.COM MARKETPLACE  ·  CATEGORY PoC", { placeholder: "kicker" });
  s.addText("Thank you", { placeholder: "title" });
  s.addText("Questions and discussion", { placeholder: "body" });
  s.addText("Full detail: interactive HTML report and Excel workbook", { placeholder: "footer" });
}

// ---------------------------------------------------------------------------------------
(async () => {
  slideIntro();
  slideRecommendations();
  await slideArchitecture();
  slideThanks();
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  await pres.writeFile({ fileName: OUT });
  await applyTheme(OUT, THEME);
  console.log("wrote", OUT);
})();
