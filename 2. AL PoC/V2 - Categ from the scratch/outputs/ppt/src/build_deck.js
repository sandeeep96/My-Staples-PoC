// Builds the Staples Assortment PoC deck from deck_facts_<VERSION>.json.
// Usage (from outputs/ppt/src):  node build_deck.js V1
// Output: outputs/ppt/Staples_Assortment_PoC_Deck_<VERSION>.pptx (never overwrites an existing version).
const fs = require("fs");
const path = require("path");
const pptxgen = require("pptxgenjs");
const React = require("react");
const ReactDOMServer = require("react-dom/server");
const sharp = require("sharp");
const fa = require("react-icons/fa");
const tb = require("react-icons/tb");

const VERSION = process.argv[2] || "V1";
const FORCE = process.argv.includes("--force");
const F = JSON.parse(fs.readFileSync(path.join(__dirname, `deck_facts_${VERSION}.json`), "utf8"));
const OUT = path.resolve(__dirname, "..", `Staples_Assortment_PoC_Deck_${VERSION}.pptx`);
const LOGO = path.resolve(__dirname, "..", "assets", "latentview_logo.png");
if (fs.existsSync(OUT) && !FORCE) {
  console.error(`${OUT} exists. Versions are never overwritten: use the next version (or --force while iterating).`);
  process.exit(1);
}

// ---------- palette (LatentView house style, retailer colours for the comparison) ----------
const C = {
  navy: "13285B", blue: "1F4E9A", mid: "2F6FD0", sky: "8FB0E8", pale: "DCE7F8", paler: "EEF3FB",
  head: "B9CEF2", orange: "F5A623", text: "1F2937", muted: "5B6475", line: "C9D3E3", white: "FFFFFF",
  staples: "CC0000", wayfair: "7F187F", amazon: "C45500", amazonFill: "FF9900", amazonInk: "232F3E",
  strong: "1E8E5A", vector: "2F6FD0", gap: "B86E00", cond: "6B7280", warnFill: "FFF4E0",
};
const SEG = {
  "Hero · EXTEND": { fill: C.navy, ink: C.white, short: "HERO · EXTEND" },
  "Probable Hero · BUILD": { fill: C.mid, ink: C.white, short: "PROBABLE HERO · BUILD" },
  "Non-Hero · EXPLORE": { fill: C.sky, ink: C.navy, short: "NON-HERO · EXPLORE" },
};
const TIER = { Strong: C.strong, "Vector-led": C.vector, "Gap-led": C.gap, Conditional: C.cond };
const FONT = "Calibri";

// ---------- helpers ----------
async function icon(Comp, color, px = 256) {
  const svg = ReactDOMServer.renderToStaticMarkup(React.createElement(Comp, { color: "#" + color, size: px }));
  const buf = await sharp(Buffer.from(svg)).png().toBuffer();
  return "image/png;base64," + buf.toString("base64");
}
// "**bold**" markup -> pptxgenjs runs (bold runs take `hi` colour)
function runs(str, base = {}, hi = C.blue) {
  const out = [];
  str.split(/(\*\*[^*]+\*\*)/).filter(Boolean).forEach((part) => {
    const b = part.startsWith("**");
    out.push({ text: b ? part.slice(2, -2) : part, options: { ...base, bold: b || base.bold, color: b ? hi : base.color } });
  });
  return out;
}
// one paragraph of markup runs; breakLine only on its last run
function para(str, base = {}, hi = C.blue, last = false) {
  const r = runs(str, base, hi);
  if (!last) r[r.length - 1].options.breakLine = true;
  return r;
}
const money = (x) => "$" + (x >= 1000 ? Math.round(x).toLocaleString("en-US") : (Math.round(x) === x ? x : x.toFixed(2)));
const money0 = (x) => "$" + Math.round(x).toLocaleString("en-US");
const S = F.stats, B = F.bands, N = F.nodes;
const shortTitle = (t, n = 44) => {
  t = t.replace(/\s+/g, " ").trim();
  if (t.length <= n) return t;
  const cut = t.slice(0, n);
  return cut.slice(0, cut.lastIndexOf(" ")).replace(/[,\-–:;|]+$/, "") + "…";
};
function box(slide, x, y, w, h, fill, opts = {}) {
  slide.addShape(opts.rect ? "rect" : "roundRect", {
    x, y, w, h, fill: { color: fill }, line: opts.line ? { color: opts.line, width: opts.lineW || 0.75, dashType: opts.dash } : { color: fill, width: 0 },
    rectRadius: opts.rect ? undefined : (opts.r ?? 0.08), shadow: opts.shadow ? { type: "outer", color: "9AA5B8", blur: 4, offset: 1.5, angle: 90, opacity: 0.35 } : undefined,
    objectName: opts.name,
  });
}
function text(slide, t, x, y, w, h, o = {}) {
  slide.addText(t, { x, y, w, h, fontFace: FONT, fontSize: 12, color: C.text, valign: "top", margin: 0, isTextBox: true, ...o });
}
function circleIcon(slide, img, x, y, d, fill) {
  slide.addShape("ellipse", { x, y, w: d, h: d, fill: { color: fill }, line: { color: fill, width: 0 } });
  const p = d * 0.22;
  slide.addImage({ data: img, x: x + p, y: y + p, w: d - 2 * p, h: d - 2 * p });
}
function chip(slide, label, x, y, w, h, fill, ink = C.white, size = 9) {
  slide.addShape("roundRect", { x, y, w, h, fill: { color: fill }, line: { color: fill, width: 0 }, rectRadius: h / 2 });
  text(slide, label, x, y, w, h, { fontSize: size, bold: true, color: ink, align: "center", valign: "middle" });
}

(async () => {
  const pres = new pptxgen();
  pres.layout = "LAYOUT_WIDE"; // 13.333 x 7.5 in
  pres.author = "LatentView Analytics";
  pres.company = "LatentView Analytics";
  pres.title = "Staples Marketplace: Assortment Gap and Archetype Recommendation PoC";
  pres.theme = { headFontFace: FONT, bodyFontFace: FONT };

  const hasLogo = fs.existsSync(LOGO);
  const logoObj = hasLogo ? [{ image: { path: LOGO, x: 11.85, y: 0.22, w: 1.05, h: 0.62, sizing: { type: "contain", w: 1.05, h: 0.62 } } }] : [];

  pres.defineSlideMaster({
    title: "CONTENT",
    background: { color: C.white },
    objects: [
      { rect: { x: 0.45, y: 1.0, w: 1.1, h: 0.06, fill: { color: C.orange }, line: { color: C.orange, width: 0 } } },
      { rect: { x: 1.55, y: 1.0, w: 11.33, h: 0.06, fill: { color: C.blue }, line: { color: C.blue, width: 0 } } },
      { text: { text: "Staples × LatentView  |  Assortment Gap & Archetype PoC  |  Confidential", options: { x: 0.45, y: 7.14, w: 8, h: 0.24, fontFace: FONT, fontSize: 9, color: "7A8599", margin: 0 } } },
      ...logoObj,
      { placeholder: { options: { name: "title", type: "title", x: 0.45, y: 0.24, w: hasLogo ? 11.2 : 12.43, h: 0.72, fontFace: FONT, fontSize: 28, bold: true, color: C.blue, align: "left", valign: "middle", margin: 0 }, text: "" } },
    ],
    slideNumber: { x: 12.38, y: 7.12, w: 0.5, h: 0.26, fontFace: FONT, fontSize: 9, color: "7A8599", align: "right" },
  });
  pres.defineSlideMaster({ title: "DARK", background: { color: C.navy }, objects: [...(hasLogo ? [] : [])] });

  const ICON = {};
  const need = {
    cal: [tb.TbCalendar, C.white], bag: [tb.TbBackpack, C.white], desk: [tb.TbDesk, C.white], chair: [tb.TbArmchair, C.white],
    lamp: [tb.TbLamp, C.white], lunch: [tb.TbPaperBag, C.white], clock: [tb.TbClock, C.white], part: [tb.TbLayoutBoardSplit, C.white],
    coffee: [tb.TbCoffee, C.white], search: [fa.FaSearchDollar, C.blue], users: [fa.FaUsers, C.white], target: [fa.FaBullseye, C.white],
    hand: [fa.FaHandshake, C.white], cogs: [fa.FaCogs, C.white], home: [fa.FaHome, C.white], palette: [fa.FaPalette, C.white],
    store: [fa.FaStore, C.white], warn: [fa.FaExclamationTriangle, C.orange], userF: [fa.FaUserFriends, C.white],
    clip: [fa.FaClipboardCheck, C.white], scale: [fa.FaBalanceScale, C.white], srch: [fa.FaSearch, C.white],
    chart: [fa.FaChartLine, C.white], basket: [fa.FaShoppingBasket, C.white], globe: [fa.FaGlobe, C.white],
    dbS: [fa.FaDatabase, C.staples], dbA: [fa.FaDatabase, C.amazonFill], dbW: [fa.FaDatabase, C.wayfair],
    filter: [fa.FaFilter, C.blue], layer: [fa.FaLayerGroup, C.blue], sitemap: [fa.FaSitemap, C.blue],
    tags: [fa.FaTags, C.blue], puzzle: [fa.FaPuzzlePiece, C.blue], proj: [fa.FaProjectDiagram, C.blue],
    shield: [fa.FaShieldAlt, C.blue], check: [fa.FaCheckCircle, C.blue], storeB: [fa.FaStore, C.blue],
    brief: [fa.FaBriefcase, C.white], lightB: [fa.FaLightbulb, C.white], rocket: [fa.FaRocket, C.white],
    users2: [fa.FaUserTie, C.white], dollar: [fa.FaDollarSign, C.white], layersW: [fa.FaLayerGroup, C.white],
    mag: [fa.FaMagic, C.white], boxW: [fa.FaBoxOpen, C.white],
  };
  for (const [k, [comp, col]] of Object.entries(need)) ICON[k] = await icon(comp, col);
  const NODE_ICON = {
    Planners: "cal", Backpacks: "bag", "Office Desks": "desk", "Accent Chairs": "chair", "Desk Lamps": "lamp",
    "Lunch Bags": "lunch", Clocks: "clock", Partitions: "part", "Coffee Organizers": "coffee",
  };
  const ORDER = ["Planners", "Backpacks", "Office Desks", "Accent Chairs", "Desk Lamps", "Lunch Bags", "Clocks", "Partitions", "Coffee Organizers"];
  const SEGS = ["Hero · EXTEND", "Probable Hero · BUILD", "Non-Hero · EXPLORE"];
  const bySeg = (s) => ORDER.filter((k) => N[k].segment === s);
  const compColor = (c) => (c === "Amazon" ? C.amazon : C.wayfair);

  const T = F.totals;
  const fams9 = ORDER.reduce((a, k) => a + N[k].n_competitor, 0);
  const st9 = ORDER.reduce((a, k) => a + N[k].n_staples, 0);
  const dfS = Math.round(ORDER.reduce((a, k) => a + N[k].design_forward_staples, 0) / ORDER.length);
  const dfC = Math.round(ORDER.reduce((a, k) => a + N[k].design_forward_competitor, 0) / ORDER.length);
  const SRC = F.sourcing;

  // ======================= 0. TITLE =======================
  pres.addSection({ title: "Opening" });
  let s = pres.addSlide({ masterName: "DARK", sectionTitle: "Opening" });
  text(s, "PROOF OF CONCEPT  ·  Q1 2027 MARKETPLACE PLANNING", 0.7, 1.45, 7.3, 0.35, { fontSize: 14, bold: true, color: C.orange, charSpacing: 1 });
  text(s, "Staples Marketplace", 0.7, 1.9, 7.3, 0.95, { fontSize: 44, bold: true, color: C.white });
  text(s, "Assortment Gap & Archetype Recommendation", 0.7, 2.85, 7.3, 0.6, { fontSize: 26, color: "CADCFC" });
  text(s, "Which competitor products can Staples add through its marketplace, without cannibalising the assortment it already sells?", 0.7, 3.75, 6.9, 0.95, { fontSize: 16, italic: true, color: "E5ECF8" });
  text(s, "LatentView Analytics  ·  October 2026", 0.7, 6.25, 7, 0.35, { fontSize: 14, color: "CADCFC" });
  // 3x3 node grid motif (the 9 focus nodes, columns = segments)
  SEGS.forEach((seg, ci) => {
    const x = 8.35 + ci * 1.45;
    text(s, SEG[seg].short.split(" · ")[0], x, 1.15, 1.3, 0.3, { fontSize: 10, bold: true, color: "CADCFC", align: "center" });
    bySeg(seg).forEach((k, ri) => {
      const y = 1.5 + ri * 1.55;
      box(s, x, y, 1.3, 1.4, ci === 0 ? "1C3A7A" : ci === 1 ? "24498F" : "2D5AA6", { r: 0.12 });
      s.addImage({ data: ICON[NODE_ICON[k]], x: x + 0.37, y: y + 0.18, w: 0.56, h: 0.56 });
      text(s, k, x + 0.05, y + 0.86, 1.2, 0.42, { fontSize: 10.5, color: C.white, align: "center", valign: "middle" });
    });
  });
  s.addNotes("Opening. This PoC answers one question for each of 9 Staples nodes: what does the leading competitor (Amazon or Wayfair) carry that Staples does not, and which of those items can Staples add through the marketplace without cannibalising its own assortment. External data only.");

  // ======================= 1. PROBLEM STATEMENT =======================
  pres.addSection({ title: "Context" });
  s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Context" });
  s.addText("Business Problem & Our Approach", { placeholder: "title" });
  // left: business problem
  const LX = 0.45, LW = 2.6, RX = 10.28, RW = 2.6, CX = 3.3, CW = 6.73;
  box(s, LX, 1.3, LW, 0.6, C.head, { r: 0.1 });
  text(s, "Business Problem", LX, 1.3, LW, 0.6, { fontSize: 16, bold: true, color: C.navy, align: "center", valign: "middle" });
  s.addShape("ellipse", { x: LX + 0.8, y: 2.05, w: 1.0, h: 1.0, fill: { color: C.paler }, line: { color: C.sky, width: 2 } });
  s.addImage({ data: ICON.search, x: LX + 1.05, y: 2.3, w: 0.5, h: 0.5 });
  [
    "Grow a **curated** marketplace that extends Staples' core, not a full-category dump",
    "**Protect 1P:** add only true whitespace that will not cannibalise what Staples already sells",
    "Decide with **external data only:** Staples.com, Amazon and Wayfair listings",
  ].forEach((t, i) => {
    const y = 3.2 + i * 1.2;
    box(s, LX, y, LW, 1.05, C.pale, { r: 0.12 });
    text(s, runs(t, { fontSize: 12, color: C.navy }, C.navy), LX + 0.15, y, LW - 0.3, 1.05, { align: "center", valign: "middle" });
  });
  // centre
  box(s, CX, 1.3, CW, 0.6, C.head, { r: 0.1 });
  text(s, "Solving What Matters: Gaps, Safety & Sourcing", CX, 1.3, CW, 0.6, { fontSize: 16, bold: true, color: C.navy, align: "center", valign: "middle" });
  const quad = [
    { ic: "users", lab: "Who?", head: "Stakeholders", body: ["Head of Staples Marketplace", "Category & merchandising teams", "Marketplace seller recruitment"] },
    { ic: "target", lab: "What?", head: "Archetype gap engine", body: ["For each Staples node, find the product archetypes the leading competitor carries that Staples lacks", "Check every one for cannibalisation and fit"] },
    { ic: "hand", lab: "With?", head: "Engagement", body: ["12 nodes chosen jointly across Hero, Probable and Non-Hero segments", "Merchant calibration of thresholds (next step)"] },
    { ic: "cogs", lab: "How?", head: "Key solution components", body: ["Cross-retailer product-family matching", "3-tier attributes: function, look, lifestyle", "Archetypes of 4–6 attributes", "Two scoring methods + safety gates"] },
  ];
  quad.forEach((q, i) => {
    const qx = CX + (i % 2) * (CW / 2 + 0.05), qy = 2.05 + Math.floor(i / 2) * 2.0, qw = CW / 2 - 0.05;
    circleIcon(s, ICON[q.ic], qx + 0.05, qy + 0.1, 0.62, C.blue);
    text(s, q.lab, qx - 0.05, qy + 0.76, 0.82, 0.3, { fontSize: 12, bold: true, color: C.navy, align: "center" });
    text(s, q.head, qx + 0.85, qy + 0.05, qw - 0.9, 0.32, { fontSize: 14, bold: true, color: C.blue });
    text(s, q.body.map((b, j) => ({ text: b, options: { bullet: { indent: 12 }, breakLine: j < q.body.length - 1 } })), qx + 0.85, qy + 0.42, qw - 0.9, 1.45, { fontSize: 11.5, color: C.text, paraSpaceAfter: 3 });
  });
  // approach chevrons
  text(s, "Solution approach", CX, 6.08, CW, 0.26, { fontSize: 11, bold: true, color: C.muted, align: "center" });
  const chev = [["Extract & Map", "2F5DAA", C.white], ["Attribute & Archetype", "5A82C8", C.white], ["Score, Gate & Recommend", "8FAEE0", C.navy]];
  chev.forEach(([t, f, ink], i) => {
    const w = CW / 3 + 0.12, x = CX + i * (CW / 3) - (i ? 0.06 : 0);
    s.addShape(i === 0 ? "homePlate" : "chevron", { x, y: 6.36, w, h: 0.58, fill: { color: f }, line: { color: f, width: 0 } });
    text(s, t, x + (i ? 0.3 : 0.1), 6.36, w - (i ? 0.5 : 0.4), 0.58, { fontSize: 12, bold: true, color: ink, align: "center", valign: "middle" });
  });
  // right: value
  box(s, RX, 1.3, RW, 0.6, C.head, { r: 0.1 });
  text(s, "Value for Staples", RX, 1.3, RW, 0.6, { fontSize: 16, bold: true, color: C.navy, align: "center", valign: "middle" });
  s.addShape("ellipse", { x: RX + 0.8, y: 2.05, w: 1.0, h: 1.0, fill: { color: C.paler }, line: { color: C.sky, width: 2 } });
  text(s, String(T.recommended), RX + 0.8, 2.13, 1.0, 0.55, { fontSize: 26, bold: true, color: C.navy, align: "center", valign: "middle" });
  text(s, "safe adds", RX + 0.8, 2.62, 1.0, 0.25, { fontSize: 9.5, color: C.muted, align: "center" });
  [
    "A curated add-list per node, with **example SKUs** to list",
    "**1P protected:** every pick passes a cannibalisation gate",
    `**${SRC.brands_on_staples_9_n} brands** already on Staples: quick-win seller leads`,
  ].forEach((t, i) => {
    const y = 3.2 + i * 1.2;
    box(s, RX, y, RW, 1.05, C.pale, { r: 0.12 });
    text(s, runs(t, { fontSize: 12, color: C.navy }, C.navy), RX + 0.15, y, RW - 0.3, 1.05, { align: "center", valign: "middle" });
  });
  s.addNotes(`Business problem: Staples Marketplace wants a curated catalogue for Q1 2027: core-adjacent "White Chair" extensions that compete with Wayfair and Amazon without diluting core B2B or cannibalising 1P sales, built on external data only.\nOur approach: match products across retailers at product-family level, describe every product with the same 3-tier attribute set (function, look, lifestyle), group them into archetypes (combinations of 4–6 attributes), and score each archetype with two independent methods, each with its own cannibalisation gate.\nValue: ${T.recommended} recommended archetypes across 12 nodes, each with example SKUs shown beside the nearest Staples product, plus a seller view.`);

  // ======================= 2. CURRENT SCOPE =======================
  s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Context" });
  s.addText("Current Scope (PoC): 9 Focus Nodes Across 3 Segments", { placeholder: "title" });
  const hdr = (t) => ({ text: t, options: { bold: true, color: C.white, fill: { color: C.blue }, fontSize: 12.5, valign: "middle" } });
  const rows = [[hdr("Segment · Play"), hdr("Staples node"), hdr("Primary competitor")]];
  SEGS.forEach((seg) => {
    bySeg(seg).forEach((k, i) => {
      const n = N[k], parts = n.node_id.split(" > ");
      const r = [];
      if (i === 0) r.push({ text: seg.replace(" · ", "\n"), options: { rowspan: 3, fill: { color: SEG[seg].fill }, color: SEG[seg].ink, bold: true, fontSize: 13, align: "center", valign: "middle" } });
      r.push({ text: [{ text: n.leaf, options: { bold: true, fontSize: 12.5, color: C.navy, breakLine: true } }, { text: parts.slice(0, -1).join(" > "), options: { fontSize: 10, color: C.muted } }], options: { valign: "middle", fill: { color: i % 2 ? C.paler : C.white } } });
      r.push({ text: n.competitor, options: { bold: true, fontSize: 12.5, color: compColor(n.competitor), valign: "middle", align: "center", fill: { color: i % 2 ? C.paler : C.white } } });
      rows.push(r);
    });
  });
  s.addTable(rows, { x: 0.45, y: 1.3, w: 8.1, colW: [1.9, 4.5, 1.7], rowH: [0.42, ...Array(9).fill(0.53)], fontFace: FONT, border: { type: "solid", pt: 0.75, color: C.line }, margin: [0.03, 0.1, 0.03, 0.1] });
  const RX2 = 8.8, RW2 = 4.08;
  box(s, RX2, 1.3, RW2, 2.25, C.paler, { r: 0.1 });
  text(s, "Why these segments?", RX2 + 0.18, 1.38, RW2 - 0.3, 0.32, { fontSize: 14, bold: true, color: C.blue });
  text(s, [
    ...para("**Hero · EXTEND:** Staples' core categories; extend them with design-led variants", { fontSize: 11.5, color: C.text }, C.navy),
    ...para("**Probable Hero · BUILD:** adjacent lifestyle categories with a Staples base to build on", { fontSize: 11.5, color: C.text }, C.navy),
    ...para("**Non-Hero · EXPLORE:** peripheral and décor categories; test demand at near-zero 1P risk", { fontSize: 11.5, color: C.text }, C.navy),
    ...para("Shown: the top 3 of 4 nodes per segment, chosen for the clearest gaps and strongest results", { fontSize: 10.5, color: C.muted, italic: true }, C.navy, true),
  ], RX2 + 0.18, 1.72, RW2 - 0.33, 1.78, { paraSpaceAfter: 4 });
  box(s, RX2, 3.68, RW2, 1.5, C.paler, { r: 0.1 });
  text(s, "Why these competitors?", RX2 + 0.18, 3.76, RW2 - 0.3, 0.32, { fontSize: 14, bold: true, color: C.blue });
  text(s, [
    { text: "Wayfair", options: { bold: true, color: C.wayfair } }, { text: " for furniture & décor (5 nodes): the home and design benchmark (the \"White Chair\" competitor)", options: { breakLine: true } },
    { text: "Amazon", options: { bold: true, color: C.amazon } }, { text: " for supplies, bags & kitchen (4 nodes): the breadth and everyday-price benchmark" },
  ], RX2 + 0.18, 4.12, RW2 - 0.33, 1.0, { fontSize: 11.5, color: C.text, paraSpaceAfter: 4 });
  box(s, RX2, 5.3, RW2, 1.5, C.warnFill, { r: 0.1, line: C.orange, lineW: 1 });
  s.addImage({ data: ICON.warn, x: RX2 + 0.18, y: 5.42, w: 0.26, h: 0.26 });
  text(s, "Data disclaimer", RX2 + 0.52, 5.4, 3, 0.3, { fontSize: 12.5, bold: true, color: "8A5A00" });
  text(s, `Competitor data are scraped samples (${fams9.toLocaleString("en-US")} competitor vs ${st9.toLocaleString("en-US")} Staples product families in these 9 nodes), not full catalogues. Staples is near-complete, so we compare shares of range, never raw counts. No sales, demand or margin data are used.`, RX2 + 0.18, 5.72, RW2 - 0.33, 1.02, { fontSize: 10.5, color: C.text });
  text(s, `The engine ran on all ${T.nodes_scored} nodes (also Desk Organizers, Water Bottles, Desk Pads); full results are in the HTML report.`, 0.45, 6.5, 8.1, 0.3, { fontSize: 10, italic: true, color: C.muted });
  s.addNotes(`Scope: 12 Staples nodes were analysed; we show the top 3 per segment. Each node is compared with its Primary 1 competitor only: Wayfair for furniture and décor, Amazon for supplies, bags and kitchen.\nDisclaimer: competitor files are convenience samples of scraped listing pages (Amazon ${T.amazon_families.toLocaleString("en-US")} and Wayfair ${T.wayfair_families.toLocaleString("en-US")} product families mapped to the 12 nodes); Staples is close to a census. Every comparison is a share of each retailer's range, with a credibility check, never a raw count. No internal sales, traffic or margin data.`);

  // ======================= 3. EXECUTIVE SUMMARY =======================
  pres.addSection({ title: "Findings" });
  s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Findings" });
  s.addText("Executive Summary", { placeholder: "title" });
  const kpis = [
    [String(T.nodes_scored), "Staples nodes analysed end to end (9 shown today)"],
    [`${(T.staples_families / 1000).toFixed(1)}K | ${(T.competitor_families / 1000).toFixed(1)}K`, "Staples vs competitor product families compared"],
    [String(T.recommended), `archetypes recommended; ${T.tiers.Strong} confirmed by both methods`],
    [`${T.rec_absent_share}%`, "of recommendations are archetypes Staples carries none of today"],
  ];
  kpis.forEach(([v, l], i) => {
    const x = 0.45 + i * 3.14;
    box(s, x, 1.3, 2.97, 1.5, C.paler, { r: 0.12 });
    text(s, v, x + 0.1, 1.38, 2.77, 0.72, { fontSize: v.length > 6 ? 28 : 36, bold: true, color: C.blue, align: "center", valign: "middle" });
    text(s, l, x + 0.2, 2.1, 2.57, 0.6, { fontSize: 11.5, color: C.text, align: "center" });
  });
  // tier strip
  const tiers = [["Strong", T.tiers.Strong, "both methods agree"], ["Vector-led", T.tiers["Vector-led"], "Method 1 whitespace"], ["Gap-led", T.tiers["Gap-led"], "Method 2 gap; check fit"], ["Conditional", T.tiers.Conditional || 0, "node minimum fill"]];
  let tx = 0.45;
  const tw = [3.11, 3.11, 3.11, 3.1];
  tiers.forEach(([nm, n, d], i) => {
    chip(s, `${n}  ${nm}`, tx, 2.98, 1.38, 0.34, TIER[nm], C.white, 11);
    text(s, d, tx + 1.46, 2.98, tw[i] - 1.5, 0.34, { fontSize: 11, color: C.muted, valign: "middle" });
    tx += tw[i];
  });
  const take = [
    { ic: "home", head: "Staples sells to the workplace; competitors sell to the home and the person",
      body: `**${S.chairs_reception.st}%** of Staples' accent chairs are reception or lobby seats (Wayfair ${S.chairs_reception.co}%); **${S.chairs_residential.co}%** of Wayfair's are for living rooms (Staples ${S.chairs_residential.st}%). Amazon's backpacks are **${S.bp_hiking.co}%** hiking/outdoor (Staples ${S.bp_hiking.st}%).`,
      so: "The marketplace can reach the home and lifestyle customer without touching the B2B core." },
    { ic: "palette", head: "The gap is look, material and price, not function",
      body: `Design-forward items are **${dfS}%** of Staples' range vs **${dfC}%** at competitors (9-node average). Staples leads on function: **${S.lamps_usb.st}%** of its desk lamps have USB (Wayfair ${S.lamps_usb.co}%).`,
      so: "Add style and material variants of what Staples already sells (the \"White Chair\" play), not new functions." },
    { ic: "hand", head: "Most picks can be sourced quickly",
      body: `**${SRC.brands_on_staples_9_n}** brands behind the recommended products already sell on Staples (AT-A-GLANCE, Bentgo, Targus, OttLite…). **${SRC.wayfair_house_share}%** of Wayfair brands in the picks are Wayfair's own labels.`,
      so: "Start with existing suppliers for quick wins; recruit makers to supply the house-label archetypes." },
  ];
  take.forEach((t, i) => {
    const x = 0.45 + i * 4.19, y = 3.55, w = 4.05, h = 3.1;
    box(s, x, y, w, h, C.white, { r: 0.12, line: C.line, shadow: true });
    circleIcon(s, ICON[t.ic], x + 0.2, y + 0.2, 0.62, C.blue);
    text(s, t.head, x + 0.95, y + 0.17, w - 1.1, 0.7, { fontSize: 14.5, bold: true, color: C.navy, valign: "middle" });
    text(s, runs(t.body, { fontSize: 12, color: C.text }), x + 0.22, y + 1.0, w - 0.44, 1.5);
    text(s, [{ text: "So what: ", options: { bold: true } }, { text: t.so }], x + 0.22, y + 2.2, w - 0.44, 0.8, { fontSize: 11.5, italic: true, color: C.blue });
  });
  s.addNotes(`Headline numbers (all 12 nodes): ${T.staples_families} Staples and ${T.competitor_families} competitor product families; ${T.archetypes_built} archetypes built; ${T.recommended} recommended (${T.tiers.Strong} Strong, ${T.tiers["Vector-led"]} Vector-led, ${T.tiers["Gap-led"]} Gap-led, ${T.tiers.Conditional} Conditional). ${T.rec_absent_at_staples} of the ${T.recommended} recommended archetypes have zero Staples families today.\nStrong = both methods recommend it and both cannibalisation checks pass. Vector-led = Method 1 (product-similarity whitespace, fit with Staples, visible difference). Gap-led = Method 2 (credible attribute share gap with few cheaper Staples twins); Method 2 has no fit-with-Staples check, so these need a merchant's eye.\nDesign-forward share = share of products with a text-based design-forward index of 0.6 or more (provisional until image-based scoring).`);

  // ======================= 4. INSIGHTS A: MATRIX =======================
  s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Findings" });
  s.addText("Insights: How Staples, Wayfair and Amazon Assortments Differ", { placeholder: "title" });
  const MX = 0.45, LWc = 1.75, GAP = 0.06, CWc = (12.43 - 1.75 - 3 * 0.06) / 3, HY = 1.22, RH = 0.79;
  const cols = [
    { t: "STAPLES", sub: "built for the workplace", fill: C.staples, ink: C.white },
    { t: "WAYFAIR", sub: "built for the home · 5 nodes", fill: C.wayfair, ink: C.white },
    { t: "AMAZON", sub: "built for the person · 4 nodes", fill: C.amazonFill, ink: C.amazonInk },
  ];
  cols.forEach((c, i) => {
    const x = MX + LWc + GAP + i * (CWc + GAP);
    box(s, x, HY, CWc, 0.46, c.fill, { r: 0.06 });
    text(s, [{ text: c.t, options: { bold: true } }, { text: "  " + c.sub, options: { fontSize: 11 } }], x, HY, CWc, 0.46, { fontSize: 14, color: c.ink, align: "center", valign: "middle" });
  });
  const p = (o) => `${o.st}%`, q = (o) => `${o.co}%`;
  const M = [
    ["Core customer", [
      `The workplace: **${p(S.desks_corporate)}** of desks for corporate offices; **${p(S.chairs_reception)}** of accent chairs for reception/lobby; **${p(S.chairs_commercial)}** commercial-grade`,
      `The home: living-room accent chairs **${q(S.chairs_residential)}** (${p(S.chairs_residential)}), desk lamps **${q(S.lamps_residential)}** (${p(S.lamps_residential)}); home-office desks **${q(S.desks_home_office)}** (${p(S.desks_home_office)})`,
      `The person & activity: hiking/outdoor backpacks **${q(S.bp_hiking)}** (${p(S.bp_hiking)}); packs for men / women **${q(S.bp_men)} / ${q(S.bp_women)}** (${p(S.bp_men)} / ${p(S.bp_women)}); women's lunch bags **${q(S.lunch_women)}** (${p(S.lunch_women)})`]],
    ["Design & look", [
      `Dark & utilitarian: black accent chairs **${p(S.chairs_black)}** (${q(S.chairs_black)}); black coffee organizers **${p(S.coffee_black)}** (${q(S.coffee_black)}); plastic/resin clocks **${p(S.clocks_plastic)}** (${q(S.clocks_plastic)})`,
      `Soft, light, natural: light-neutral chairs **${q(S.chairs_light)}** (${p(S.chairs_light)}); cozy/plush **${q(S.chairs_cozy)}** (${p(S.chairs_cozy)}); natural/woven screens **${q(S.partitions_woven)}** (${p(S.partitions_woven)}); statement clocks **${q(S.clocks_statement)}** (${p(S.clocks_statement)})`,
      `Warm materials: wood-tone coffee storage **${q(S.coffee_wood)}** (${p(S.coffee_wood)}); stainless lunch boxes **${q(S.lunch_stainless)}** (${p(S.lunch_stainless)}); leather-bound planners **${q(S.planners_leather)}** (${p(S.planners_leather)})`]],
    ["Where they go deeper", [
      `Function formats: guest/side chairs **${p(S.chairs_guest)}** (${q(S.chairs_guest)}); laptop backpacks **${p(S.bp_laptop)}** (${q(S.bp_laptop)}); tackable panels **${p(S.partitions_tackable)}** (${q(S.partitions_tackable)}); 60–72" desks **${p(S.desks_wide)}** (${q(S.desks_wide)})`,
      `Home formats: armchairs **${q(S.chairs_armchair)}** (${p(S.chairs_armchair)}); shaded table lamps **${q(S.lamps_shaded)}** (${p(S.lamps_shaded)}); desks under 40" **${q(S.desks_narrow)}** (${p(S.desks_narrow)}); oversized clocks **${q(S.clocks_oversized)}** (${p(S.clocks_oversized)})`,
      `Niche needs: guided journals **${q(S.planners_journal)}** (${p(S.planners_journal)}); daily planners **${q(S.planners_daily)}** (${p(S.planners_daily)}); Nespresso pod storage **${q(S.coffee_nespresso)}** (${p(S.coffee_nespresso)}); travel packs **${q(S.bp_travel)}** (${p(S.bp_travel)})`]],
    ["Price ladder", [
      `Premium in furniture: median desk **${money0(N["Office Desks"].price_median_staples)}** (Wayfair ${money0(N["Office Desks"].price_median_competitor)}), **${B.desks_600p.st}%** of desks $600+; median partition **${money0(N.Partitions.price_median_staples)}** (${money0(N.Partitions.price_median_competitor)})`,
      `Entry prices in furniture, premium in décor: desks under $200 **${B.desks_u200.co}%** (${B.desks_u200.st}%); clocks $125+ **${B.clocks_125p.co}%** (${B.clocks_125p.st}%); lamps $175+ **${B.lamps_175p.co}%** (${B.lamps_175p.st}%)`,
      `Cheaper supplies: planners under $10 **${B.planners_u10.co}%** (${B.planners_u10.st}%); coffee organizers under $15 **${B.coffee_u15.co}%** (${B.coffee_u15.st}%); median planner **${money0(N.Planners.price_median_competitor)}** (${money0(N.Planners.price_median_staples)})`]],
    ["Feature story", [
      `Tech & practicality: desk lamps with USB **${p(S.lamps_usb)}** (${q(S.lamps_usb)}), dimmable **${p(S.lamps_dimmable)}** (${q(S.lamps_dimmable)}), wireless charging **${p(S.lamps_wireless)}** (${q(S.lamps_wireless)})`,
      `Mood over specs: "luxe" desks **${q(S.desks_luxe)}** (${p(S.desks_luxe)}); "luxe" screens **${q(S.partitions_luxe)}** (${p(S.partitions_luxe)}); print/photo screens **${q(S.partitions_print)}** (${p(S.partitions_print)})`,
      `Persona & use-case titles ("for women", "hiking", "travel"); listing text is short, so features are under-stated: read feature gaps with care`]],
    ["Sourcing", [
      `**${SRC.brands_on_staples_9_n}** brands behind the recommended products already sell on Staples (AT-A-GLANCE, Bentgo, Targus, OttLite…): quick wins`,
      `**${SRC.wayfair_house_share}%** of brands in the picks are Wayfair house labels (${SRC.wayfair_house_examples.slice(0, 2).join(", ")}…): source the archetype from makers, not the label`,
      `Long tail of independent and unbranded sellers (**${SRC.amazon_brands}** brands in the picks, no house labels): recruit sellers directly`]],
  ];
  M.forEach(([lab, cells], ri) => {
    const y = HY + 0.52 + ri * (RH + 0.04);
    box(s, MX, y, LWc, RH, C.blue, { r: 0.06 });
    text(s, lab, MX + 0.12, y, LWc - 0.2, RH, { fontSize: 12.5, bold: true, color: C.white, valign: "middle" });
    cells.forEach((c, ci) => {
      const x = MX + LWc + GAP + ci * (CWc + GAP);
      box(s, x, y, CWc, RH, ri % 2 ? C.white : C.paler, { r: 0.06, line: C.line, lineW: 0.5 });
      const hi = ci === 0 ? C.staples : ci === 1 ? C.wayfair : C.amazon;
      text(s, runs(c, { fontSize: 10.5, color: C.text }, hi), x + 0.1, y + 0.04, CWc - 0.18, RH - 0.08, { valign: "middle" });
    });
  });
  text(s, "Shares = % of each retailer's product families in the node; brackets = the other retailer's share in the same node. Every gap shown is statistically credible (≥ 95%). Amazon shares cover 4 nodes, Wayfair 5.", MX, 6.8, 12.43, 0.24, { fontSize: 9, italic: true, color: C.muted });
  s.addNotes("How to read: each statement is a share of that retailer's product families in the same node; the number in brackets is the other retailer's share. Bold numbers are the side the column is about.\nWhat Pat will recognise: Staples is a workplace assortment (corporate desks, reception seating, tackable panels, tech-enabled lamps). What may be new: how sharply the competitors split, Wayfair towards the home (living-room chairs, shaded décor lamps, folding screens, compact desks under $200) and Amazon towards the person and the activity (hiking and travel packs, gender-targeted products, guided journals, wood-tone kitchen storage).\nCaveat: Amazon listings carry only a title and a short subtitle, so 'feature not mentioned' is common; feature-level gaps on Amazon nodes are read with care. Design-forward scores are text-based and provisional.");

  // ======================= 5. INSIGHTS B: DID YOU KNOW =======================
  s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Findings" });
  s.addText("Did You Know? One Signal per Node", { placeholder: "title" });
  const DYK = {
    Planners: { a: S.planners_journal.st + "%", b: S.planners_journal.co + "%", cap: "guided journals",
      t: `Staples lists 2 journals among ${N.Planners.n_staples} planners; ${S.planners_journal.co}% of Amazon's planner range is guided or gratitude journals.`, so: "A ready add with no Staples twin." },
    Backpacks: { a: S.bp_hiking.st + "%", b: S.bp_hiking.co + "%", cap: "hiking / outdoor",
      t: `${S.bp_laptop.st}% of Staples' backpacks are laptop/work bags; Amazon's range is led by hiking and travel packs.`, so: "Weekend packs reach the commuter at a new moment." },
    "Office Desks": { a: B.desks_u200.st + "%", b: B.desks_u200.co + "%", cap: "desks under $200",
      t: `Staples' median desk is ${money0(N["Office Desks"].price_median_staples)} vs ${money0(N["Office Desks"].price_median_competitor)}; desks under 40" wide: ${S.desks_narrow.st}% vs ${S.desks_narrow.co}%.`, so: "The gap is compact, affordable home-office desks." },
    "Accent Chairs": { a: S.chairs_residential.st + "%", b: S.chairs_residential.co + "%", cap: "living-room chairs",
      t: `${S.chairs_reception.st}% of Staples' accent chairs are reception seats and ${S.chairs_black.st}% are black; Staples has 0 barrel chairs.`, so: "The \"White Chair\" gap is real: light, residential, swivel." },
    "Desk Lamps": { a: B.lamps_175p.st + "%", b: B.lamps_175p.co + "%", cap: "lamps $175+",
      t: `Staples wins on tech (USB ${S.lamps_usb.st}% vs ${S.lamps_usb.co}%), but décor-grade lamps are rare at Staples.`, so: "Trade up with design lamps; keep tech lamps 1P." },
    "Lunch Bags": { a: S.lunch_stainless.st + "%", b: S.lunch_stainless.co + "%", cap: "stainless steel",
      t: `Staples' range skews to teens (${S.lunch_teens.st}% vs ${S.lunch_teens.co}%); Amazon targets adults and women (${S.lunch_women.co}% vs ${S.lunch_women.st}%).`, so: "Adult commuter meal kits are under-served." },
    Clocks: { a: B.clocks_125p.st + "%", b: B.clocks_125p.co + "%", cap: "clocks $125+",
      t: `${B.clocks_u50.st}% of Staples' clocks are under $50 and ${S.clocks_plastic.st}% plastic/resin; Wayfair: ${S.clocks_oversized.co}% oversized.`, so: "Statement décor clocks are a pure trade-up." },
    Partitions: { a: B.partitions_u150.st + "%", b: B.partitions_u150.co + "%", cap: "under $150",
      t: `${S.partitions_tackable.st}% of Staples' partitions are tackable office panels (median ${money0(N.Partitions.price_median_staples)}); Wayfair sells home folding screens.`, so: "Home screens: a new customer, near-zero cannibalisation." },
    "Coffee Organizers": { a: S.coffee_wood.st + "%", b: S.coffee_wood.co + "%", cap: "wood-tone",
      t: `${S.coffee_black.st}% of Staples' coffee organizers are black and none is under $15 (Amazon ${B.coffee_u15.co}%).`, so: "Bamboo pod drawers bring the kitchen-counter look." },
  };
  const GX = 0.45, GW = 4.05, GG = 0.14;
  SEGS.forEach((seg, ci) => {
    const x = GX + ci * (GW + GG);
    box(s, x, 1.24, GW, 0.4, SEG[seg].fill, { r: 0.06 });
    text(s, SEG[seg].short, x, 1.24, GW, 0.4, { fontSize: 12.5, bold: true, color: SEG[seg].ink, align: "center", valign: "middle" });
    bySeg(seg).forEach((k, ri) => {
      const y = 1.72 + ri * 1.76, h = 1.66, d = DYK[k], n = N[k];
      box(s, x, y, GW, h, C.white, { r: 0.1, line: C.line, shadow: true });
      // stat block
      box(s, x + 0.08, y + 0.08, 1.24, h - 0.16, C.paler, { r: 0.08 });
      text(s, "STAPLES", x + 0.08, y + 0.14, 1.24, 0.2, { fontSize: 8.5, bold: true, color: C.staples, align: "center" });
      text(s, d.a, x + 0.08, y + 0.31, 1.24, 0.38, { fontSize: 22, bold: true, color: C.staples, align: "center", valign: "middle" });
      text(s, n.competitor.toUpperCase(), x + 0.08, y + 0.72, 1.24, 0.2, { fontSize: 8.5, bold: true, color: compColor(n.competitor), align: "center" });
      text(s, d.b, x + 0.08, y + 0.89, 1.24, 0.38, { fontSize: 22, bold: true, color: compColor(n.competitor), align: "center", valign: "middle" });
      text(s, d.cap, x + 0.1, y + 1.3, 1.2, 0.26, { fontSize: 9, color: C.muted, align: "center", valign: "middle" });
      // text block
      text(s, n.leaf, x + 1.45, y + 0.1, GW - 1.55, 0.3, { fontSize: 13, bold: true, color: C.navy });
      text(s, d.t, x + 1.45, y + 0.42, GW - 1.55, 0.72, { fontSize: 10.5, color: C.text });
      text(s, [{ text: "So what: ", options: { bold: true } }, { text: d.so }], x + 1.45, y + 1.14, GW - 1.55, 0.44, { fontSize: 10.5, italic: true, color: C.blue });
    });
  });
  s.addNotes("One verified signal per node; the two big numbers are the share of each retailer's range with that attribute or price band.\nChecks behind the 'zero' claims: Staples catalogue searched on the extracted attributes and on product titles: 0 barrel chairs (of 116), 0 pendulum clocks (of 174), 0 guided journals (of 805), 0 folding screens under $150 (of 99), 0 wood/bamboo pod drawers (of 50).");

  // ======================= 6. RECOMMENDATIONS =======================
  pres.addSection({ title: "Recommendations" });
  s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Recommendations" });
  s.addText("Recommendations: Top 2 Archetypes to Add per Node", { placeholder: "title" });
  const EV = {
    Planners: [() => `Plain designs: Staples ${S.planners_plain.st}% vs Amazon ${S.planners_plain.co}%`, (pk) => `Staples 2 of ${N.Planners.n_staples} · Amazon ${Math.round(pk.attr_check.comp_share)}% of range`],
    Backpacks: [() => `Hiking packs: Staples ${S.bp_hiking.st}% vs Amazon ${S.bp_hiking.co}%`, () => `Travel packs: Staples ${S.bp_travel.st}% vs Amazon ${S.bp_travel.co}%`],
    "Office Desks": [() => `"Luxe" desks: Staples ${S.desks_luxe.st}% vs Wayfair ${S.desks_luxe.co}%`, () => `Remote-work desks: Staples ${S.desks_remote.st}% vs Wayfair ${S.desks_remote.co}%`],
    "Accent Chairs": [() => `Armchairs: Staples ${S.chairs_armchair.st}% vs Wayfair ${S.chairs_armchair.co}%`, (pk) => `Staples 0 of ${N["Accent Chairs"].n_staples} · Wayfair ${Math.round(pk.attr_check.comp_share)}% of range`],
    "Desk Lamps": [() => `Lamps $175+: Staples ${B.lamps_175p.st}% vs Wayfair ${B.lamps_175p.co}%`, (pk) => `Staples 0 of ${N["Desk Lamps"].n_staples} · Wayfair ${Math.round(pk.attr_check.comp_share)}% of range`],
    "Lunch Bags": [() => `Stainless: Staples ${S.lunch_stainless.st}% vs Amazon ${S.lunch_stainless.co}%`, (pk) => `Staples ${pk.attr_check.staples_hits} items (2%) vs Amazon ${Math.round(pk.attr_check.comp_share)}%`],
    Clocks: [() => `Oversized: Staples ${S.clocks_oversized.st}% vs Wayfair ${S.clocks_oversized.co}%`, (pk) => `Staples 0 of ${N.Clocks.n_staples} · Wayfair ${Math.round(pk.attr_check.comp_share)}% of range`],
    Partitions: [() => `Under $150: Staples ${B.partitions_u150.st}% vs Wayfair ${B.partitions_u150.co}%`, () => `Natural/woven: Staples ${S.partitions_woven.st}% vs Wayfair ${S.partitions_woven.co}%`],
    "Coffee Organizers": [() => `Bamboo/wood: Staples ${S.coffee_bamboo.st}% vs Amazon ${S.coffee_bamboo.co}%`, () => `Nespresso storage: Staples ${S.coffee_nespresso.st}% vs Amazon ${S.coffee_nespresso.co}%`],
  };
  const FR = { add: "ADD", deepen: "DEEPEN", "trade-up": "TRADE-UP" };
  const RX0 = 0.45, RLW = 0.42, RCW = 3.92, RG = 0.08, RY = 1.22, RRH = 1.62;
  SEGS.forEach((seg, ci) => {
    const x = RX0 + RLW + RG + ci * (RCW + RG);
    box(s, x, RY, RCW, 0.4, SEG[seg].fill, { r: 0.06 });
    text(s, SEG[seg].short, x, RY, RCW, 0.4, { fontSize: 12.5, bold: true, color: SEG[seg].ink, align: "center", valign: "middle" });
    bySeg(seg).forEach((k, ri) => {
      const y = RY + 0.48 + ri * (RRH + 0.06);
      if (ci === 0) {
        box(s, RX0, y, RLW, RRH, C.pale, { r: 0.06 });
        text(s, `#${ri + 1}`, RX0, y, RLW, RRH, { fontSize: 13, bold: true, color: C.navy, align: "center", valign: "middle" });
      }
      const n = N[k];
      box(s, x, y, RCW, RRH, C.white, { r: 0.08, line: C.line });
      text(s, n.leaf, x + 0.12, y + 0.06, RCW - 1.1, 0.28, { fontSize: 12.5, bold: true, color: C.navy, valign: "middle" });
      chip(s, n.competitor, x + RCW - 0.95, y + 0.08, 0.85, 0.24, compColor(n.competitor), C.white, 9);
      F.picks[k].forEach((pk, pi) => {
        const py = y + 0.37 + pi * 0.62;
        if (pi === 1) s.addShape("line", { x: x + 0.12, y: py - 0.04, w: RCW - 0.24, h: 0, line: { color: "E3E8F0", width: 0.75 } });
        chip(s, pk.tier, x + 0.12, py + 0.03, 0.84, 0.21, TIER[pk.tier], C.white, 8.5);
        const ex = pk.exemplar;
        text(s, [{ text: pk.label, options: { hyperlink: { url: ex.url, tooltip: `Open example on ${n.competitor}` }, color: C.navy, bold: true } }], x + 1.03, py, RCW - 1.13, 0.27, { fontSize: 11, valign: "middle" });
        text(s, [{ text: EV[k][pi](pk), options: {} }, { text: "  ·  " + FR[pk.framing], options: { bold: true, color: pk.framing === "add" ? C.strong : C.gap } }], x + 0.12, py + 0.27, RCW - 0.22, 0.18, { fontSize: 9.5, color: C.muted });
        text(s, [{ text: "e.g. ", options: { color: C.muted } }, { text: shortTitle(ex.title, 42) + (ex.price ? ` · ${money(ex.price)}` : "") + " ↗", options: { hyperlink: { url: ex.url, tooltip: ex.title }, color: C.mid, underline: { style: "sng" } } }], x + 0.12, py + 0.44, RCW - 0.22, 0.18, { fontSize: 9.5 });
      });
    });
  });
  text(s, [
    { text: "Strong", options: { bold: true, color: C.strong } }, { text: " = both methods agree   " },
    { text: "Vector-led", options: { bold: true, color: C.vector } }, { text: " = product-similarity whitespace   " },
    { text: "Gap-led", options: { bold: true, color: C.gap } }, { text: " = attribute gap (check fit)   ·   ADD = Staples carries ~none, DEEPEN = carries a little   ·   Click a name to open the example (each passed its method's safety gate)" },
  ], RX0, 6.78, 12.43, 0.24, { fontSize: 9, color: C.muted });
  const recNotes = ORDER.map((k) => `${k}: ` + F.picks[k].map((pk) => `#${pk.final_rank} ${pk.label} [${pk.tier}, ${pk.framing}] (archetype: ${pk.archetype}; ${pk.combo}); example ${pk.exemplar.title.slice(0, 70)} ${pk.exemplar.price ? money(pk.exemplar.price) : ""}; nearest Staples item: ${pk.exemplar.nearest_staples.slice(0, 60)}${pk.skipped ? `; skipped: ${pk.skipped}` : ""}${pk.note ? `; note: ${pk.note}` : ""}`).join(" | ")).join("\n");
  s.addNotes("How the two picks were chosen: walk each node's final ranking, skip near-duplicates (the same product idea with only a modifier added) and skip any pick whose 'Staples lacks it' claim fails a check of the Staples catalogue (attributes and titles). Each example is the recommended SKU priced closest to the archetype's competitor median unless another example matches the idea better; it is safe under the method(s) that recommended it.\n" + recNotes);

  // ======================= 7. FUTURE SCOPE =======================
  pres.addSection({ title: "Next steps" });
  s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Next steps" });
  s.addText("Future Scope: Where This Engine Goes Next", { placeholder: "title" });
  const panels = [
    { n: "1", t: "With Staples' internal data", fill: C.blue, items: [
      ["userF", "Customer profiling & demand sizing", "Use sales, traffic and customer data to size demand per archetype and target each segment (Hero, Probable, Non-Hero) precisely."],
      ["clip", "Vendor catalogue vetting", "Pivot the same engine onto seller listings to score, approve or reject marketplace submissions before they go live."],
      ["scale", "Sales-weighted cannibalisation & margin", "Replace listing-based checks with actual 1P sales, margin and price elasticity to protect revenue precisely."],
    ] },
    { n: "2", t: "Beyond this recommendation", fill: C.navy, items: [
      ["srch", "Search-intent gaps", "Mine Staples.com searches with zero or weak results to find high-demand items missing from the catalogue."],
      ["chart", "Demand forecasting & market research", "Add social-trend and market research for Non-Hero nodes to size new categories before recruiting sellers."],
      ["basket", "Basket completion", "Market-basket analysis on transactions to find items that complete baskets (e.g. Back-to-School) and fill them via marketplace sellers."],
      ["globe", "More competitors & image-based design score", "Add more retailers and score design from product images, not only text."],
    ] },
  ];
  panels.forEach((pn, i) => {
    const x = 0.45 + i * 6.29, w = 6.14, y = 1.3;
    box(s, x, y, w, 5.6, C.paler, { r: 0.12 });
    box(s, x, y, w, 0.62, pn.fill, { r: 0.12 });
    s.addShape("ellipse", { x: x + 0.15, y: y + 0.1, w: 0.42, h: 0.42, fill: { color: C.orange }, line: { color: C.orange, width: 0 } });
    text(s, pn.n, x + 0.15, y + 0.1, 0.42, 0.42, { fontSize: 16, bold: true, color: C.white, align: "center", valign: "middle" });
    text(s, pn.t, x + 0.7, y, w - 0.8, 0.62, { fontSize: 17, bold: true, color: C.white, valign: "middle" });
    const rh = (5.6 - 0.8) / pn.items.length;
    pn.items.forEach(([ic, h, d], j) => {
      const yy = y + 0.8 + j * rh;
      circleIcon(s, ICON[ic], x + 0.25, yy + 0.08, 0.6, pn.fill);
      text(s, h, x + 1.05, yy + 0.04, w - 1.25, 0.32, { fontSize: 14, bold: true, color: C.navy });
      text(s, d, x + 1.05, yy + 0.38, w - 1.25, rh - 0.45, { fontSize: 12, color: C.text });
    });
  });
  s.addNotes("Two directions. (1) With internal data: customer profiling and demand analysis to target the right segments; the same engine pivoted to vet vendor catalogue submissions (approve / reject at onboarding); cannibalisation and margin weighted by real 1P sales.\n(2) Beyond this recommendation: internal search data to find high-demand items with no or weak results (a future PoC); demand forecasting plus social and market research for Non-Hero explore categories to increase deal size; market-basket analysis to find items that complete baskets; more competitors and an image-based design score.");

  // ======================= 8. TECH ARCHITECTURE =======================
  s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Next steps" });
  s.addText("Solution Architecture: From Listings to Safe Recommendations", { placeholder: "title" });
  const stages = [
    { t: "Data Acquisition", w: 2.1, items: [["dbS", "Staples.com", "4.9K SKUs · 12 nodes"], ["dbA", "Amazon", "14.6K ASINs · 7 nodes"], ["dbW", "Wayfair", "11.2K products · 5 nodes"]] },
    { t: "Prep & Mapping", sub: "S0–S2", w: 2.3, items: [["filter", "Clean & de-identify", "prices, mojibake, PII removed"], ["layer", "Product families", "colour / size variants merged"], ["sitemap", "Node mapping", "page crosswalk + k-NN scope check"]] },
    { t: "Attributes & Archetypes", sub: "S3–S4", w: 2.45, items: [["tags", "3-tier attributes", "function · look · lifestyle, full text, same on both sides"], ["proj", "Neutral product cards", "bge embeddings, no price, no brand"], ["puzzle", "Archetypes", "4–6-attribute combinations, up to 3 sets per node"]] },
    { t: "Two Scoring Methods", sub: "S5–S6", w: 2.95, methods: true },
    { t: "Gates & Picks", sub: "S7–S8", w: 2.31, items: [["shield", "Safety gates", "common → per method → final"], ["check", "Final list", "Strong / Vector-led / Gap-led, 3–10 per node"], ["storeB", "SKUs & sellers", "each example beside its nearest Staples item"]] },
  ];
  let sx = 0.45;
  stages.forEach((st, i) => {
    const w = st.w;
    s.addShape(i === 0 ? "homePlate" : "chevron", { x: sx, y: 1.28, w: w + 0.06, h: 0.6, fill: { color: [C.pale, "CFDDF5", C.head, "A9C3EE", "97B6EA"][i] }, line: { color: C.white, width: 0 } });
    text(s, [{ text: st.t, options: { bold: true, breakLine: !!st.sub } }, ...(st.sub ? [{ text: st.sub, options: { fontSize: 9.5, color: C.muted } }] : [])], sx + (i ? 0.28 : 0.1), 1.28, w - (i ? 0.45 : 0.35), 0.6, { fontSize: 12.5, color: C.navy, align: "center", valign: "middle" });
    const bx = sx + 0.04, bw = w - 0.06, by = 2.02, bh = 4.08;
    box(s, bx, by, bw, bh, C.white, { r: 0.08, line: "9DB2D6", dash: "dash" });
    if (st.methods) {
      const mm = [
        { h: "Method 1 · Vector view", f: C.paler, lines: ["VW (Vector Whitespace)", "AAS (Adjacency Affinity Score)", "CRS (Cannibalisation Risk Score)", "AD (Aesthetic Delta) · PPR (Price Position Ratio)"], out: "→ VOS (Vector Opportunity Score)" },
        { h: "Method 2 · Attribute view", f: "F3F0FA", lines: ["LSR (Log Share Ratio) · PPG (Price Position Gap)", "CG (Colour Gap) · MSG (Material/Style Gap)", "DFG (Design-Forward Gap)", "ACR (Attribute Cannibalisation Risk)"], out: "→ TG (Total Gap)" },
      ];
      mm.forEach((m, j) => {
        const my = by + 0.12 + j * 1.98;
        box(s, bx + 0.1, my, bw - 0.2, 1.84, m.f, { r: 0.08 });
        text(s, m.h, bx + 0.2, my + 0.06, bw - 0.4, 0.28, { fontSize: 12, bold: true, color: C.blue });
        text(s, m.lines.map((l, k) => ({ text: l, options: { breakLine: k < m.lines.length - 1 } })), bx + 0.2, my + 0.36, bw - 0.4, 1.0, { fontSize: 9.5, color: C.text, paraSpaceAfter: 1 });
        text(s, m.out, bx + 0.2, my + 1.42, bw - 0.4, 0.3, { fontSize: 11, bold: true, color: C.navy });
      });
    } else {
      st.items.forEach(([ic, h, d], j) => {
        const iy = by + 0.15 + j * 1.31;
        s.addImage({ data: ICON[ic], x: bx + bw / 2 - 0.27, y: iy, w: 0.54, h: 0.54 });
        text(s, h, bx + 0.08, iy + 0.58, bw - 0.16, 0.24, { fontSize: 11.5, bold: true, color: C.navy, align: "center" });
        text(s, d, bx + 0.08, iy + 0.82, bw - 0.16, 0.42, { fontSize: 9.5, color: C.muted, align: "center" });
      });
    }
    if (i < stages.length - 1) s.addShape("line", { x: bx + bw - 0.02, y: by + bh / 2, w: 0.1, h: 0, line: { color: C.blue, width: 1.5, endArrowType: "triangle" } });
    sx += w + 0.08;
  });
  box(s, 0.45, 6.24, 12.43, 0.62, C.paler, { r: 0.08 });
  text(s, [
    { text: "Output: ", options: { bold: true, color: C.navy } }, { text: `one self-contained HTML report · ${T.recommended} recommended archetypes · SKU evidence cards · seller view      `, options: {} },
    { text: "Stack: ", options: { bold: true, color: C.navy } }, { text: "Python · pandas · sentence-transformers (bge) · UMAP + HDBSCAN · Bayesian share gaps · Jinja2" },
  ], 0.65, 6.24, 12.1, 0.62, { fontSize: 11, color: C.text, valign: "middle" });
  s.addNotes("End-to-end flow. S0–S2: ingest and clean the three sources (PII from Wayfair reviews removed), merge colour/size variants into product families, map each competitor product to the right Staples node with a page crosswalk plus a nearest-neighbour scope check. S3–S4: read every product's full text with the same extractor on both sides into 3 tiers of attributes; build archetypes as combinations of 4–6 attributes (no price). S5: Method 1 in embedding space (whitespace, fit with Staples, aesthetic difference, cannibalisation risk, price position) gives VOS. S6: Method 2 on attribute shares (share gap, price, colour, material/style, design) gives TG, with its own attribute cannibalisation check (ACR). S7: each method has its own safety gate; the final gate takes the union and tiers it. S8: example SKUs safe under the recommending method, each shown next to the nearest Staples product, plus brand and seller notes.");

  // ======================= 9. THANK YOU =======================
  pres.addSection({ title: "Close" });
  s = pres.addSlide({ masterName: "DARK", sectionTitle: "Close" });
  text(s, "Thank You", 0.7, 2.2, 6, 1.0, { fontSize: 48, bold: true, color: C.white });
  text(s, "Questions & discussion", 0.7, 3.2, 6, 0.5, { fontSize: 22, color: "CADCFC" });
  box(s, 7.3, 1.75, 5.4, 3.0, "1C3A7A", { r: 0.15 });
  text(s, "Proposed next steps", 7.65, 1.95, 4.8, 0.4, { fontSize: 18, bold: true, color: C.orange });
  text(s, [
    "Calibration session: 60 side-by-side pairs to set the cannibalisation and price thresholds with merchants",
    "Category review of the top picks per node, then seller outreach starting with brands already on Staples",
    "Pilot listings in 2–3 nodes and track attach rate and commission over 6–18 months",
  ].map((t, i, a) => ({ text: t, options: { bullet: { type: "number" }, breakLine: i < a.length - 1 } })), 7.65, 2.5, 4.8, 2.1, { fontSize: 14, color: C.white, paraSpaceAfter: 10 });
  text(s, "LatentView Analytics  ·  October 2026", 0.7, 6.25, 7, 0.35, { fontSize: 14, color: "CADCFC" });
  s.addNotes("Close with the next steps: calibrate thresholds with merchants (the decision tree and gates use weakly supervised thresholds until then), review the top picks with category managers, start seller outreach with brands that already sell on Staples, and pilot in 2–3 nodes.");

  await pres.writeFile({ fileName: OUT });
  console.log("wrote", OUT);
})();
