// Builds the Staples Assortment PoC deck from deck_facts_<VERSION>.json.
// Usage (from outputs/ppt/src):  node build_deck.js V4
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
    hash: [fa.FaHashtag, C.white], poll: [fa.FaPoll, C.white], map: [fa.FaMapMarkedAlt, C.white],
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
  const ARW = "A9C3EE"; // soft-blue flow arrows (match the chevron palette)
  const arrow = (sl, x, y, w = 0.2, h = 0.28) => sl.addShape("rightArrow", { x, y, w, h, fill: { color: ARW }, line: { color: ARW, width: 0 } });
  const SLIDE_CONT = 5; // slide number of "Project Continuation" (next steps link to it)

  // ======================= 0. TITLE =======================
  pres.addSection({ title: "Opening" });
  let s = pres.addSlide({ masterName: "DARK", sectionTitle: "Opening" });
  text(s, "Staples Marketplace", 0.7, 2.3, 7.3, 0.95, { fontSize: 44, bold: true, color: C.white, valign: "middle" });
  s.addShape("rect", { x: 0.72, y: 3.36, w: 1.2, h: 0.06, fill: { color: C.orange }, line: { color: C.orange, width: 0 } });
  text(s, "Assortment Gap & Archetype Recommendation", 0.7, 3.55, 7.3, 0.6, { fontSize: 26, color: "CADCFC" });
  text(s, "LatentView Analytics  ·  October 2026", 0.7, 6.25, 7, 0.35, { fontSize: 14, color: "CADCFC" });
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

  // ======================= 1. EXECUTIVE SUMMARY =======================
  pres.addSection({ title: "Summary" });
  s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Summary" });
  s.addText("Executive Summary", { placeholder: "title" });
  // band 1a: the ask
  box(s, 0.45, 1.2, 12.43, 0.52, C.navy, { r: 0.08 });
  text(s, "THE ASK", 0.6, 1.2, 1.0, 0.52, { fontSize: 12, bold: true, color: C.orange, valign: "middle", charSpacing: 1 });
  text(s, "Which design-led, core-adjacent (\"White Chair\") products can Staples add to its marketplace without cannibalising 1P sales, using only external data?", 1.62, 1.2, 11.15, 0.52, { fontSize: 12.5, color: C.white, valign: "middle" });
  // band 1b: funnel tiles
  const tiles = [
    [String(T.nodes_scored), "Staples nodes across 3 segments, vs Amazon & Wayfair"],
    [k1(T.families_all), `product families analysed: ${k1(T.staples_families)} Staples, ${k1(T.competitor_families)} competitor`],
    [String(T.archetypes_built), "archetypes (attribute combinations) compared"],
    [String(T.recommended), `safe to add; ${T.tiers.Strong} confirmed by both methods`],
    [String(T.example_products), "example products ready to list"],
  ];
  const TG = 0.3, TW = (12.43 - 4 * TG) / 5;
  tiles.forEach(([v, l], i) => {
    const x = 0.45 + i * (TW + TG);
    box(s, x, 1.84, TW, 0.92, C.paler, { r: 0.1 });
    text(s, v, x + 0.08, 1.86, TW - 0.16, 0.44, { fontSize: 26, bold: true, color: C.blue, align: "center", valign: "middle" });
    text(s, l, x + 0.14, 2.3, TW - 0.28, 0.42, { fontSize: 10, color: C.text, align: "center", valign: "top" });
    if (i < tiles.length - 1) arrow(s, x + TW + 0.05, 2.16);
  });
  // band 2: how
  text(s, "HOW", 0.45, 2.92, 0.7, 0.46, { fontSize: 12, bold: true, color: C.blue, valign: "middle", charSpacing: 1 });
  const how = [["Match products across 3 retailers", "2F5DAA", C.white], ["Profile look, function & lifestyle", "5A82C8", C.white], ["Score twice, gate for 1P safety", "8FAEE0", C.navy]];
  const HW = 2.75;
  how.forEach(([t, f, ink], i) => {
    const x = 1.15 + i * (HW - 0.08);
    s.addShape(i === 0 ? "homePlate" : "chevron", { x, y: 2.92, w: HW, h: 0.46, fill: { color: f }, line: { color: C.white, width: 1 } });
    text(s, t, x + (i ? 0.28 : 0.12), 2.92, HW - (i ? 0.5 : 0.42), 0.46, { fontSize: 11, bold: true, color: ink, align: "center", valign: "middle" });
  });
  text(s, [{ text: "Two independent methods; ", options: { bold: true, color: C.navy } }, { text: "a pick survives only if it passes its own cannibalisation gate." }], 9.45, 2.88, 3.43, 0.54, { fontSize: 10.5, italic: true, color: C.text, valign: "middle" });
  // band 3: what to add first
  text(s, "WHAT STAPLES SHOULD ADD FIRST", 0.45, 3.56, 6, 0.28, { fontSize: 12, bold: true, color: C.blue, valign: "middle", charSpacing: 1 });
  text(s, `+${T.recommended - 4} more archetypes with example products: see the demo`, 6.5, 3.56, 6.38, 0.28, { fontSize: 10, italic: true, color: C.muted, align: "right", valign: "middle" });
  const P = F.picks;
  const recs = [
    { k: "Accent Chairs", pk: P["Accent Chairs"][1], ic: "chair", h: "The \"White Chair\": swivel barrel chair", st: "accent chairs" },
    { k: "Planners", pk: P.Planners[1], ic: "cal", h: "Guided & daily journals", st: "planners" },
    { k: "Partitions", pk: P.Partitions[0], ic: "part", h: "Folding screens under $150", st: "partitions" },
    { k: "Backpacks", pk: P.Backpacks[0], ic: "bag", h: "Hiking & outdoor daypacks", st: "backpacks" },
  ];
  const RW4 = (12.43 - 3 * 0.15) / 4;
  recs.forEach((r, i) => {
    const x = 0.45 + i * (RW4 + 0.15), y = 3.9, n = N[r.k], a = r.pk.attr_check, ex = r.pk.exemplar;
    box(s, x, y, RW4, 1.62, C.white, { r: 0.1, line: C.line, shadow: true });
    circleIcon(s, ICON[r.ic], x + 0.14, y + 0.14, 0.5, C.blue);
    text(s, r.h, x + 0.74, y + 0.1, RW4 - 0.84, 0.58, { fontSize: 12.5, bold: true, color: C.navy, valign: "middle" });
    text(s, [
      { text: "Staples today: ", options: { color: C.muted } }, { text: `${a.staples_hits} of ${a.staples_total}`, options: { bold: true, color: C.staples } }, { text: ` ${r.st}`, options: { breakLine: true } },
      { text: `${n.competitor}: `, options: { color: C.muted } }, { text: `${Math.round(a.comp_share)}%`, options: { bold: true, color: compColor(n.competitor) } }, { text: " of its range" },
    ], x + 0.16, y + 0.74, RW4 - 0.3, 0.5, { fontSize: 10.5, color: C.text, paraSpaceAfter: 2 });
    text(s, [{ text: "e.g. ", options: { color: C.muted } }, { text: shortTitle(ex.title, 30) + ` · ${money0(ex.price)} ↗`, options: { hyperlink: { url: ex.url, tooltip: ex.title }, color: C.mid, underline: { style: "sng" } } }], x + 0.16, y + 1.27, RW4 - 0.3, 0.2, { fontSize: 9.5 });
  });
  // band 4: next steps -> project continuation
  text(s, "NEXT STEPS", 0.45, 5.8, 4, 0.26, { fontSize: 12, bold: true, color: C.blue, valign: "middle", charSpacing: 1 });
  const nxt = [
    ["Calibrate safety-gate thresholds with merchants (60 side-by-side pairs)", "Starts PROTECT"],
    [`Review top picks; seller outreach starting with the ${SRC.brands_on_staples_12_n} brands on Staples`, "Starts CURATE"],
    ["Pilot 2–3 nodes with Staples data; track attach rate & commission", "Starts PRIORITISE & MONITOR"],
  ];
  const NW = 3.42;
  nxt.forEach(([t, tag], i) => {
    const x = 0.45 + i * (NW + 0.12), y = 6.1;
    box(s, x, y, NW, 0.86, C.pale, { r: 0.1 });
    s.addShape("ellipse", { x: x + 0.12, y: y + 0.12, w: 0.36, h: 0.36, fill: { color: C.navy }, line: { color: C.navy, width: 0 } });
    text(s, String(i + 1), x + 0.12, y + 0.12, 0.36, 0.36, { fontSize: 13, bold: true, color: C.white, align: "center", valign: "middle" });
    text(s, t, x + 0.58, y + 0.06, NW - 0.68, 0.5, { fontSize: 10.5, color: C.navy, bold: true, valign: "middle" });
    text(s, "→ " + tag, x + 0.58, y + 0.58, NW - 0.68, 0.22, { fontSize: 9, italic: true, bold: true, color: "B86E00", valign: "middle" });
  });
  const cx = 0.45 + 3 * (NW + 0.12) + 0.03, cw = 12.88 - cx;
  box(s, cx, 6.1, cw, 0.86, C.navy, { r: 0.1 });
  text(s, [{ text: "Continues as", options: { breakLine: true, fontSize: 10, color: "CADCFC" } }, { text: "Project Continuation  →", options: { bold: true, hyperlink: { slide: SLIDE_CONT, tooltip: "Go to Project Continuation" }, color: C.white } }], cx + 0.08, 6.1, cw - 0.16, 0.86, { fontSize: 11, color: C.white, valign: "middle", align: "center" });
  s.addNotes(`The ask: a curated, core-adjacent ("White Chair") marketplace for Q1 2027 that does not cannibalise 1P sales, built on external data only.\nFunnel: ${T.families_all.toLocaleString("en-US")} product families (${T.staples_families.toLocaleString("en-US")} Staples, ${T.amazon_families.toLocaleString("en-US")} Amazon, ${T.wayfair_families.toLocaleString("en-US")} Wayfair; colour/size variants merged) → ${T.archetypes_built} archetypes compared → ${T.recommended} pass the safety gates (${T.tiers.Strong} Strong, ${T.tiers["Vector-led"]} Vector-led, ${T.tiers["Gap-led"]} Gap-led, ${T.tiers.Conditional || 0} Conditional) → ${T.example_products} example products, each shown beside the nearest Staples item → ${SRC.brands_on_staples_12_n} brands already selling on Staples (${SRC.brands_on_staples_12.join(", ")}).\nHow: Method 1 compares products in an embedding space (whitespace, fit with Staples, look, cannibalisation risk, price position); Method 2 compares attribute shares (share gap, price, colour, material/style, design). Each has its own cannibalisation gate; the final list is their union.\nThe four headline picks were checked against the Staples catalogue: barrel chairs 0 of ${P["Accent Chairs"][1].attr_check.staples_total}; journals 0 of ${P.Planners[1].attr_check.staples_total}; folding screens under $150 0 of ${P.Partitions[0].attr_check.staples_total}; hiking / outdoor packs ${P.Backpacks[0].attr_check.staples_hits} of ${P.Backpacks[0].attr_check.staples_total}.\nIf asked about the assortments: Staples builds for the workplace (${S.chairs_reception.st}% of accent chairs are reception/lobby seats vs ${S.chairs_reception.co}% at Wayfair; ${S.partitions_tackable.st}% of partitions tackable vs ${S.partitions_tackable.co}%); Wayfair for the home (${S.chairs_residential.co}% of accent chairs for living rooms vs ${S.chairs_residential.st}%); Amazon for the person and the activity (${S.bp_hiking.co}% of backpacks hiking/outdoor vs ${S.bp_hiking.st}%). Design-forward share ${DF.staples_all}% at Staples vs ${DF.competitor_all}% at the competitors (text-based, provisional). Price: Staples desks median ${money0(N["Office Desks"].price_median_staples)} vs ${money0(N["Office Desks"].price_median_competitor)} at Wayfair; ${B.planners_u10.co}% of Amazon planners under $10 vs ${B.planners_u10.st}%.\nNext steps lead straight into the Project Continuation slide (click the box).`);

  // ======================= 2. CURRENT SCOPE =======================
  s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Summary" });
  s.addText(`PoC Scope at a Glance: ${ORDER.length} Nodes · 3 Segments · 2 Competitors`, { placeholder: "title" });
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
  s.addTable(rows, { x: 0.45, y: 1.25, w: 12.43, colW: [1.9, 3.3, 4.0, 1.55, 1.68], rowH: [0.42, ...Array(ORDER.length).fill(0.39)], fontFace: FONT, border: { type: "solid", pt: 0.75, color: C.line }, margin: [0.03, 0.1, 0.03, 0.1] });
  box(s, 0.45, 6.5, 12.43, 0.42, C.warnFill, { r: 0.08, line: C.orange, lineW: 1 });
  s.addImage({ data: ICON.warn, x: 0.62, y: 6.59, w: 0.24, h: 0.24 });
  text(s, [
    { text: "Data disclaimer:  ", options: { bold: true, color: "8A5A00" } },
    { text: "competitor data are scraped listing samples, not full catalogues; Staples data are close to complete." },
  ], 1.0, 6.5, 11.7, 0.42, { fontSize: 11, color: C.text, valign: "middle" });
  s.addNotes(`Segments (as per our research): Hero = Staples' top-performing categories, so we EXTEND them with design-led variants; Probable Hero = a good market where Staples can improve its position, so we BUILD depth; Non-Hero = a smaller Staples presence today, so we EXPLORE via marketplace sellers with near-zero 1P risk.\nCompetitors (as per our research): each node is compared with its Primary competitor only: Wayfair, the leading online home-furnishing store, for furniture and décor (5 nodes); Amazon, the default everyday marketplace, for supplies, bags and kitchen (7 nodes).\nArchetypes recommended: the final gate keeps 3 to 10 per node; Desk Organizers, Water Bottles and Desk Pads have the smallest competitor samples (185, 194 and 61 product families), hence fewer picks.\nDisclaimer detail: Amazon ${SKUS.amazon} and Wayfair ${SKUS.wayfair} SKUs vs ${SKUS.staples} Staples SKUs. Because the competitor files are samples, every comparison is a share of each retailer's range with a credibility check, never a raw count. No internal sales, traffic or margin data were used.`);

  // ======================= 3. DEMO =======================
  pres.addSection({ title: "Demo" });
  s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Demo" });
  s.addText("Demo", { placeholder: "title" });
  s.addImage({ data: ICON.play, x: 6.17, y: 2.0, w: 1.0, h: 1.0 });
  text(s, "Live Demo", 0.45, 3.15, 12.43, 0.8, { fontSize: 40, bold: true, color: C.navy, align: "center", valign: "middle" });
  box(s, 3.67, 4.25, 6.0, 0.7, C.paler, { r: 0.1, line: C.sky, dash: "dash" });
  s.addImage({ data: ICON.link, x: 3.95, y: 4.44, w: 0.32, h: 0.32 });
  text(s, "Link: [to be added]", 4.45, 4.25, 5.0, 0.7, { fontSize: 18, color: C.mid, valign: "middle" });
  s.addNotes("Placeholder: add the demo link here before the session.");

  // ======================= 4. PROJECT CONTINUATION =======================
  pres.addSection({ title: "Next steps" });
  s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Next steps" });
  s.addText("Project Continuation: The PoC Engine on Staples Data", { placeholder: "title" });
  box(s, 0.45, 1.18, 12.43, 0.38, C.paler, { r: 0.08 });
  text(s, runs("Same question, which products to add, answered with **real demand**, **Staples' own thresholds** and **kept current**. Deepen the 12 nodes first, then broaden.", { fontSize: 11.5, color: C.text }, C.navy), 0.6, 1.18, 12.13, 0.38, { align: "center", valign: "middle" });
  const CONT = [
    { v: "PRIORITISE", ic: "chart", h: "Demand & segment prioritisation", q: "Which gaps will sell, and to whom?", tag: "Next step 3",
      b: ["Link sales, traffic & search to each archetype", "Profile buyers: SMB vs home, RFM, basket mix", "Re-rank add-lists by expected GMV & commission"], d: "Sales · traffic · customers", o: "Revenue-ranked add-list per segment" },
    { v: "PROTECT", ic: "shieldW", h: "Cannibalisation & threshold tuning", q: "Will this listing take sales from 1P?", tag: "Next step 1",
      b: ["Tune safety-gate thresholds with merchants: cannibalisation, price, fit, picks per node", "Swap today's supply proxy for real 1P sales overlap", "Set price & margin floors per node"], d: "1P sales · margin · price history", o: "1P protected in revenue terms" },
    { v: "EXPAND", ic: "target", h: "Any node, competitor or audience", q: "Where should Staples grow next?",
      b: ["Pick the category and the competitor to benchmark", "e.g. IKEA for small-space home offices, Target for Back-to-School, Etsy for gifting", "From 12 nodes to every category: config only, no new code"], d: "Staples catalogue + new competitor crawls", o: "The engine aimed at the audience Staples wants" },
    { v: "CURATE", ic: "clip", h: "Automated seller-listing vetting", q: "Should this listing go live?", tag: "Next step 2",
      b: ["Score every seller submission with the same engine", "Check fit, 1P overlap & price automatically", "Approve / review / reject queue that learns from curators"], d: "Seller submissions · curator decisions", o: "Curation that scales beyond manual review" },
    { v: "MONITOR", ic: "radar", h: "Market radar & pilot tracking", q: "What changed, and what worked?", tag: "Next step 3",
      b: ["Monthly re-crawls flag new & closing gaps", "Track listed picks' GMV, attach & commission", "Compare with forecast; feed back into step 1"], d: "Sales · pilot results (+ competitor crawls)", o: "Live gap list & proven ROI" },
  ];
  const CG = 0.26, CW5 = (12.43 - 4 * CG) / 5, HY5 = 1.9, BY5 = 2.74, BH5 = 3.72;
  CONT.forEach((c, i) => {
    const x = 0.45 + i * (CW5 + CG);
    box(s, x, HY5, CW5, 0.78, i < 2 ? C.blue : i === 2 ? C.mid : C.navy, { r: 0.08 });
    s.addImage({ data: ICON[c.ic], x: x + 0.12, y: HY5 + 0.2, w: 0.38, h: 0.38 });
    text(s, `${i + 1} · ${c.v}`, x + 0.6, HY5 + 0.06, CW5 - 0.68, 0.24, { fontSize: 10.5, bold: true, color: C.orange, charSpacing: 1 });
    text(s, c.h, x + 0.6, HY5 + 0.3, CW5 - 0.68, 0.44, { fontSize: 11, bold: true, color: C.white, valign: "middle" });
    if (i < CONT.length - 1) arrow(s, x + CW5 + 0.04, HY5 + 0.25, 0.18, 0.28);
    box(s, x, BY5, CW5, BH5, C.white, { r: 0.08, line: C.line });
    text(s, c.q, x + 0.12, BY5 + 0.08, CW5 - 0.24, 0.42, { fontSize: 10, italic: true, bold: true, color: C.mid, valign: "middle" });
    text(s, c.b.map((t, k) => ({ text: t, options: { bullet: { indent: 9 }, breakLine: k < c.b.length - 1 } })), x + 0.1, BY5 + 0.56, CW5 - 0.18, 1.6, { fontSize: 9.5, color: C.text, paraSpaceAfter: 3 });
    box(s, x + 0.08, BY5 + 2.2, CW5 - 0.16, 0.62, C.paler, { r: 0.06 });
    text(s, "STAPLES DATA", x + 0.16, BY5 + 2.25, CW5 - 0.3, 0.18, { fontSize: 7.5, bold: true, color: C.orange, charSpacing: 1 });
    text(s, c.d, x + 0.16, BY5 + 2.42, CW5 - 0.3, 0.38, { fontSize: 9.5, bold: true, color: C.mid });
    box(s, x + 0.08, BY5 + 2.9, CW5 - 0.16, 0.74, C.pale, { r: 0.06 });
    text(s, "OUTCOME", x + 0.16, BY5 + 2.95, CW5 - 0.3, 0.18, { fontSize: 7.5, bold: true, color: C.orange, charSpacing: 1 });
    text(s, c.o, x + 0.16, BY5 + 3.12, CW5 - 0.3, 0.48, { fontSize: 10.5, bold: true, color: C.navy });
  });
  // return loop: results feed the next cycle
  const c1 = 0.45 + CW5 / 2, c5 = 0.45 + 4 * (CW5 + CG) + CW5 / 2, ly = 6.72;
  s.addShape("line", { x: c5, y: BY5 + BH5, w: 0, h: ly - BY5 - BH5, line: { color: C.sky, width: 1.5 } });
  s.addShape("line", { x: c1, y: ly, w: c5 - c1, h: 0, line: { color: C.sky, width: 1.5 } });
  s.addShape("line", { x: c1, y: BY5 + BH5, w: 0, h: ly - BY5 - BH5, line: { color: C.sky, width: 1.5, beginArrowType: "triangle" } });
  box(s, 4.67, ly - 0.14, 4.0, 0.28, C.white, { r: 0.04 });
  text(s, "↺  results feed the next cycle: the engine learns", 4.67, ly - 0.14, 4.0, 0.28, { fontSize: 10, italic: true, bold: true, color: C.mid, align: "center", valign: "middle" });
  s.addNotes("Project continuation: the same engine, now on Staples' internal data. Order: deepen the 12 nodes first, then broaden.\n1 Prioritise: join sales, traffic and search data to each archetype; profile buyers (SMB vs home, RFM, basket mix); re-rank each node's add-list by expected GMV and commission per segment (Hero / Probable / Non-Hero).\n2 Protect: today's cannibalisation checks use supply only (how close a competitor product sits to Staples products). With Staples data we tune every safety-gate threshold with merchants (cannibalisation risk bands, price-position limits, fit-with-Staples cut-offs, picks per node; the calibration session in next step 1 starts this) and replace the supply proxy with real 1P sales overlap and substitution seen in baskets, plus price and margin floors per node.\n3 Expand: once calibrated, point the engine at any Staples category and any competitor that represents the audience Staples wants (e.g. IKEA for small-space home offices, Target for students and Back-to-School, Etsy for gifting). A new competitor is one adapter entry and a new node one config file; no code change.\n4 Curate: the same attribute and archetype engine scores every seller submission for fit, 1P overlap and price, feeding an approve / review / reject queue that learns from curator decisions (next step 2 starts this with the top picks and the brands already on Staples).\n5 Monitor: scheduled re-crawls flag new and closing gaps; pilot listings (next step 3) are tracked for GMV, attach rate and commission against the forecast, and results feed back into prioritisation.");

  // ======================= 5. ALTERNATE GROWTH PATHS =======================
  s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Next steps" });
  s.addText("Alternate Growth Paths for the Marketplace", { placeholder: "title" });
  box(s, 0.45, 1.18, 12.43, 0.38, C.paler, { r: 0.08 });
  text(s, runs("Beyond assortment gaps: **six more ways to grow**, combining external signals with Staples data.", { fontSize: 11.5, color: C.text }, C.navy), 0.6, 1.18, 12.13, 0.38, { align: "center", valign: "middle" });
  const ALT = [
    { t: "SENSE demand early", fill: C.blue, cards: [
      { ic: "srch", h: "SEO & search-intent gaps", q: "What do shoppers search for but not find?",
        b: ["Map on-site searches & SEO keywords to archetypes", "Flag zero-result searches & keywords rivals win", "Feed seller recruiting & product pages"], d: "On-site search logs · SEO keywords", o: "Existing traffic, converted" },
      { ic: "hash", h: "Social media & trend listening", q: "Which styles are taking off?",
        b: ["Track archetype mentions & saves on TikTok, Pinterest, Reddit", "Add Google Trends; score growth & sentiment", "Flag rising styles for Explore nodes"], d: "Social & trend data + Staples sales", o: "Spot the next \"White Chair\" early" },
    ] },
    { t: "SIZE & VALIDATE", fill: C.mid, cards: [
      { ic: "poll", h: "Market research & customer surveys", q: "What do Staples customers actually want?",
        b: ["Survey SMB & home customers on needs, style & price", "Concept-test the top archetypes with images", "Feed results into the prioritisation weights"], d: "Customer panel · email base", o: "Picks validated by Staples' own customers" },
      { ic: "barW", h: "Demand forecasting", q: "How much will each archetype sell?",
        b: ["Forecast demand per node & archetype", "Add seasonality (Back-to-School) & trend signals", "Size GMV & commission before listing"], d: "Sales history + trend signals", o: "Supply in place before the season" },
    ] },
    { t: "ACT on basket & catalogue", fill: C.navy, cards: [
      { ic: "map", h: "New-category whitespace", q: "Which new categories are worth opening?",
        b: [`Start from the ${k1(T.backlog_families)} competitor products outside the 12 nodes`, "Add adjacent verticals, e.g. facility supplies", "Size with forecasting & research; open the best"], d: "PoC backlog + sales & search", o: "Evidence-backed new categories" },
      { ic: "basket", h: "Basket completion & Back-to-School kits", q: "Which item would complete the basket?",
        b: ["Market-basket analysis on transactions", "Find missing complements & seasonal kits", "Recruit sellers for 1–2 attach items per order"], d: "Transactions", o: "Bigger baskets, new commission" },
    ] },
  ];
  const AG3 = 0.26, AW = (12.43 - 2 * AG3) / 3;
  ALT.forEach((col, i) => {
    const x = 0.45 + i * (AW + AG3);
    box(s, x, 1.7, AW, 0.42, col.fill, { r: 0.08 });
    text(s, `${i + 1} · ${col.t}`, x, 1.7, AW, 0.42, { fontSize: 13, bold: true, color: C.white, align: "center", valign: "middle", charSpacing: 1 });
    if (i < ALT.length - 1) arrow(s, x + AW + 0.04, 1.77, 0.18, 0.28);
    col.cards.forEach((c, j) => {
      const y = 2.24 + j * 2.36, h = 2.26;
      box(s, x, y, AW, h, C.white, { r: 0.1, line: C.line, shadow: true });
      circleIcon(s, ICON[c.ic], x + 0.14, y + 0.14, 0.48, col.fill);
      text(s, c.h, x + 0.74, y + 0.1, AW - 0.86, 0.3, { fontSize: 12.5, bold: true, color: C.navy, valign: "middle" });
      text(s, c.q, x + 0.74, y + 0.4, AW - 0.86, 0.24, { fontSize: 10, italic: true, color: C.mid, valign: "middle" });
      text(s, c.b.map((t, k) => ({ text: t, options: { bullet: { type: "number" }, breakLine: k < c.b.length - 1 } })), x + 0.2, y + 0.74, AW - 0.32, 0.82, { fontSize: 10, color: C.text, paraSpaceAfter: 2 });
      const sy = y + 1.62, sw = (AW - 0.3) / 2;
      box(s, x + 0.1, sy, AW - 0.2, 0.54, C.paler, { r: 0.06 });
      text(s, "DATA", x + 0.2, sy + 0.04, sw - 0.1, 0.16, { fontSize: 7.5, bold: true, color: C.orange, charSpacing: 1 });
      text(s, c.d, x + 0.2, sy + 0.2, sw - 0.1, 0.32, { fontSize: 9, bold: true, color: C.mid });
      text(s, "OUTCOME", x + 0.2 + sw, sy + 0.04, sw - 0.05, 0.16, { fontSize: 7.5, bold: true, color: C.orange, charSpacing: 1 });
      text(s, c.o, x + 0.2 + sw, sy + 0.2, sw - 0.05, 0.32, { fontSize: 9, bold: true, color: C.navy });
    });
  });
  s.addNotes(`Alternate growth paths, read left to right: sense demand early, size and validate it, then act on the basket and the catalogue. Each combines external signals with Staples data.\n- Social media & trend listening (social media analytics + trend listening): mentions, hashtags and saves per archetype on TikTok, Instagram, Pinterest and Reddit plus Google Trends, scored for growth and sentiment; rising styles feed the Explore nodes.\n- SEO & search-intent gaps: on-site searches (zero-result, high-exit) and external SEO keywords where competitors rank and Staples does not, mapped to archetypes; feeds seller recruiting and product pages.\n- Demand forecasting: per node and archetype from sales history, with Back-to-School seasonality and the trend signals from social listening; sizes GMV and commission before listing.\n- Market research & customer surveys (market research + market survey): SMB and home customers on unmet needs, style and price; concept tests of the top archetypes; results set the prioritisation weights.\n- Basket completion & Back-to-School kits: market-basket analysis finds missing complements; target 1–2 attach items per order (the brief's basket goal).\n- New-category whitespace: the PoC already set aside ${T.backlog_families.toLocaleString("en-US")} competitor product families that fit none of the 12 nodes (e.g. wall calendars, thermocoolers, reusable bags, briefcases, many of which Staples shelves elsewhere); running the engine against the whole Staples tree, plus the brief's adjacent verticals such as facility supplies, finds categories with no Staples home.\nFurther options if asked: B2B account cross-sell, seller recruitment scoring, listing content enrichment (our attribute extractor auto-tags seller listings for filters and search).`);

  // ======================= 6. SOLUTION ARCHITECTURE =======================
  pres.addSection({ title: "Appendix" });
  s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Appendix" });
  s.addText("Solution Architecture: From Listings to Safe Recommendations", { placeholder: "title" });
  const stages = [
    { t: "Data Acquisition", w: 1.9, items: [["dbS", "Staples.com", `${SKUS.staples} SKUs · 12 nodes`], ["dbA", "Amazon", `${SKUS.amazon} SKUs · 7 nodes`], ["dbW", "Wayfair", `${SKUS.wayfair} SKUs · 5 nodes`]] },
    { t: "Prep & Mapping", sub: "S0–S2", w: 2.05, items: [["filter", "Clean & de-identify", "prices, text fixes, PII removed"], ["layer", "Product families", "colour / size variants merged"], ["sitemap", "Node mapping", "k-NN classifier"]] },
    { t: "Attributes & Archetypes", sub: "S3–S4", w: 2.3, items: [["tags", "3-tier attributes", "function · look · lifestyle, same extractor on both sides"], ["proj", "Neutral product embeddings", "extracted attributes only (no title, price or brand), bge-base"], ["puzzle", "Archetypes", "4–6-attribute combinations, up to 3 sets per node"]] },
    { t: "Two Scoring Methods", sub: "S5–S6", w: 2.76, methods: true },
    { t: "Gates & Picks", sub: "S7–S8", w: 1.9, items: [["shield", "Safety gates", "common → per method → final"], ["check", "Final list", "union of both methods, 3–10 per node"], ["storeB", "Products & sellers", "each beside its nearest Staples item"]] },
  ];
  const AGs = 0.38, by = 2.05, bh = 4.65;
  let sx = 0.45;
  stages.forEach((st, i) => {
    const w = st.w, last = i === stages.length - 1;
    const cw = last ? w : w + AGs - 0.02;
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
    if (!last) arrow(s, sx + w + 0.08, by + bh / 2 - 0.15, 0.22, 0.3);
    sx += w + AGs;
  });
  s.addNotes("End-to-end flow. S0–S2: ingest and clean the three sources (PII from Wayfair reviews removed), merge colour/size variants into product families, map each competitor product to the right Staples node with a k-NN classifier over all Staples nodes. S3–S4: read every product's full text with the same extractor on both sides into 3 tiers of attributes; build archetypes as combinations of 4–6 attributes (no price). Neutral product embeddings: each product becomes a card of its extracted attributes only (same template on both sides, no title, price or brand, so neither retailer's copy style separates them), embedded with bge-base; it powers Method 1, the clustering cross-check and the nearest-Staples match for every example product. S5: Method 1 in embedding space (whitespace, fit with Staples, aesthetic difference, cannibalisation risk, price position) gives VOS. S6: Method 2 on attribute shares (share gap, price, colour, material/style, design) gives TG, with its own attribute cannibalisation check (ACR). S7: each method has its own safety gate; the final gate takes the union and tiers it. S8: example products safe under the recommending method, each shown next to the nearest Staples product, plus brand and seller notes.");

  // ======================= 7. THANK YOU =======================
  pres.addSection({ title: "Close" });
  s = pres.addSlide({ masterName: "DARK", sectionTitle: "Close" });
  text(s, "Thank You", 0.7, 2.6, 8, 1.0, { fontSize: 48, bold: true, color: C.white });
  s.addShape("rect", { x: 0.72, y: 3.68, w: 1.2, h: 0.06, fill: { color: C.orange }, line: { color: C.orange, width: 0 } });
  text(s, "Questions & discussion", 0.7, 3.85, 8, 0.5, { fontSize: 22, color: "CADCFC" });
  text(s, "LatentView Analytics  ·  October 2026", 0.7, 6.25, 7, 0.35, { fontSize: 14, color: "CADCFC" });
  s.addNotes("Close. Next steps are on the executive summary and continue on the Project Continuation slide.");

  await pres.writeFile({ fileName: OUT });
  console.log("wrote", OUT);
})();
