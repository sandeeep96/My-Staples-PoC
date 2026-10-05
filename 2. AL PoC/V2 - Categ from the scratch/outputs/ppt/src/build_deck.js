// Builds the Staples Assortment PoC deck from deck_facts_<VERSION>.json.
// Usage (from outputs/ppt/src):  node build_deck.js V3
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
    bottle: [tb.TbBottle, C.white], pad: [tb.TbKeyboard, C.white], pencil: [fa.FaPencilRuler, C.white],
    play: [fa.FaPlayCircle, C.blue], link: [fa.FaLink, C.blue], radar: [tb.TbRadar, C.white], qmark: [fa.FaQuestionCircle, C.white],
    flag: [fa.FaFlagCheckered, C.white], barW: [fa.FaChartBar, C.white], shieldW: [fa.FaShieldAlt, C.white],
  };
  for (const [k, [comp, col]] of Object.entries(need)) ICON[k] = await icon(comp, col);
  const NODE_ICON = {
    Planners: "cal", Backpacks: "bag", "Office Desks": "desk", "Accent Chairs": "chair", "Desk Lamps": "lamp",
    "Lunch Bags": "lunch", Clocks: "clock", Partitions: "part", "Coffee Organizers": "coffee",
    "Desk Organizers": "pencil", "Water Bottles": "bottle", "Desk Pads": "pad",
  };
  // all 12 analysed nodes (from V3), in Staples' segment rank order
  const ORDER = Object.keys(N).sort((a, b) => N[a].rank - N[b].rank);
  const SEGS = ["Hero · EXTEND", "Probable Hero · BUILD", "Non-Hero · EXPLORE"];
  const bySeg = (s) => ORDER.filter((k) => N[k].segment === s);
  const compColor = (c) => (c === "Amazon" ? C.amazon : C.wayfair);

  const T = F.totals;
  const SRC = F.sourcing, DF = F.design_forward;

  // Input file sizes (Excels in the project root): Staples 4,891 SKUs, Amazon 14,591, Wayfair 11,175.
  const SKUS = { staples: "4.9K", amazon: "14.6K", wayfair: "11.2K" };
  const k1 = (x) => (x / 1000).toFixed(1) + "K";

  // ======================= 0. TITLE =======================
  pres.addSection({ title: "Opening" });
  let s = pres.addSlide({ masterName: "DARK", sectionTitle: "Opening" });
  text(s, "Staples Marketplace", 0.7, 1.75, 7.3, 0.95, { fontSize: 44, bold: true, color: C.white });
  text(s, "Assortment Gap & Archetype Recommendation", 0.7, 2.7, 7.3, 0.6, { fontSize: 26, color: "CADCFC" });
  text(s, "Which competitor products can Staples add through its marketplace, without cannibalising the assortment it already sells?", 0.7, 3.6, 6.9, 0.95, { fontSize: 16, italic: true, color: "E5ECF8" });
  text(s, "LatentView Analytics  ·  October 2026", 0.7, 6.25, 7, 0.35, { fontSize: 14, color: "CADCFC" });
  // node grid motif: the 12 focus nodes, columns = segments
  SEGS.forEach((seg, ci) => {
    const x = 8.35 + ci * 1.45;
    text(s, SEG[seg].short.split(" · ")[0], x, 0.5, 1.3, 0.3, { fontSize: 10, bold: true, color: "CADCFC", align: "center" });
    bySeg(seg).forEach((k, ri) => {
      const y = 0.88 + ri * 1.5;
      box(s, x, y, 1.3, 1.36, ci === 0 ? "1C3A7A" : ci === 1 ? "24498F" : "2D5AA6", { r: 0.12 });
      s.addImage({ data: ICON[NODE_ICON[k]], x: x + 0.39, y: y + 0.16, w: 0.52, h: 0.52 });
      text(s, k, x + 0.05, y + 0.78, 1.2, 0.46, { fontSize: 10.5, color: C.white, align: "center", valign: "middle" });
    });
  });
  s.addNotes(`Opening. This PoC answers one question for each of ${T.nodes_scored} Staples nodes: what does the leading competitor (Amazon or Wayfair) carry that Staples does not, and which of those items can Staples add through the marketplace without cannibalising its own assortment. External data only.`);

  // ======================= 1. PROBLEM STATEMENT & BUSINESS OUTCOMES =======================
  pres.addSection({ title: "Context" });
  s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Context" });
  s.addText("Problem Statement & Business Outcomes", { placeholder: "title" });
  const PLX = 0.45, PLW = 5.6, PRX = 6.83, PRW = 6.05;
  [[PLX, PLW, "Business Problem", "qmark", "Q1 2027 goal: a curated, core-adjacent (\"White Chair\") marketplace"],
   [PRX, PRW, "Business Outcomes", "flag", `What this PoC delivers across ${T.nodes_scored} Staples nodes`]].forEach(([x, w, t, ic, sub]) => {
    box(s, x, 1.25, w, 0.58, C.head, { r: 0.1 });
    circleIcon(s, ICON[ic], x + 0.14, 1.31, 0.46, C.blue);
    text(s, t, x + 0.72, 1.25, w - 0.9, 0.58, { fontSize: 17, bold: true, color: C.navy, valign: "middle" });
    text(s, sub, x + 0.05, 1.9, w - 0.1, 0.3, { fontSize: 10.5, italic: true, color: C.muted, valign: "middle" });
  });
  const PO = [
    ["Where can the marketplace grow without diluting Staples' brand authority?",
      "target", `**${T.nodes_scored} core-adjacent nodes** across Hero, Probable Hero & Non-Hero segments, each benchmarked against its leading competitor`],
    ["What do Amazon and Wayfair carry in these categories that Staples doesn't?",
      "srch", `**A gap map:** ${k1(T.staples_families)} Staples vs ${k1(T.competitor_families)} competitor product families compared on colour, material, style, use & price`],
    ["Which of those gaps can Staples add without cannibalising its 1P sales?",
      "shieldW", `**${T.recommended} safe archetypes** (attribute combinations), each through cannibalisation safety gates; ${T.tiers.Strong} confirmed by both methods`],
    ["What exactly should be listed, and which sellers can supply it?",
      "boxW", `**${T.example_products} example products** with links, each beside its nearest Staples item; **${SRC.brands_on_staples_12_n} of their brands** already sell on Staples`],
    ["Can this be decided now on external data, and repeated as the catalogue grows?",
      "cogs", "**A repeatable engine:** external data only today; new nodes, competitors or seller listings run through the same pipeline"],
  ];
  PO.forEach(([q, ic, o], i) => {
    const y = 2.3 + i * 0.92, h = 0.82;
    box(s, PLX, y, PLW, h, C.pale, { r: 0.1 });
    s.addShape("ellipse", { x: PLX + 0.16, y: y + h / 2 - 0.21, w: 0.42, h: 0.42, fill: { color: C.navy }, line: { color: C.navy, width: 0 } });
    text(s, String(i + 1), PLX + 0.16, y + h / 2 - 0.21, 0.42, 0.42, { fontSize: 14, bold: true, color: C.white, align: "center", valign: "middle" });
    text(s, q, PLX + 0.75, y, PLW - 0.9, h, { fontSize: 13, bold: true, color: C.navy, valign: "middle" });
    s.addShape("rightArrow", { x: PLX + PLW + 0.2, y: y + h / 2 - 0.17, w: 0.4, h: 0.34, fill: { color: C.orange }, line: { color: C.orange, width: 0 } });
    box(s, PRX, y, PRW, h, C.white, { r: 0.1, line: C.line });
    circleIcon(s, ICON[ic], PRX + 0.14, y + h / 2 - 0.24, 0.48, C.blue);
    text(s, runs(o, { fontSize: 12, color: C.text }, C.blue), PRX + 0.78, y, PRW - 0.92, h, { valign: "middle" });
  });
  s.addNotes(`Business problem (the Q1 2027 mandate): grow a curated marketplace rather than accepting full categories; add true whitespace that does not cannibalise first-party (1P) sales; target core-adjacent "White Chair" extensions (design and lifestyle variants of core items) to compete with Wayfair and Amazon without diluting core B2B; decide on external data only.\nOutcomes, one per question: (1) ${T.nodes_scored} nodes chosen with Staples across three segments; (2) ${T.staples_families.toLocaleString("en-US")} Staples vs ${T.competitor_families.toLocaleString("en-US")} competitor product families (colour/size variants merged) compared on the same attributes; (3) ${T.recommended} recommended archetypes (${T.tiers.Strong} Strong, ${T.tiers["Vector-led"]} Vector-led, ${T.tiers["Gap-led"]} Gap-led, ${T.tiers.Conditional || 0} Conditional), each passing the safety gate of the method that recommends it; (4) ${T.example_products} example products, each safe under its method and shown beside the nearest Staples product, with brand and seller notes; brands already on Staples: ${SRC.brands_on_staples_12.join(", ")}; (5) every category word, threshold and competitor lives in configuration, so new nodes and competitors run without code changes, and the same engine can score seller listings.`);

  // ======================= 2. EXECUTIVE SUMMARY =======================
  s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Context" });
  s.addText("Executive Summary", { placeholder: "title" });
  const kpis = [
    [String(T.nodes_scored), "Staples nodes analysed across 3 segments, against Amazon & Wayfair"],
    [`${k1(T.staples_families)} | ${k1(T.competitor_families)}`, "Staples vs competitor product families compared"],
    [String(T.recommended), `archetypes recommended to add; ${T.tiers.Strong} confirmed by both methods`],
    [String(T.example_products), `example products to list; ${SRC.brands_on_staples_12_n} of their brands already sell on Staples`],
  ];
  const KW = (12.43 - 3 * 0.15) / 4;
  kpis.forEach(([v, l], i) => {
    const x = 0.45 + i * (KW + 0.15);
    box(s, x, 1.22, KW, 1.0, C.paler, { r: 0.1 });
    text(s, v, x + 0.1, 1.25, KW - 0.2, 0.5, { fontSize: v.length > 6 ? 26 : 30, bold: true, color: C.blue, align: "center", valign: "middle" });
    text(s, l, x + 0.2, 1.75, KW - 0.4, 0.42, { fontSize: 10.5, color: C.text, align: "center" });
  });
  text(s, "Key insights: how the three assortments differ", 0.45, 2.32, 6.5, 0.26, { fontSize: 13.5, bold: true, color: C.blue, valign: "middle" });
  text(s, "% = share of each retailer's range in the same node;  (vs …) = the other retailer", 6.5, 2.32, 6.38, 0.26, { fontSize: 9, italic: true, color: C.muted, align: "right", valign: "middle" });
  const LWx = 2.3, GX = 0.06, CWx = (12.43 - LWx - 3 * GX) / 3, HY2 = 2.66, RH2 = 0.8;
  const ecols = [
    { t: "STAPLES", sub: "12 nodes", fill: C.staples, ink: C.white, hi: C.staples },
    { t: "WAYFAIR", sub: "5 nodes", fill: C.wayfair, ink: C.white, hi: C.wayfair },
    { t: "AMAZON", sub: "7 nodes", fill: C.amazonFill, ink: C.amazonInk, hi: C.amazon },
  ];
  ecols.forEach((c, i) => {
    const x = 0.45 + LWx + GX + i * (CWx + GX);
    box(s, x, HY2, CWx, 0.34, c.fill, { r: 0.06 });
    text(s, [{ text: c.t, options: { bold: true } }, { text: "  " + c.sub, options: { fontSize: 10 } }], x, HY2, CWx, 0.34, { fontSize: 12.5, color: c.ink, align: "center", valign: "middle" });
  });
  const st = (o) => `${o.st}%`, co = (o) => `${o.co}%`;
  const W = N["Water Bottles"];
  const EX = [
    ["Who they build for", "Three different customers", [
      ["The workplace", [`Accent chairs: **${st(S.chairs_reception)}** reception/lobby (vs ${co(S.chairs_reception)})`, `Partitions: **${st(S.partitions_tackable)}** tackable panels (vs ${co(S.partitions_tackable)})`]],
      ["The home", [`Accent chairs: **${co(S.chairs_residential)}** for living rooms (vs ${st(S.chairs_residential)})`, `Desks: **${co(S.desks_home_office)}** for home offices (vs ${st(S.desks_home_office)})`]],
      ["The person & the activity", [`Backpacks: **${co(S.bp_hiking)}** hiking/outdoor (vs ${st(S.bp_hiking)})`, `Water bottles: **${co(S.water_gym)}** gym/sports (vs ${st(S.water_gym)})`]]]],
    ["Look & material", "Staples is dark & functional; rivals are warm & natural", [
      ["Dark & utilitarian", [`Coffee organizers: **${st(S.coffee_black)}** black (vs ${co(S.coffee_black)})`, `Clocks: **${st(S.clocks_plastic)}** plastic/resin (vs ${co(S.clocks_plastic)})`]],
      ["Light, natural & statement", [`Accent chairs: **${co(S.chairs_light)}** light-neutral (vs ${st(S.chairs_light)})`, `Partitions: **${co(S.partitions_woven)}** natural/woven (vs ${st(S.partitions_woven)})`]],
      ["Warm, premium materials", [`Coffee organizers: **${co(S.coffee_wood)}** wood-tone (vs ${st(S.coffee_wood)})`, `Desk pads: **${co(S.pads_faux_leather)}** faux leather (vs ${st(S.pads_faux_leather)})`]]]],
    ["Design-forward range", "Rivals carry twice Staples' share", [
      ["1 in 5 products", [`All 12 nodes: **${DF.staples_all}%** of the range (vs ${DF.competitor_all}%)`, `Water bottles: **${W.design_forward_staples}%**, its one lead (vs ${W.design_forward_competitor}%)`]],
      ["More than 2 in 5", [`Its 5 nodes: **${DF.wayfair_competitor}%** of the range (vs ${DF.wayfair_staples}%)`, `Partitions: **${N.Partitions.design_forward_competitor}%** (vs ${N.Partitions.design_forward_staples}%)`]],
      ["More than 2 in 5", [`Its 7 nodes: **${DF.amazon_competitor}%** of the range (vs ${DF.amazon_staples}%)`, `Backpacks: **${N.Backpacks.design_forward_competitor}%** (vs ${N.Backpacks.design_forward_staples}%)`]]]],
    ["Price ladder", "Rivals cover the price points Staples skips", [
      ["Premium-priced furniture", [`Desks: median **${money0(N["Office Desks"].price_median_staples)}** (vs ${money0(N["Office Desks"].price_median_competitor)})`, `Partitions: median **${money0(N.Partitions.price_median_staples)}** (vs ${money0(N.Partitions.price_median_competitor)})`]],
      ["Entry-price furniture, premium décor", [`Desks: **${B.desks_u200.co}%** under $200 (vs ${B.desks_u200.st}%)`, `Clocks: **${B.clocks_125p.co}%** at $125+ (vs ${B.clocks_125p.st}%)`]],
      ["Cheaper everyday supplies", [`Planners: **${B.planners_u10.co}%** under $10 (vs ${B.planners_u10.st}%)`, `Desk pads: **${B.pads_u15.co}%** under $15 (vs ${B.pads_u15.st}%)`]]]],
  ];
  EX.forEach(([lab, take, cells], ri) => {
    const y = HY2 + 0.4 + ri * (RH2 + 0.05);
    box(s, 0.45, y, LWx, RH2, C.blue, { r: 0.06 });
    text(s, lab, 0.57, y + 0.07, LWx - 0.2, 0.26, { fontSize: 12.5, bold: true, color: C.white });
    text(s, take, 0.57, y + 0.33, LWx - 0.2, 0.44, { fontSize: 9.5, italic: true, color: "DCE7F8" });
    cells.forEach(([head, bullets], ci) => {
      const x = 0.45 + LWx + GX + ci * (CWx + GX);
      box(s, x, y, CWx, RH2, ri % 2 ? C.white : C.paler, { r: 0.06, line: C.line, lineW: 0.5 });
      text(s, head, x + 0.12, y + 0.05, CWx - 0.2, 0.22, { fontSize: 11, bold: true, color: ecols[ci].hi });
      text(s, bullets.flatMap((b, j) => {
        const r = runs(b, { fontSize: 10, color: C.text }, ecols[ci].hi);
        r[0].options.bullet = { indent: 10 };
        if (j < bullets.length - 1) r[r.length - 1].options.breakLine = true;
        return r;
      }), x + 0.12, y + 0.29, CWx - 0.18, RH2 - 0.32, { paraSpaceAfter: 1 });
    });
  });
  box(s, 0.45, 6.5, 12.43, 0.5, C.navy, { r: 0.08 });
  text(s, [
    { text: "So what:  ", options: { bold: true, color: C.orange } },
    { text: "Staples can win the home and lifestyle shopper with design-led, home and activity variants of what it already sells (the \"White Chair\" play), sourced through marketplace sellers, without touching its workplace core." },
  ], 0.65, 6.5, 12.03, 0.5, { fontSize: 11.5, color: C.white, valign: "middle" });
  s.addNotes(`Tiles (all 12 nodes): ${T.staples_families.toLocaleString("en-US")} Staples and ${T.competitor_families.toLocaleString("en-US")} competitor product families (Amazon ${T.amazon_families.toLocaleString("en-US")}, Wayfair ${T.wayfair_families.toLocaleString("en-US")}); ${T.archetypes_built} archetypes built; ${T.recommended} recommended (${T.tiers.Strong} Strong = both methods agree, ${T.tiers["Vector-led"]} Vector-led, ${T.tiers["Gap-led"]} Gap-led, ${T.tiers.Conditional || 0} Conditional). ${T.example_products} example products across ${T.example_products_nodes} nodes, each safe under the method that recommends it and shown next to the nearest Staples product. Brands already selling on Staples: ${SRC.brands_on_staples_12.join(", ")}.\nWhy the fourth tile changed: V1 showed "${T.rec_absent_share}% of recommendations are archetypes Staples carries none of". The arithmetic holds (${T.rec_absent_at_staples} of ${T.recommended}), but it is mostly built in: archetypes are narrow 4-6-attribute combinations and the engine looks for gaps, so zero Staples matches is expected. It also overstates absence (e.g. every desk-lamp archetype shows zero, yet Staples sells 55 shaded lamps, mostly under $100). The example-product count is actionable instead.\nInsights: every share is from the same node, Staples vs that node's competitor; every gap shown is statistically credible (95% or more). Design-forward = text-based design-forward index of 0.6 or more (provisional until image-based scoring). Amazon listings carry short text, so its feature shares are lower bounds.\nWhat Pat will recognise: Staples is a workplace assortment (reception seating, tackable panels, black and plastic finishes, business-grade furniture prices). What may be new: how sharply the competitors split, Wayfair to the home (living rooms, light and natural finishes, desks under $200, statement décor at $125+) and Amazon to the person and the activity (hiking packs, gym bottles, wood-tone and faux-leather materials, sub-$10 planners and sub-$15 desk pads). Water bottles is the one node where Staples' range is more design-forward than the competitor's.`);

  // ======================= 3. CURRENT SCOPE =======================
  s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Context" });
  s.addText(`Current Scope (PoC): ${ORDER.length} Focus Nodes Across 3 Segments`, { placeholder: "title" });
  const hdr = (t, al = "left") => ({ text: t, options: { bold: true, color: C.white, fill: { color: C.blue }, fontSize: 12.5, valign: "middle", align: al } });
  const rows = [[hdr("Segment · Play", "center"), hdr("Staples node"), hdr("Category path"), hdr("Primary competitor", "center"), hdr("Archetypes recommended", "center")]];
  SEGS.forEach((seg) => {
    const ks = bySeg(seg);
    ks.forEach((k, i) => {
      const n = N[k], parts = n.node_id.split(" > "), f = i % 2 ? C.paler : C.white;
      const r = [];
      if (i === 0) r.push({ text: seg.replace(" · ", "\n"), options: { rowspan: ks.length, fill: { color: SEG[seg].fill }, color: SEG[seg].ink, bold: true, fontSize: 13, align: "center", valign: "middle" } });
      r.push({ text: n.leaf, options: { bold: true, fontSize: 12, color: C.navy, valign: "middle", fill: { color: f } } });
      r.push({ text: parts.slice(0, -1).join(" > "), options: { fontSize: 10.5, color: C.muted, valign: "middle", fill: { color: f } } });
      r.push({ text: n.competitor, options: { bold: true, fontSize: 12, color: compColor(n.competitor), align: "center", valign: "middle", fill: { color: f } } });
      r.push({ text: String(n.recommended), options: { bold: true, fontSize: 12, color: C.navy, align: "center", valign: "middle", fill: { color: f } } });
      rows.push(r);
    });
  });
  s.addTable(rows, { x: 0.45, y: 1.25, w: 12.43, colW: [1.9, 3.3, 4.0, 1.55, 1.68], rowH: [0.42, ...Array(ORDER.length).fill(0.385)], fontFace: FONT, border: { type: "solid", pt: 0.75, color: C.line }, margin: [0.03, 0.1, 0.03, 0.1] });
  box(s, 0.45, 6.4, 12.43, 0.62, C.warnFill, { r: 0.1, line: C.orange, lineW: 1 });
  s.addImage({ data: ICON.warn, x: 0.63, y: 6.59, w: 0.24, h: 0.24 });
  text(s, [
    { text: "Data disclaimer:  ", options: { bold: true, color: "8A5A00" } },
    { text: `competitor data are scraped listing samples (Amazon ${SKUS.amazon} and Wayfair ${SKUS.wayfair} SKUs, vs ${SKUS.staples} Staples SKUs), not full catalogues; the Staples data are close to complete. We therefore compare shares of each retailer's range, never raw counts. No internal sales, traffic or margin data were used.` },
  ], 1.02, 6.4, 11.7, 0.62, { fontSize: 10.5, color: C.text, valign: "middle" });
  s.addNotes(`Segments (as per our research): Hero = Staples' top-performing categories, so we EXTEND them with design-led variants; Probable Hero = a good market where Staples can improve its position, so we BUILD depth; Non-Hero = a smaller Staples presence today, so we EXPLORE via marketplace sellers with near-zero 1P risk.\nCompetitors (as per our research): each node is compared with its Primary competitor only: Wayfair, the leading online home-furnishing store, for furniture and décor (5 nodes); Amazon, the default everyday marketplace, for supplies, bags and kitchen (7 nodes).\nArchetypes recommended: the final gate keeps 3 to 10 per node; Desk Organizers, Water Bottles and Desk Pads have the smallest competitor samples (185, 194 and 61 product families), hence fewer picks.\nDisclaimer: competitor files are convenience samples of scraped listing pages; Staples is close to a census. Every comparison is a share of each retailer's range with a credibility check, never a raw count.`);

  // ======================= 4. DEMO =======================
  pres.addSection({ title: "Demo" });
  s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Demo" });
  s.addText("Demo", { placeholder: "title" });
  s.addImage({ data: ICON.play, x: 6.17, y: 2.0, w: 1.0, h: 1.0 });
  text(s, "Live Demo", 0.45, 3.15, 12.43, 0.8, { fontSize: 40, bold: true, color: C.navy, align: "center", valign: "middle" });
  box(s, 3.67, 4.25, 6.0, 0.7, C.paler, { r: 0.1, line: C.sky, dash: "dash" });
  s.addImage({ data: ICON.link, x: 3.95, y: 4.44, w: 0.32, h: 0.32 });
  text(s, "Link: [to be added]", 4.45, 4.25, 5.0, 0.7, { fontSize: 18, color: C.mid, valign: "middle" });
  s.addNotes("Placeholder: add the demo link here before the session.");

  // ======================= 5. SOLUTION ARCHITECTURE =======================
  pres.addSection({ title: "Solution" });
  s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Solution" });
  s.addText("Solution Architecture: From Listings to Safe Recommendations", { placeholder: "title" });
  const stages = [
    { t: "Data Acquisition", w: 1.9, items: [["dbS", "Staples.com", `${SKUS.staples} SKUs · 12 nodes`], ["dbA", "Amazon", `${SKUS.amazon} SKUs · 7 nodes`], ["dbW", "Wayfair", `${SKUS.wayfair} SKUs · 5 nodes`]] },
    { t: "Prep & Mapping", sub: "S0–S2", w: 2.05, items: [["filter", "Clean & de-identify", "prices, text fixes, PII removed"], ["layer", "Product families", "colour / size variants merged"], ["sitemap", "Node mapping", "k-NN classifier"]] },
    { t: "Attributes & Archetypes", sub: "S3–S4", w: 2.3, items: [["tags", "3-tier attributes", "function · look · lifestyle, same extractor on both sides"], ["proj", "Neutral product cards", "bge embeddings, no price, no brand"], ["puzzle", "Archetypes", "4–6-attribute combinations, up to 3 sets per node"]] },
    { t: "Two Scoring Methods", sub: "S5–S6", w: 2.76, methods: true },
    { t: "Gates & Picks", sub: "S7–S8", w: 1.9, items: [["shield", "Safety gates", "common → per method → final"], ["check", "Final list", "union of both methods, 3–10 per node"], ["storeB", "Products & sellers", "each beside its nearest Staples item"]] },
  ];
  const AG = 0.38, by = 2.05, bh = 4.65;
  let sx = 0.45;
  stages.forEach((st, i) => {
    const w = st.w, last = i === stages.length - 1;
    const cw = last ? w : w + AG - 0.02;
    s.addShape(i === 0 ? "homePlate" : "chevron", { x: sx - (i ? 0.1 : 0), y: 1.28, w: cw + (i ? 0.1 : 0), h: 0.6, fill: { color: [C.pale, "CFDDF5", C.head, "A9C3EE", "97B6EA"][i] }, line: { color: C.white, width: 1 } });
    text(s, [{ text: st.t, options: { bold: true, breakLine: !!st.sub } }, ...(st.sub ? [{ text: st.sub, options: { fontSize: 9.5, color: C.muted } }] : [])], sx + (i ? 0.25 : 0.1), 1.28, cw - (i ? 0.45 : 0.4), 0.6, { fontSize: 12.5, color: C.navy, align: "center", valign: "middle" });
    box(s, sx, by, w, bh, C.white, { r: 0.08, line: "D3DDEE", lineW: 0.5 });
    if (st.methods) {
      const mm = [
        { h: "Method 1 · Vector view", f: C.paler, lines: ["VW (Vector Whitespace)", "AAS (Adjacency Affinity Score)", "CRS (Cannibalisation Risk Score)", "AD (Aesthetic Delta)", "PPR (Price Position Ratio)"], out: "→ VOS (Vector Opportunity Score)" },
        { h: "Method 2 · Attribute view", f: "F3F0FA", lines: ["LSR (Log Share Ratio)", "PPG (Price Position Gap)", "CG (Colour Gap) · MSG (Material/Style Gap)", "DFG (Design-Forward Gap)", "ACR (Attribute Cannibalisation Risk)"], out: "→ TG (Total Gap)" },
      ];
      mm.forEach((m, j) => {
        const mh = (bh - 0.3) / 2, my = by + 0.1 + j * (mh + 0.1);
        box(s, sx + 0.1, my, w - 0.2, mh, m.f, { r: 0.08 });
        text(s, m.h, sx + 0.2, my + 0.08, w - 0.4, 0.28, { fontSize: 12, bold: true, color: C.blue });
        text(s, m.lines.map((l, k) => ({ text: l, options: { breakLine: k < m.lines.length - 1 } })), sx + 0.2, my + 0.45, w - 0.35, 1.1, { fontSize: 9.5, color: C.text, paraSpaceAfter: 2 });
        text(s, m.out, sx + 0.2, my + mh - 0.4, w - 0.4, 0.3, { fontSize: 11, bold: true, color: C.navy });
      });
    } else {
      st.items.forEach(([ic, h, d], j) => {
        const iy = by + 0.3 + j * 1.48;
        s.addImage({ data: ICON[ic], x: sx + w / 2 - 0.25, y: iy, w: 0.5, h: 0.5 });
        text(s, h, sx + 0.08, iy + 0.56, w - 0.16, 0.24, { fontSize: 11.5, bold: true, color: C.navy, align: "center" });
        text(s, d, sx + 0.08, iy + 0.8, w - 0.16, 0.5, { fontSize: 9.5, color: C.muted, align: "center" });
      });
    }
    if (!last) s.addShape("rightArrow", { x: sx + w + 0.05, y: by + bh / 2 - 0.2, w: AG - 0.1, h: 0.4, fill: { color: C.orange }, line: { color: C.orange, width: 0 } });
    sx += w + AG;
  });
  s.addNotes("End-to-end flow. S0–S2: ingest and clean the three sources (PII from Wayfair reviews removed), merge colour/size variants into product families, map each competitor product to the right Staples node with a k-NN classifier over all Staples nodes. S3–S4: read every product's full text with the same extractor on both sides into 3 tiers of attributes; build archetypes as combinations of 4–6 attributes (no price). S5: Method 1 in embedding space (whitespace, fit with Staples, aesthetic difference, cannibalisation risk, price position) gives VOS. S6: Method 2 on attribute shares (share gap, price, colour, material/style, design) gives TG, with its own attribute cannibalisation check (ACR). S7: each method has its own safety gate; the final gate takes the union and tiers it. S8: example products safe under the recommending method, each shown next to the nearest Staples product, plus brand and seller notes.");

  // ======================= 6. FUTURE SCOPE =======================
  pres.addSection({ title: "Next steps" });
  s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Next steps" });
  s.addText("Future Scope: Two Ways to Build on the PoC", { placeholder: "title" });
  box(s, 0.45, 1.22, 12.43, 0.42, C.paler, { r: 0.08 });
  text(s, runs("The PoC used external data only. **Both tracks below add Staples' internal data:** sales, traffic, customers, on-site search, transactions and seller submissions.", { fontSize: 11.5, color: C.text }, C.navy), 0.65, 1.22, 12.03, 0.42, { valign: "middle", align: "center" });
  const FUT = [
    { n: "1", t: "Extend this PoC with internal data", sub: "Same question (which archetypes to add), answered sharper and kept current", fill: C.blue, cards: [
      { ic: "chart", h: "Demand & segment prioritisation", q: "Which gaps will sell, and to which customers?",
        b: ["Link sales, traffic & search to each archetype", "Profile buyers (SMB vs home, RFM) per archetype", "Re-rank add-lists by expected GMV & commission"], d: "Sales · traffic · customers", o: "Revenue-ranked add-list per segment" },
      { ic: "radar", h: "Always-on market radar", q: "What changed in the market this month?",
        b: ["Scheduled re-crawls of Amazon, Wayfair & more", "Re-run the engine; flag new & closing gaps", "Track listed picks against Staples sales"], d: "Sales data (+ competitor crawls)", o: "A live gap list, refreshed monthly" },
      { ic: "clip", h: "Automated seller-listing vetting", q: "Should this seller's listing go live?",
        b: ["Run the same engine on every submission", "Auto-score fit, 1P overlap & price", "Approve / review / reject queue for curators"], d: "Seller submissions · 1P sales", o: "Curation that scales beyond manual review" },
    ] },
    { n: "2", t: "Beyond this PoC: what else we can do for you", sub: "New questions outside assortment gaps, on the same internal data", fill: C.navy, cards: [
      { ic: "srch", h: "Search-intent gap mining", q: "What do shoppers search for but not find?",
        b: ["Map on-site searches to nodes & archetypes", "Flag zero-result & high-exit queries", "Feed unmet demand into seller recruiting"], d: "On-site search logs", o: "Demand-backed recruiting pipeline" },
      { ic: "basket", h: "Market basket completion", q: "Which missing item would complete the basket?",
        b: ["Market-basket analysis on transactions", "Find missing complements, e.g. Back-to-School", "Recruit sellers for 1–2 attach items per order"], d: "Transactions", o: "Bigger baskets, new commission" },
      { ic: "barW", h: "Demand forecasting & research", q: "Which new categories are worth entering?",
        b: ["Forecast demand from sales & search history", "Add social-media & trend listening", "Size Non-Hero & new categories before entry"], d: "Sales & search history (+ social data)", o: "Evidence-backed category bets" },
    ] },
  ];
  FUT.forEach((pn, i) => {
    const x = 0.45 + i * 6.29, w = 6.14;
    box(s, x, 1.76, w, 0.72, pn.fill, { r: 0.08 });
    s.addShape("ellipse", { x: x + 0.14, y: 1.9, w: 0.44, h: 0.44, fill: { color: C.orange }, line: { color: C.orange, width: 0 } });
    text(s, pn.n, x + 0.14, 1.9, 0.44, 0.44, { fontSize: 16, bold: true, color: C.white, align: "center", valign: "middle" });
    text(s, pn.t, x + 0.72, 1.8, w - 0.82, 0.36, { fontSize: 15.5, bold: true, color: C.white, valign: "middle" });
    text(s, pn.sub, x + 0.72, 2.14, w - 0.82, 0.28, { fontSize: 10.5, italic: true, color: "DCE7F8", valign: "middle" });
    pn.cards.forEach((c, j) => {
      const y = 2.58 + j * 1.46, h = 1.38, RB = 1.72;
      box(s, x, y, w, h, C.white, { r: 0.1, line: C.line, shadow: true });
      circleIcon(s, ICON[c.ic], x + 0.14, y + 0.14, 0.5, pn.fill);
      text(s, c.h, x + 0.78, y + 0.08, w - 0.78 - RB - 0.1, 0.27, { fontSize: 12.5, bold: true, color: C.navy });
      text(s, c.q, x + 0.78, y + 0.35, w - 0.78 - RB - 0.1, 0.22, { fontSize: 10, italic: true, color: C.mid });
      text(s, c.b.map((t, k) => ({ text: t, options: { bullet: { indent: 10 }, breakLine: k < c.b.length - 1 } })), x + 0.78, y + 0.6, w - 0.78 - RB - 0.1, 0.74, { fontSize: 10, color: C.text, paraSpaceAfter: 1 });
      box(s, x + w - RB - 0.1, y + 0.1, RB, h - 0.2, C.paler, { r: 0.08 });
      text(s, "INTERNAL DATA", x + w - RB, y + 0.16, RB - 0.2, 0.18, { fontSize: 7.5, bold: true, color: C.orange, charSpacing: 1 });
      text(s, c.d, x + w - RB, y + 0.33, RB - 0.2, 0.36, { fontSize: 9.5, bold: true, color: C.mid });
      text(s, "OUTCOME", x + w - RB, y + 0.71, RB - 0.2, 0.18, { fontSize: 7.5, bold: true, color: C.orange, charSpacing: 1 });
      text(s, c.o, x + w - RB, y + 0.88, RB - 0.2, 0.4, { fontSize: 10, bold: true, color: C.navy });
    });
  });
  s.addNotes("Two tracks, both on Staples' internal data (the PoC used external data only).\n(1) Extend this PoC: the same question, which archetypes to add per node, answered better. Demand & segment prioritisation joins sales, traffic and search data to each archetype, profiles buyers (SMB vs home, RFM, basket mix) and re-ranks each node's add-list by expected GMV and commission per segment (Hero / Probable / Non-Hero). The always-on market radar re-crawls competitors on a schedule, re-runs the engine, flags new and closing gaps, and tracks listed picks against Staples sales. Automated seller-listing vetting runs the same attribute and archetype engine on every marketplace submission, scoring fit, sales-weighted 1P overlap and price, and feeds an approve / review / reject queue so curation scales beyond manual review.\n(2) Beyond this PoC: new questions. Search-intent gap mining maps on-site searches with zero or weak results to archetypes and feeds seller recruiting. Market basket completion finds missing complements in transactions (e.g. Back-to-School kits), targeting 1–2 attach items per order. Demand forecasting & research forecasts category demand from sales and search history, adds social and trend listening, and sizes Non-Hero and new categories before entry.");

  // ======================= 7. THANK YOU =======================
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
