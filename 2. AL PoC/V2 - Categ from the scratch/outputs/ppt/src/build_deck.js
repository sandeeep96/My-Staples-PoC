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
    { ic: "hand", lab: "With?", head: "Engagement", body: [`${ORDER.length} nodes chosen jointly across Hero, Probable and Non-Hero segments`, "Merchant calibration of thresholds (next step)"] },
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
  text(s, String(F.totals9.recommended), RX + 0.8, 2.13, 1.0, 0.55, { fontSize: 26, bold: true, color: C.navy, align: "center", valign: "middle" });
  text(s, "safe adds · 9 nodes", RX + 0.8, 2.62, 1.0, 0.25, { fontSize: 9.5, color: C.muted, align: "center" });
  [
    "A curated add-list per node, with **example SKUs** to list",
    "**1P protected:** every pick passes a cannibalisation gate",
    `**${SRC.brands_on_staples_9_n} brands** already on Staples: quick-win seller leads`,
  ].forEach((t, i) => {
    const y = 3.2 + i * 1.2;
    box(s, RX, y, RW, 1.05, C.pale, { r: 0.12 });
    text(s, runs(t, { fontSize: 12, color: C.navy }, C.navy), RX + 0.15, y, RW - 0.3, 1.05, { align: "center", valign: "middle" });
  });
  s.addNotes(`Business problem: Staples Marketplace wants a curated catalogue for Q1 2027: core-adjacent "White Chair" extensions that compete with Wayfair and Amazon without diluting core B2B or cannibalising 1P sales, built on external data only.\nOur approach: match products across retailers at product-family level, describe every product with the same 3-tier attribute set (function, look, lifestyle), group them into archetypes (combinations of 4–6 attributes), and score each archetype with two independent methods, each with its own cannibalisation gate.\nValue: ${F.totals9.recommended} recommended archetypes across the 9 nodes shown (${T.recommended} across all 12 analysed), each with example SKUs shown beside the nearest Staples product, plus a seller view.`);

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
  s.addTable(rows, { x: 0.45, y: 1.3, w: 8.1, colW: [1.9, 4.5, 1.7], rowH: [0.42, ...Array(9).fill(0.57)], fontFace: FONT, border: { type: "solid", pt: 0.75, color: C.line }, margin: [0.03, 0.1, 0.03, 0.1] });
  const RX2 = 8.8, RW2 = 4.08;
  box(s, RX2, 1.3, RW2, 2.35, C.paler, { r: 0.1 });
  text(s, "Why these segments?", RX2 + 0.18, 1.38, RW2 - 0.3, 0.32, { fontSize: 14, bold: true, color: C.blue });
  text(s, [
    ...para("**Hero · EXTEND:** Staples' top-performing categories (as per our research). Extend them with design-led variants without diluting the core.", { fontSize: 11, color: C.text }, C.navy),
    ...para("**Probable Hero · BUILD:** a good market where Staples can improve its position (as per our research). Build depth and range.", { fontSize: 11, color: C.text }, C.navy),
    ...para("**Non-Hero · EXPLORE:** a smaller Staples presence today (as per our research). Explore through marketplace sellers at near-zero 1P risk.", { fontSize: 11, color: C.text }, C.navy, true),
  ], RX2 + 0.18, 1.74, RW2 - 0.33, 1.86, { paraSpaceAfter: 5 });
  box(s, RX2, 3.77, RW2, 2.0, C.paler, { r: 0.1 });
  text(s, "Why these competitors?", RX2 + 0.18, 3.85, RW2 - 0.3, 0.32, { fontSize: 14, bold: true, color: C.blue });
  text(s, [
    { text: "Each node is benchmarked against the retailer that sets the shopper's expectation for it (as per our research)", options: { italic: true, color: C.muted, breakLine: true } },
    { text: "Wayfair", options: { bold: true, color: C.wayfair } }, { text: " · furniture & décor (5 nodes): the leading online home-furnishing store; it wins the design-led home and home-office shopper Staples wants", options: { breakLine: true } },
    { text: "Amazon", options: { bold: true, color: C.amazon } }, { text: " · supplies, bags & kitchen (4 nodes): the default everyday marketplace; it sets the bar for breadth, niche variants and price" },
  ], RX2 + 0.18, 4.19, RW2 - 0.33, 1.55, { fontSize: 10.5, color: C.text, paraSpaceAfter: 4 });
  box(s, RX2, 5.87, RW2, 0.98, C.warnFill, { r: 0.1, line: C.orange, lineW: 1 });
  s.addImage({ data: ICON.warn, x: RX2 + 0.18, y: 5.95, w: 0.24, h: 0.24 });
  text(s, "Data disclaimer", RX2 + 0.5, 5.93, 3, 0.28, { fontSize: 12, bold: true, color: "8A5A00" });
  text(s, `Competitor data are scraped samples (${fams9.toLocaleString("en-US")} competitor vs ${st9.toLocaleString("en-US")} Staples product families), not full catalogues. We compare shares of range, never raw counts. No sales or margin data used.`, RX2 + 0.18, 6.22, RW2 - 0.33, 0.6, { fontSize: 10, color: C.text });
  s.addNotes(`Segments (as per our research): Hero = Staples' top-performing categories, so we EXTEND them with design-led variants; Probable Hero = a good market where Staples can improve its position, so we BUILD depth; Non-Hero = a smaller Staples presence today, so we EXPLORE via marketplace sellers with near-zero 1P risk. The deck shows the top 3 nodes per segment (the engine ran on 12).\nCompetitors (as per our research): each node is compared with its Primary competitor only: Wayfair, the leading online home-furnishing store, for furniture and décor; Amazon, the default everyday marketplace, for supplies, bags and kitchen.\nDisclaimer: competitor files are convenience samples of scraped listing pages; Staples is close to a census. Every comparison is a share of each retailer's range with a credibility check, never a raw count. No internal sales, traffic or margin data.`);

  // ======================= 4. INSIGHTS: MATRIX =======================
  pres.addSection({ title: "Findings" });
  s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Findings" });
  s.addText("Insights: How Staples, Wayfair and Amazon Assortments Differ", { placeholder: "title" });
  const MX = 0.45, LWc = 1.6, GAP = 0.06, CWc = (12.43 - 1.6 - 3 * 0.06) / 3, HY = 1.22, RH = 0.98;
  const cols = [
    { t: "STAPLES", sub: "built for the workplace", fill: C.staples, ink: C.white, hi: C.staples },
    { t: "WAYFAIR", sub: "built for the home · 5 nodes", fill: C.wayfair, ink: C.white, hi: C.wayfair },
    { t: "AMAZON", sub: "built for the person · 4 nodes", fill: C.amazonFill, ink: C.amazonInk, hi: C.amazon },
  ];
  cols.forEach((c, i) => {
    const x = MX + LWc + GAP + i * (CWc + GAP);
    box(s, x, HY, CWc, 0.44, c.fill, { r: 0.06 });
    text(s, [{ text: c.t, options: { bold: true } }, { text: "  " + c.sub, options: { fontSize: 11 } }], x, HY, CWc, 0.44, { fontSize: 14, color: c.ink, align: "center", valign: "middle" });
  });
  // Every cell = a headline + 3 bullets in the same "Category: share (vs compared retailer)" form. The Staples
  // column mirrors Wayfair on bullets 1-2 (furniture) and Amazon on bullet 3 (supplies), so each row reads across.
  const st = (o) => `${o.st}%`, co = (o) => `${o.co}%`;
  const M = [
    ["Core customer", [
      ["The workplace", [`Desks: **${st(S.desks_corporate)}** for corporate offices (vs ${co(S.desks_corporate)})`, `Accent chairs: **${st(S.chairs_reception)}** reception/lobby (vs ${co(S.chairs_reception)})`, `Backpacks: **${st(S.bp_laptop)}** laptop/work bags (vs ${co(S.bp_laptop)})`]],
      ["The home", [`Desks: **${co(S.desks_home_office)}** for home offices (vs ${st(S.desks_home_office)})`, `Accent chairs: **${co(S.chairs_residential)}** for living rooms (vs ${st(S.chairs_residential)})`, `Desk lamps: **${co(S.lamps_residential)}** for living rooms (vs ${st(S.lamps_residential)})`]],
      ["The person & the activity", [`Backpacks: **${co(S.bp_hiking)}** hiking/outdoor (vs ${st(S.bp_hiking)})`, `Backpacks: **${co(S.bp_men)} / ${co(S.bp_women)}** men's / women's (vs ${st(S.bp_men)} / ${st(S.bp_women)})`, `Lunch bags: **${co(S.lunch_women)}** made for women (vs ${st(S.lunch_women)})`]]]],
    ["Design & look", [
      ["Dark & utilitarian", [`Accent chairs: **${st(S.chairs_black)}** black (vs ${co(S.chairs_black)})`, `Clocks: **${st(S.clocks_plastic)}** plastic/resin (vs ${co(S.clocks_plastic)})`, `Coffee organizers: **${st(S.coffee_black)}** black (vs ${co(S.coffee_black)})`]],
      ["Light, soft & natural", [`Accent chairs: **${co(S.chairs_light)}** light-neutral (vs ${st(S.chairs_light)})`, `Clocks: **${co(S.clocks_statement)}** statement pieces (vs ${st(S.clocks_statement)})`, `Screens: **${co(S.partitions_woven)}** natural/woven (vs ${st(S.partitions_woven)})`]],
      ["Warm, premium materials", [`Coffee organizers: **${co(S.coffee_wood)}** wood-tone (vs ${st(S.coffee_wood)})`, `Lunch boxes: **${co(S.lunch_stainless)}** stainless steel (vs ${st(S.lunch_stainless)})`, `Planners: **${co(S.planners_leather)}** leather-bound (vs ${st(S.planners_leather)})`]]]],
    ["Where they go deeper", [
      ["Function formats", [`Accent chairs: **${st(S.chairs_guest)}** guest/side chairs (vs ${co(S.chairs_guest)})`, `Partitions: **${st(S.partitions_tackable)}** tackable panels (vs ${co(S.partitions_tackable)})`, `Desks: **${st(S.desks_wide)}** 60–72" wide (vs ${co(S.desks_wide)})`]],
      ["Home formats", [`Accent chairs: **${co(S.chairs_armchair)}** armchairs (vs ${st(S.chairs_armchair)})`, `Partitions: **${co(S.partitions_folding)}** folding screens (vs ${st(S.partitions_folding)})`, `Desks: **${co(S.desks_narrow)}** under 40" wide (vs ${st(S.desks_narrow)})`]],
      ["Niche needs", [`Planners: **${co(S.planners_journal)}** guided journals (vs ${st(S.planners_journal)})`, `Coffee organizers: **${co(S.coffee_nespresso)}** for Nespresso (vs ${st(S.coffee_nespresso)})`, `Backpacks: **${co(S.bp_travel)}** travel/carry-on (vs ${st(S.bp_travel)})`]]]],
    ["Price ladder", [
      ["Premium in furniture", [`Desks: median **${money0(N["Office Desks"].price_median_staples)}** (vs ${money0(N["Office Desks"].price_median_competitor)})`, `Partitions: median **${money0(N.Partitions.price_median_staples)}** (vs ${money0(N.Partitions.price_median_competitor)})`, `Planners: median **${money0(N.Planners.price_median_staples)}** (vs ${money0(N.Planners.price_median_competitor)})`]],
      ["Entry-price furniture, premium décor", [`Desks: **${B.desks_u200.co}%** under $200 (vs ${B.desks_u200.st}%)`, `Partitions: **${B.partitions_u150.co}%** under $150 (vs ${B.partitions_u150.st}%)`, `Clocks: **${B.clocks_125p.co}%** at $125+ (vs ${B.clocks_125p.st}%)`]],
      ["Cheaper everyday supplies", [`Planners: **${B.planners_u10.co}%** under $10 (vs ${B.planners_u10.st}%)`, `Coffee organizers: **${B.coffee_u15.co}%** under $15 (vs ${B.coffee_u15.st}%)`, `Lunch bags: **${B.lunch_u15.co}%** under $15 (vs ${B.lunch_u15.st}%)`]]]],
    ["Feature story", [
      ["Tech & practicality", [`Desk lamps: **${st(S.lamps_usb)}** with USB ports (vs ${co(S.lamps_usb)})`, `Desk lamps: **${st(S.lamps_dimmable)}** dimmable (vs ${co(S.lamps_dimmable)})`, `Lunch bags: **${st(S.lunch_sustainable)}** sustainability claims (vs ${co(S.lunch_sustainable)})`]],
      ["Mood & styling words", [`Desks: **${co(S.desks_luxe)}** described as "luxe" (vs ${st(S.desks_luxe)})`, `Accent chairs: **${co(S.chairs_cozy)}** cozy/plush (vs ${st(S.chairs_cozy)})`, `Screens: **${co(S.partitions_print)}** print/photo designs (vs ${st(S.partitions_print)})`]],
      ["Use-case led", [`Backpacks: **${co(S.bp_outdoor)}** for outdoor use (vs ${st(S.bp_outdoor)})`, `Planners: **${co(S.planners_daily)}** daily layouts (vs ${st(S.planners_daily)})`, `Coffee organizers: **${co(S.coffee_capacity)}** hold 30–49 pods (vs ${st(S.coffee_capacity)})`]]]],
  ];
  M.forEach(([lab, cells], ri) => {
    const y = HY + 0.5 + ri * (RH + 0.04);
    box(s, MX, y, LWc, RH, C.blue, { r: 0.06 });
    text(s, lab, MX + 0.12, y, LWc - 0.2, RH, { fontSize: 12.5, bold: true, color: C.white, valign: "middle" });
    cells.forEach(([head, bullets], ci) => {
      const x = MX + LWc + GAP + ci * (CWc + GAP);
      box(s, x, y, CWc, RH, ri % 2 ? C.white : C.paler, { r: 0.06, line: C.line, lineW: 0.5 });
      text(s, head, x + 0.12, y + 0.05, CWc - 0.2, 0.24, { fontSize: 11.5, bold: true, color: cols[ci].hi });
      text(s, bullets.flatMap((b, j) => {
        const r = runs(b, { fontSize: 10.5, color: C.text }, cols[ci].hi);
        r[0].options.bullet = { indent: 10 };
        if (j < bullets.length - 1) r[r.length - 1].options.breakLine = true;
        return r;
      }), x + 0.12, y + 0.3, CWc - 0.18, RH - 0.34, { paraSpaceAfter: 1 });
    });
  });
  text(s, "Shares = % of each retailer's product families in the node  ·  (vs …) = the compared retailer in the same node  ·  every gap shown is statistically credible (≥ 95%)  ·  Amazon text is short, so its feature shares are lower bounds", MX, 6.86, 12.43, 0.2, { fontSize: 8.5, italic: true, color: C.muted });
  s.addNotes("How to read: every cell has the same form, category: share of that retailer's range (vs the compared retailer in the same node). Bullets 1-2 of the Staples column mirror the Wayfair column (furniture and décor nodes); bullet 3 mirrors the Amazon column (supplies, bags and kitchen nodes).\nWhat Pat will recognise: Staples is a workplace assortment (corporate desks, reception seating, tackable panels, tech-enabled lamps, premium furniture prices). What may be new: how sharply the competitors split, Wayfair towards the home (living-room chairs, statement décor, folding screens, desks under $200) and Amazon towards the person and the activity (hiking and travel packs, gender-targeted products, guided journals, wood-tone kitchen storage, sub-$10 planners).\nCaveat: Amazon listings carry only a title and a short subtitle, so feature-level shares there are lower bounds. Credibility = Bayesian probability that the share difference is real, 95% or more for every gap shown.");

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
  const FR = { add: ["ADD", C.strong], deepen: ["DEEPEN", C.gap], "trade-up": ["TRADE-UP", C.mid] };
  const RG = 0.08, RCW = (12.43 - 2 * RG) / 3, RY = 1.15, RRH = 1.75;
  SEGS.forEach((seg, ci) => {
    const x = 0.45 + ci * (RCW + RG);
    box(s, x, RY, RCW, 0.36, SEG[seg].fill, { r: 0.06 });
    text(s, SEG[seg].short, x, RY, RCW, 0.36, { fontSize: 12.5, bold: true, color: SEG[seg].ink, align: "center", valign: "middle" });
    bySeg(seg).forEach((k, ri) => {
      const y = RY + 0.4 + ri * (RRH + 0.04), n = N[k];
      box(s, x, y, RCW, RRH, C.white, { r: 0.08, line: C.line });
      text(s, n.leaf, x + 0.12, y + 0.04, RCW - 1.1, 0.27, { fontSize: 12.5, bold: true, color: C.navy, valign: "middle" });
      chip(s, n.competitor, x + RCW - 0.95, y + 0.06, 0.85, 0.22, compColor(n.competitor), C.white, 9);
      F.picks[k].forEach((pk, pi) => {
        const py = y + 0.31 + pi * 0.72, ex = pk.exemplar, iw = RCW - 0.24;
        if (pi === 1) s.addShape("line", { x: x + 0.12, y: py - 0.025, w: iw, h: 0, line: { color: "E3E8F0", width: 0.75 } });
        text(s, [{ text: pk.label, options: { hyperlink: { url: ex.url, tooltip: `Open example on ${n.competitor}` }, color: C.navy, bold: true } }], x + 0.12, py, iw - 0.82, 0.2, { fontSize: 11, valign: "middle" });
        const [fl, fc] = FR[pk.framing];
        chip(s, fl, x + RCW - 0.88, py + 0.01, 0.76, 0.18, fc, C.white, 8);
        // the archetype (attribute combination) behind the pick
        s.addShape("roundRect", { x: x + 0.12, y: py + 0.215, w: iw, h: 0.18, fill: { color: "E8EFFB" }, line: { color: "E8EFFB", width: 0 }, rectRadius: 0.05 });
        text(s, pk.combo_shown.replace(/ · /g, " · "), x + 0.16, py + 0.215, iw - 0.06, 0.18, { fontSize: pk.combo_shown.length > 76 ? 7.5 : pk.combo_shown.length > 72 ? 8 : pk.combo_shown.length > 64 ? 8.5 : 9, color: C.blue, valign: "middle" });
        text(s, EV[k][pi](pk), x + 0.12, py + 0.405, iw, 0.15, { fontSize: 9, color: C.muted, valign: "middle" });
        text(s, [{ text: "e.g. ", options: { color: C.muted } }, { text: shortTitle(ex.title, 44) + (ex.price ? ` · ${money(ex.price)}` : "") + " ↗", options: { hyperlink: { url: ex.url, tooltip: ex.title }, color: C.mid, underline: { style: "sng" } } }], x + 0.12, py + 0.55, iw, 0.15, { fontSize: 9, valign: "middle" });
      });
    });
  });
  text(s, [
    { text: "Blue tag", options: { bold: true, color: C.blue } }, { text: " = the archetype (attribute combination) behind each pick   ·   " },
    { text: "ADD", options: { bold: true, color: C.strong } }, { text: " = Staples carries ~none   " },
    { text: "DEEPEN", options: { bold: true, color: C.gap } }, { text: " = Staples carries a little   " },
    { text: "TRADE-UP", options: { bold: true, color: C.mid } }, { text: " = Staples has it at lower prices   ·   Click a name to open an example product" },
  ], 0.45, 6.92, 12.43, 0.2, { fontSize: 9, color: C.muted });
  const recNotes = ORDER.map((k) => `${k}: ` + F.picks[k].map((pk) => `#${pk.final_rank} ${pk.label} [${pk.framing}; ${pk.tier}] (archetype: ${pk.archetype}; full combination: ${pk.combo}); example ${pk.exemplar.title.slice(0, 70)} ${pk.exemplar.price ? money(pk.exemplar.price) : ""}; nearest Staples item: ${pk.exemplar.nearest_staples.slice(0, 60)}${pk.skipped ? `; skipped: ${pk.skipped}` : ""}${pk.note ? `; note: ${pk.note}` : ""}`).join(" | ")).join("\n");
  s.addNotes("How the two picks were chosen: walk each node's final ranking (both methods, each with its own cannibalisation gate), skip near-duplicates (the same product idea with only a modifier added) and skip any pick whose 'Staples lacks it' claim fails a check of the Staples catalogue (attributes and titles). The blue tag is the archetype's attribute combination (stated values; empty defaults such as 'Vibe: plain' are omitted). Each example is the recommended SKU priced closest to the archetype's competitor median unless another example matches the idea better; it is safe under the method(s) that recommended it.\n" + recNotes);

  // ======================= 7. FUTURE SCOPE =======================
  pres.addSection({ title: "Next steps" });
  s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Next steps" });
  s.addText("Future Scope: From PoC to an Always-On Curation Engine", { placeholder: "title" });
  // roadmap strip
  const road = [
    ["PoC (done): 9 nodes · external data · " + F.totals9.recommended + " safe adds", C.pale, C.navy],
    ["Phase 2: every category + Staples' internal data", C.mid, C.white],
    ["Phase 3: always-on curation & growth engine", C.navy, C.white],
  ];
  road.forEach(([t, f, ink], i) => {
    const w = 12.43 / 3 + 0.1, x = 0.45 + i * (12.43 / 3) - (i ? 0.05 : 0);
    s.addShape(i === 0 ? "homePlate" : "chevron", { x, y: 1.2, w: i === 2 ? w - 0.05 : w, h: 0.46, fill: { color: f }, line: { color: C.white, width: 1 } });
    text(s, t, x + (i ? 0.32 : 0.15), 1.2, w - (i ? 0.6 : 0.45), 0.46, { fontSize: 11.5, bold: true, color: ink, align: "center", valign: "middle" });
  });
  const FUT = [
    { n: "1", t: "Unlock with Staples' internal data", fill: C.blue, cards: [
      { ic: "chart", h: "Demand-weighted prioritisation", q: "Which gaps will actually sell, and how much?",
        b: ["Join sales, traffic & search data to each archetype", "Score expected demand, GMV & commission per pick", "Re-rank the add-list by revenue, not gap size"], o: "Revenue-sized add-list per node" },
      { ic: "userF", h: "Customer-segment targeting", q: "Who buys which archetype?",
        b: ["Profile buyers: SMB vs home, RFM, basket mix", "Cluster customers and map clusters to archetypes", "Match picks to Hero, Probable & Non-Hero nodes"], o: "The right assortment for each segment" },
      { ic: "clip", h: "Automated seller-listing vetting", q: "Should this seller's listing go live?",
        b: ["Run the same engine on every seller submission", "Auto-score fit, 1P cannibalisation & price", "Approve / review / reject queue for curators"], o: "Curation that scales beyond manual review" },
    ] },
    { n: "2", t: "Grow beyond assortment gaps", fill: C.navy, cards: [
      { ic: "srch", h: "Search-gap mining", q: "What do shoppers search for that Staples doesn't sell?",
        b: ["Map on-site searches to nodes & archetypes", "Flag zero-result, low-click and high-exit queries", "Feed unmet demand into seller recruitment"], o: "Demand-backed recruiting pipeline" },
      { ic: "basket", h: "Basket completion & attach", q: "Which item completes the customer's basket?",
        b: ["Market-basket analysis on transactions", "Find missing complements, e.g. Back-to-School kits", "Recruit sellers for 1–2 attach items per order"], o: "Bigger baskets, new commission" },
      { ic: "globe", h: "Always-on market radar", q: "Which categories are about to grow, and who leads?",
        b: ["Monthly crawl of more competitors and categories", "Image-based design score + social & search trends", "Forecast demand before entering Explore nodes"], o: "Early warning on new whitespace" },
    ] },
  ];
  FUT.forEach((pn, i) => {
    const x = 0.45 + i * 6.29, w = 6.14;
    box(s, x, 1.8, w, 0.46, pn.fill, { r: 0.08 });
    s.addShape("ellipse", { x: x + 0.12, y: 1.85, w: 0.36, h: 0.36, fill: { color: C.orange }, line: { color: C.orange, width: 0 } });
    text(s, pn.n, x + 0.12, 1.85, 0.36, 0.36, { fontSize: 14, bold: true, color: C.white, align: "center", valign: "middle" });
    text(s, pn.t, x + 0.6, 1.8, w - 0.7, 0.46, { fontSize: 15, bold: true, color: C.white, valign: "middle" });
    pn.cards.forEach((c, j) => {
      const y = 2.34 + j * 1.55, h = 1.47;
      box(s, x, y, w, h, C.white, { r: 0.1, line: C.line, shadow: true });
      circleIcon(s, ICON[c.ic], x + 0.15, y + 0.15, 0.55, pn.fill);
      text(s, c.h, x + 0.82, y + 0.08, w - 2.6, 0.27, { fontSize: 13, bold: true, color: C.navy });
      text(s, c.q, x + 0.82, y + 0.36, w - 2.6, 0.22, { fontSize: 10.5, italic: true, color: C.mid });
      text(s, c.b.map((t, k) => ({ text: t, options: { bullet: { indent: 10 }, breakLine: k < c.b.length - 1 } })), x + 0.82, y + 0.62, w - 2.6, 0.8, { fontSize: 10.5, color: C.text, paraSpaceAfter: 1 });
      box(s, x + w - 1.68, y + 0.15, 1.54, h - 0.3, C.paler, { r: 0.08 });
      text(s, "OUTCOME", x + w - 1.6, y + 0.24, 1.4, 0.2, { fontSize: 8, bold: true, color: C.orange, charSpacing: 1 });
      text(s, c.o, x + w - 1.6, y + 0.46, 1.4, h - 0.65, { fontSize: 11, bold: true, color: C.navy });
    });
  });
  s.addNotes("Why the full engagement: the PoC proves the engine on 9 nodes with external data only. Phase 2 adds Staples' internal data and every category; Phase 3 makes it an always-on engine.\n(1) With internal data: demand-weighted prioritisation (join sales, traffic and search to archetypes; re-rank by expected GMV and commission); customer-segment targeting (profile SMB vs home buyers, RFM and basket mix, cluster and map to archetypes and to Hero / Probable / Non-Hero); automated seller-listing vetting (the same attribute and archetype engine scores every marketplace submission for fit, sales-weighted cannibalisation and price, feeding an approve / review / reject queue so curation scales beyond manual review).\n(2) Beyond assortment gaps: search-gap mining (zero-result and high-exit searches mapped to archetypes feed recruiting); basket completion (market-basket analysis finds missing complements such as Back-to-School kits; target 1–2 attach items per order); always-on market radar (monthly crawls of more competitors, image-based design scoring, social and search trends, demand forecasting for Explore nodes).");

  // ======================= 8. TECH ARCHITECTURE =======================
  s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Next steps" });
  s.addText("Solution Architecture: From Listings to Safe Recommendations", { placeholder: "title" });
  const stages = [
    { t: "Data Acquisition", w: 2.1, items: [["dbS", "Staples.com", "4.9K products · 12 nodes"], ["dbA", "Amazon", "14.6K products · 7 nodes"], ["dbW", "Wayfair", "11.2K products · 5 nodes"]] },
    { t: "Prep & Mapping", sub: "S0–S2", w: 2.3, items: [["filter", "Clean & de-identify", "prices, mojibake, PII removed"], ["layer", "Product families", "colour / size variants merged"], ["sitemap", "Node mapping", "k-NN classifier"]] },
    { t: "Attributes & Archetypes", sub: "S3–S4", w: 2.45, items: [["tags", "3-tier attributes", "function · look · lifestyle, full text, same on both sides"], ["proj", "Neutral product cards", "bge embeddings, no price, no brand"], ["puzzle", "Archetypes", "4–6-attribute combinations, up to 3 sets per node"]] },
    { t: "Two Scoring Methods", sub: "S5–S6", w: 2.95, methods: true },
    { t: "Gates & Picks", sub: "S7–S8", w: 2.31, items: [["shield", "Safety gates", "common → per method → final"], ["check", "Final list", "Strong / Vector-led / Gap-led, 3–10 per node"], ["storeB", "Products & sellers", "each example beside its nearest Staples item"]] },
  ];
  let sx = 0.45;
  stages.forEach((st, i) => {
    const w = st.w;
    s.addShape(i === 0 ? "homePlate" : "chevron", { x: sx, y: 1.28, w: w + 0.06, h: 0.6, fill: { color: [C.pale, "CFDDF5", C.head, "A9C3EE", "97B6EA"][i] }, line: { color: C.white, width: 0 } });
    text(s, [{ text: st.t, options: { bold: true, breakLine: !!st.sub } }, ...(st.sub ? [{ text: st.sub, options: { fontSize: 9.5, color: C.muted } }] : [])], sx + (i ? 0.28 : 0.1), 1.28, w - (i ? 0.45 : 0.35), 0.6, { fontSize: 12.5, color: C.navy, align: "center", valign: "middle" });
    const bx = sx + 0.04, bw = w - 0.06, by = 2.02, bh = 4.85;
    box(s, bx, by, bw, bh, C.white, { r: 0.08, line: "9DB2D6", dash: "dash" });
    if (st.methods) {
      const mm = [
        { h: "Method 1 · Vector view", f: C.paler, lines: ["VW (Vector Whitespace)", "AAS (Adjacency Affinity Score)", "CRS (Cannibalisation Risk Score)", "AD (Aesthetic Delta) · PPR (Price Position Ratio)"], out: "→ VOS (Vector Opportunity Score)" },
        { h: "Method 2 · Attribute view", f: "F3F0FA", lines: ["LSR (Log Share Ratio) · PPG (Price Position Gap)", "CG (Colour Gap) · MSG (Material/Style Gap)", "DFG (Design-Forward Gap)", "ACR (Attribute Cannibalisation Risk)"], out: "→ TG (Total Gap)" },
      ];
      mm.forEach((m, j) => {
        const my = by + 0.12 + j * 2.36;
        box(s, bx + 0.1, my, bw - 0.2, 2.25, m.f, { r: 0.08 });
        text(s, m.h, bx + 0.2, my + 0.06, bw - 0.4, 0.28, { fontSize: 12, bold: true, color: C.blue });
        text(s, m.lines.map((l, k) => ({ text: l, options: { breakLine: k < m.lines.length - 1 } })), bx + 0.2, my + 0.45, bw - 0.4, 1.2, { fontSize: 10, color: C.text, paraSpaceAfter: 1 });
        text(s, m.out, bx + 0.2, my + 1.8, bw - 0.4, 0.3, { fontSize: 11, bold: true, color: C.navy });
      });
    } else {
      st.items.forEach(([ic, h, d], j) => {
        const iy = by + 0.3 + j * 1.55;
        s.addImage({ data: ICON[ic], x: bx + bw / 2 - 0.27, y: iy, w: 0.54, h: 0.54 });
        text(s, h, bx + 0.08, iy + 0.58, bw - 0.16, 0.24, { fontSize: 11.5, bold: true, color: C.navy, align: "center" });
        text(s, d, bx + 0.08, iy + 0.82, bw - 0.16, 0.42, { fontSize: 9.5, color: C.muted, align: "center" });
      });
    }
    if (i < stages.length - 1) s.addShape("line", { x: bx + bw - 0.02, y: by + bh / 2, w: 0.1, h: 0, line: { color: C.blue, width: 1.5, endArrowType: "triangle" } });
    sx += w + 0.08;
  });
  s.addNotes("End-to-end flow. S0–S2: ingest and clean the three sources (PII from Wayfair reviews removed), merge colour/size variants into product families, map each competitor product to the right Staples node with a k-NN classifier over all Staples nodes. S3–S4: read every product's full text with the same extractor on both sides into 3 tiers of attributes; build archetypes as combinations of 4–6 attributes (no price). S5: Method 1 in embedding space (whitespace, fit with Staples, aesthetic difference, cannibalisation risk, price position) gives VOS. S6: Method 2 on attribute shares (share gap, price, colour, material/style, design) gives TG, with its own attribute cannibalisation check (ACR). S7: each method has its own safety gate; the final gate takes the union and tiers it. S8: example products safe under the recommending method, each shown next to the nearest Staples product, plus brand and seller notes.");

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
