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
  
  // ======================= 0. TITLE =======================
  pres.addSection({ title: "Opening" });
  let s = pres.addSlide({ masterName: "DARK", sectionTitle: "Opening" });
  text(s, "Staples Marketplace", 0.7, 2.3, 7.3, 0.95, { fontSize: 44, bold: true, color: C.white, valign: "middle" });
  s.addShape("rect", { x: 0.72, y: 3.36, w: 1.2, h: 0.06, fill: { color: C.orange }, line: { color: C.orange, width: 0 } });
  text(s, "Assortment Gap & Archetype Recommendation", 0.7, 3.55, 7.3, 0.6, { fontSize: 26, color: "CADCFC" });
  text(s, "LatentView Analytics  ·  October 2026", 0.7, 6.25, 7, 0.35, { fontSize: 14, color: "CADCFC" });
  // client and LatentView logos below the title in their own colours (official artwork, outputs/ppt/assets),
  // each on its own small white card so it stays legible on navy; the cards are separate
  const LOGO_ST = path.resolve(__dirname, "..", "assets", "title_logo_staples.png");
  const LOGO_LV = path.resolve(__dirname, "..", "assets", "title_logo_latentview.png");
  if (fs.existsSync(LOGO_ST) && fs.existsSync(LOGO_LV)) {
    box(s, 0.72, 4.6, 2.5, 0.72, C.white, { r: 0.08 });
    s.addImage({ path: LOGO_ST, x: 0.9, y: 4.77, w: 2.14, h: 0.38, sizing: { type: "contain", w: 2.14, h: 0.38 } });
    box(s, 3.62, 4.6, 2.5, 0.72, C.white, { r: 0.08 });
    s.addImage({ path: LOGO_LV, x: 3.8, y: 4.73, w: 2.14, h: 0.46, sizing: { type: "contain", w: 2.14, h: 0.46 } });
  }
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

  // Next-phase steps (from the first review's asks): drawn on slide 6; slide 2's next steps reuse the same labels and headings
  const CONT = [
    { v: "SIZE", ic: "dollar", f: "Agree the opportunity-$ formula and 2–3 pilot nodes", h: "Size of the prize per archetype", q: "Which gaps are worth the most?",
      b: ["Scale competitor activity to Staples velocity", "Times expected conversion & modelled AUR = opportunity $", "Stack-rank: the ~20% of lifts that solve 80%"], d: "Sales · velocity · conversion · AUR", o: "A $-ranked shortlist, not a long list" },
    { v: "SENSE", ic: "srch", f: "Pull search logs and the search → PDP → order funnel", h: "Search-funnel demand", q: "Where do shoppers look, and leave?",
      b: ["Null & poor searches, incl. redirects that hide demand", "Trace search → PDP → need met → conversion", "Map each break point to an archetype"], d: "Search logs · PDP & funnel data", o: "Unmet demand, evidenced" },
    { v: "GUARD", ic: "shieldW", f: "Set the rules per zone with merchants (60 side-by-side pairs)", h: "Core vs adjacent guardrails", q: "How far can each category stretch?",
      b: ["Tighter cannibalisation, price & margin floors near core", "Freer grow-and-learn rules in adjacent categories", "Merchant rules plug into today's safety gates"], d: "1P sales · margin · price history", o: "Curated, not an everything store" },
    { v: "TARGET", ic: "users2", f: "Split picks by channel; draft the first category stories", h: "Channel & stakeholder views", q: "Who is it for, and who owns it?",
      b: ["Staples.com (SMB + consumers) vs Staples Business", "Basket fit for today's customers first", "One category story per merchant owner"], d: "Customer segments · baskets · channel", o: "Stories each merchant can act on" },
    { v: "RECRUIT", ic: "hand", f: `Start with the ${SRC.brands_on_staples_12_n} brands already on Staples`, h: "Sellers & brands to onboard", q: "Who should supply it?",
      b: [`${SRC.brands_on_staples_12_n} brands behind our picks already sell on Staples`, "House brands: source the archetype, not the brand", "Rank independent sellers by fit & performance"], d: "Seller data · competitor sellers", o: "A recruit list per archetype" },
  ];
  // ======================= 1. EXECUTIVE SUMMARY =======================
  pres.addSection({ title: "Summary" });
  s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Summary" });
  s.addText("Executive Summary", { placeholder: "title" });
  // band 1a: the ask
  box(s, 0.45, 1.2, 12.43, 0.52, C.navy, { r: 0.08 });
  text(s, "THE ASK", 0.6, 1.2, 1.0, 0.52, { fontSize: 12, bold: true, color: C.orange, valign: "middle", charSpacing: 1 });
  text(s, "Which design-led, core-adjacent products can Staples add to its marketplace without cannibalising 1P sales, using only external data?", 1.62, 1.2, 11.15, 0.52, { fontSize: 12.5, color: C.white, valign: "middle" });
  // band 1b: funnel tiles
  const tiles = [
    [String(T.nodes_scored), "Staples nodes across 3 segments, vs Amazon & Wayfair"],
    [k1(T.families_all), `product families analysed: ${k1(T.staples_families)} Staples, ${k1(T.competitor_families)} competitor`],
    [String(T.archetypes_built), "archetypes (attribute combinations) compared"],
    [String(T.recommended), `safe to add; ${T.tiers.Strong} confirmed by both methods`],
  ];
  const TG = 0.2, TW = (12.43 - 3 * TG) / 4;
  tiles.forEach(([v, l], i) => {
    const x = 0.45 + i * (TW + TG);
    const safe = i === 3; // "safe to add" tile highlighted in light green
    box(s, x, 1.92, TW, 1.04, safe ? "DDF3E7" : C.paler, { r: 0.1, line: safe ? "7CCB9F" : undefined, lineW: 1 });
    text(s, v, x + 0.08, 1.98, TW - 0.16, 0.46, { fontSize: 28, bold: true, color: safe ? C.strong : C.blue, align: "center", valign: "middle" });
    text(s, l, x + 0.14, 2.46, TW - 0.28, 0.44, { fontSize: 10.5, color: C.text, align: "center", valign: "top" });
  });
  // band 3: what to add first (picks a Staples merchant recognises: anchored to what Staples already sells)
  text(s, "WHAT STAPLES SHOULD ADD FIRST", 0.45, 3.2, 6, 0.28, { fontSize: 12, bold: true, color: C.blue, valign: "middle", charSpacing: 1 });
  const P = F.picks, A = F.attach;
  const recs = [
    { k: "Office Desks", pk: P["Office Desks"][0], h: "Design-led (luxe) desks", st: "office desks",
      hook: `Staples' desks are corporate-office pieces (${S.desks_corporate.st}% vs ${S.desks_corporate.co}% at Wayfair); only ${S.desks_luxe.st}% luxe vs ${S.desks_luxe.co}%` },
    { k: "Lunch Bags", pk: P["Lunch Bags"][0], h: "Adult bento boxes for the commute", st: "lunch bags",
      hook: `Lunch range built for school (${S.lunch_kids.st}% kids vs ${S.lunch_kids.co}% at Amazon); office commuters under-served` },
    { k: "Coffee Organizers", pk: P["Coffee Organizers"][0], h: "Wooden K-Cup pod drawers", st: "coffee organisers",
      hook: `Staples sells ${A.single_serve} single-serve coffees & ${A.coffee_makers} coffee makers; its organisers are ${S.coffee_plastic.st}% plastic` },
    { k: "Accent Chairs", pk: P["Accent Chairs"][1], h: "The \"White Chair\": swivel barrel chair", st: "accent chairs",
      hook: `Accent chairs built for lobbies (${S.chairs_reception.st}% reception vs ${S.chairs_reception.co}% at Wayfair); no home-office chair` },
  ];
  const RW4 = (12.43 - 3 * 0.15) / 4;
  recs.forEach((r, i) => {
    const x = 0.45 + i * (RW4 + 0.15), y = 3.54, n = N[r.k], a = r.pk.attr_check, ex = r.pk.exemplar;
    box(s, x, y, RW4, 1.84, C.white, { r: 0.1, line: C.line, shadow: true });
    circleIcon(s, ICON[NODE_ICON[r.k]], x + 0.14, y + 0.14, 0.48, C.blue);
    text(s, r.h, x + 0.72, y + 0.1, RW4 - 0.82, 0.56, { fontSize: 12.5, bold: true, color: C.navy, valign: "middle" });
    text(s, r.hook, x + 0.16, y + 0.74, RW4 - 0.3, 0.5, { fontSize: 9.5, italic: true, color: C.text, valign: "top" });
    text(s, [
      { text: "Staples: ", options: { color: C.muted } }, { text: `${a.staples_hits} of ${a.staples_total}`, options: { bold: true, color: C.staples } }, { text: " · " },
      { text: `${n.competitor}: `, options: { color: C.muted } }, { text: `${Math.round(a.comp_share)}%`, options: { bold: true, color: compColor(n.competitor) } }, { text: " of range" },
    ], x + 0.16, y + 1.26, RW4 - 0.3, 0.24, { fontSize: 10.5, color: C.text, valign: "middle" });
    text(s, [{ text: "e.g. ", options: { color: C.muted } }, { text: shortTitle(ex.title, 30) + ` · ${money0(ex.price)} ↗`, options: { hyperlink: { url: ex.url, tooltip: ex.title }, color: C.mid, underline: { style: "sng" } } }], x + 0.16, y + 1.54, RW4 - 0.3, 0.2, { fontSize: 9.5 });
  });
  // band 4: next steps = the first move in each Project Continuation step (same labels & headings as slide 6)
  text(s, "NEXT STEPS", 0.45, 5.66, 6, 0.28, { fontSize: 12, bold: true, color: C.blue, valign: "middle", charSpacing: 1 });
  const NG = 0.15, NW = (12.43 - 4 * NG) / 5;
  CONT.forEach((c, i) => {
    const x = 0.45 + i * (NW + NG), y = 6.0;
    box(s, x, y, NW, 0.88, C.pale, { r: 0.08 });
    box(s, x, y, NW, 0.38, i < 2 ? C.blue : i === 2 ? C.mid : C.navy, { r: 0.08 });
    s.addImage({ data: ICON[c.ic], x: x + 0.12, y: y + 0.08, w: 0.22, h: 0.22 });
    text(s, `${i + 1} · ${c.v}`, x + 0.44, y, NW - 0.52, 0.38, { fontSize: 10.5, bold: true, color: C.orange, valign: "middle", charSpacing: 1 });
    text(s, c.h, x + 0.12, y + 0.42, NW - 0.2, 0.42, { fontSize: 10.5, bold: true, color: C.navy, valign: "middle" });
  });
  s.addNotes(`The ask: a curated, core-adjacent ("White Chair") marketplace for Q1 2027 that does not cannibalise 1P sales, built on external data only.\nFunnel: ${T.families_all.toLocaleString("en-US")} product families (${T.staples_families.toLocaleString("en-US")} Staples, ${T.amazon_families.toLocaleString("en-US")} Amazon, ${T.wayfair_families.toLocaleString("en-US")} Wayfair; colour/size variants merged) → ${T.archetypes_built} archetypes compared → ${T.recommended} pass the safety gates (${T.tiers.Strong} Strong, ${T.tiers["Vector-led"]} Vector-led, ${T.tiers["Gap-led"]} Gap-led, ${T.tiers.Conditional || 0} Conditional) → ${T.example_products} example products, each shown beside the nearest Staples item → ${SRC.brands_on_staples_12_n} brands already selling on Staples (${SRC.brands_on_staples_12.join(", ")}).\nHow: Method 1 compares products in an embedding space (whitespace, fit with Staples, look, cannibalisation risk, price position); Method 2 compares attribute shares (share gap, price, colour, material/style, design). Each has its own cannibalisation gate; the final list is their union.\nThe four headline picks are anchored to what Staples already sells, so a merchant recognises them; each was checked against the Staples catalog: design-led (luxe) desks ${P["Office Desks"][0].attr_check.staples_hits} of ${P["Office Desks"][0].attr_check.staples_total} office desks vs ${Math.round(P["Office Desks"][0].attr_check.comp_share)}% of Wayfair's (Strong: both methods; the Hero-node pick; Staples' desks are corporate pieces at a median ${money0(N["Office Desks"].price_median_staples)} vs ${money0(N["Office Desks"].price_median_competitor)} at Wayfair, so these add the home-office look at a lower price); wooden K-Cup pod drawers ${P["Coffee Organizers"][0].attr_check.staples_hits} of ${P["Coffee Organizers"][0].attr_check.staples_total} coffee organisers (Strong: both methods; Staples sells ${A.single_serve} single-serve coffee items and ${A.coffee_makers} coffee makers); adult stainless bento ${P["Lunch Bags"][0].attr_check.staples_hits} of ${P["Lunch Bags"][0].attr_check.staples_total} lunch bags (Strong); barrel chairs ${P["Accent Chairs"][1].attr_check.staples_hits} of ${P["Accent Chairs"][1].attr_check.staples_total} accent chairs (the literal "White Chair"; Gap-led: a clear gap, but Method 1 reads most barrel chairs as off-brand for today's Staples customer, so check the fit).\nBackup picks if asked: statement / oversized wall clocks (${P.Clocks[0].attr_check.staples_hits} of ${P.Clocks[0].attr_check.staples_total} clocks vs ${Math.round(P.Clocks[0].attr_check.comp_share)}% of Wayfair's; Strong; Staples' clocks ${S.clocks_plastic.st}% plastic vs ${S.clocks_plastic.co}%, a design trade-up), folding screens under $150 (${P.Partitions[0].attr_check.staples_hits} of ${P.Partitions[0].attr_check.staples_total} partitions vs ${Math.round(P.Partitions[0].attr_check.comp_share)}% of Wayfair's; Strong), guided / daily journals (${P.Planners[1].attr_check.staples_hits} of ${P.Planners[1].attr_check.staples_total} planners vs ${Math.round(P.Planners[1].attr_check.comp_share)}% of Amazon's; Gap-led, read as off-brand by Method 1), hiking / outdoor daypacks (${P.Backpacks[0].attr_check.staples_hits} of ${P.Backpacks[0].attr_check.staples_total} vs ${Math.round(P.Backpacks[0].attr_check.comp_share)}% of Amazon's).\nIf asked about the assortments: Staples builds for the workplace (${S.chairs_reception.st}% of accent chairs are reception/lobby seats vs ${S.chairs_reception.co}% at Wayfair; ${S.partitions_tackable.st}% of partitions tackable vs ${S.partitions_tackable.co}%); Wayfair for the home (${S.chairs_residential.co}% of accent chairs for living rooms vs ${S.chairs_residential.st}%); Amazon for the person and the activity (${S.bp_hiking.co}% of backpacks hiking/outdoor vs ${S.bp_hiking.st}%). Design-forward share ${DF.staples_all}% at Staples vs ${DF.competitor_all}% at the competitors (text-based, provisional). Price: Staples desks median ${money0(N["Office Desks"].price_median_staples)} vs ${money0(N["Office Desks"].price_median_competitor)} at Wayfair; ${B.planners_u10.co}% of Amazon planners under $10 vs ${B.planners_u10.st}%.\nMore picks: ${T.recommended - 4} further archetypes, each with example products, are in the demo.\nNext steps: the five next-phase steps of slide 6 (same labels and headings), drawn from the first review's asks. First moves if asked: ${CONT.map((c, i) => `${i + 1} ${c.v[0] + c.v.slice(1).toLowerCase()}: ${c.f}`).join("; ")}.`);

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
    { text: "competitor data are scraped listing samples, not full catalogs; Staples data are close to complete." },
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

  // ======================= 4. WHAT WE HEARD =======================
  pres.addSection({ title: "Next steps" });
  s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Next steps" });
  s.addText("What We Heard → How the Engine Answers", { placeholder: "title" });
  {
    const H = (t) => ({ text: t, options: { bold: true, color: C.white, fill: { color: C.blue }, fontSize: 12.5, valign: "middle" } });
    const heard = [
      ["**Size of the prize**, stack-ranked: the ~20% of lifts that solve 80%",
        `**${T.recommended} safe picks** from ${T.archetypes_built} archetypes, ranked by final score (supply view, not demand)`,
        "Opportunity $ per archetype: velocity × conversion × AUR"],
      ["**Build the basket** for today's customers: a curated middle ground, not an everything store",
        "Picks anchored to what Staples already sells; **3–10 per node**, ≤ 4 per attribute set",
        "Basket-attach signals from customer baskets & business verticals"],
      ["**Protect the core**: no top-line erosion just to lift unit velocity",
        `Safety gates hold back the **${T.m1_sub_undercut_share}%** of competitor products that would substitute or undercut a Staples item`,
        "Merchant-set guardrails, tighter the closer to core"],
      ["**Adjacent first, core later**: hydration, travel, toys, tech accessories",
        "Hydration and travel/commute are **already in scope**: water bottles, backpacks, lunch bags",
        "Each new category is one config file: no new code"],
      ["**Staples.com vs Staples Business**: different customers, different channel",
        "Today's run benchmarks the **Staples.com** catalog",
        "Every opportunity tagged by channel and customer segment"],
      ["**Beyond internal reporting**: what can't be done with internal data alone?",
        `**${k1(T.competitor_families)} competitor families** matched attribute by attribute to Staples' ${k1(T.staples_families)}`,
        "A repeatable engine and a phased plan"],
    ];
    const rows = [[H("What we heard"), H("What the PoC already gives"), H("What the next phase adds")]];
    heard.forEach((r, i) => {
      const f = i % 2 ? C.paler : C.white;
      rows.push([
        { text: runs(r[0], { fontSize: 11.5, color: C.text }, C.navy), options: { fill: { color: f }, valign: "middle" } },
        { text: runs(r[1], { fontSize: 11, color: C.text }, C.blue), options: { fill: { color: f }, valign: "middle" } },
        { text: r[2], options: { fontSize: 11, bold: true, color: C.mid, fill: { color: f }, valign: "middle" } },
      ]);
    });
    s.addTable(rows, { x: 0.45, y: 1.25, w: 12.43, colW: [4.35, 4.48, 3.6], rowH: [0.42, ...Array(heard.length).fill(0.76)], fontFace: FONT, border: { type: "solid", pt: 0.75, color: C.line }, margin: [0.04, 0.12, 0.04, 0.12] });
    box(s, 0.45, 6.38, 12.43, 0.52, C.navy, { r: 0.08 });
    text(s, "AGREED START", 0.62, 6.38, 1.7, 0.52, { fontSize: 12, bold: true, color: C.orange, valign: "middle", charSpacing: 1 });
    text(s, "Acquire the product first: build the basket for existing Staples customers, start adjacent, scale on evidence after launch.", 2.3, 6.38, 10.45, 0.52, { fontSize: 12.5, color: C.white, valign: "middle" });
  }
  s.addNotes(`What we heard in the first review, and how the engine answers each point. Read the left column in their words, then the PoC evidence, then what the next phase adds.\n1 Size of the prize: the PoC ranks ${T.recommended} safe picks out of ${T.archetypes_built} archetypes, but it measures assortment supply, not demand. The next phase turns each pick into opportunity dollars (slide 6) and stack-ranks to the vital ~20%.\n2 Build the basket: every headline pick is anchored to something Staples already sells (desks, lunch bags, coffee, chairs); the final gate caps picks at 3–10 per node, so the output is curated by design.\n3 Protect the core: Method 1 labels ${T.m1_sub_undercut.toLocaleString("en-US")} of ${T.m1_products.toLocaleString("en-US")} competitor products (${T.m1_sub_undercut_share}%) as substitutes or undercuts of a Staples item; they are never recommended. Next, merchants set the limits per category zone (slide 8).\n4 Adjacent first: hydration (water bottles) and travel/commute (backpacks, lunch bags) are already 3 of our 12 nodes; toys, luggage and tech accessories are a config entry each.\n5 Channel: today's benchmark is the Staples.com catalog; Staples Business needs its own customer and fulfilment lens.\n6 Incremental value: internal data cannot show what Staples does not carry; we bring the competitor side, measured with the same attribute instrument (slide 9).`);

  // ======================= 5. SIZE OF THE PRIZE (next-phase steps) =======================
  s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Next steps" });
  s.addText("From Assortment Gaps to Size of the Prize", { placeholder: "title" });
  box(s, 0.45, 1.18, 12.43, 0.38, C.paler, { r: 0.08 });
  text(s, runs("Today's gap list, turned into **opportunity dollars**, inside **merchant guardrails**, for the **right channel and owner**.", { fontSize: 11.5, color: C.text }, C.navy), 0.6, 1.18, 12.13, 0.38, { align: "center", valign: "middle" });
  const CG = 0.26, CW5 = (12.43 - 4 * CG) / 5, HY5 = 1.72, BY5 = 2.56, BH5 = 3.72;
  CONT.forEach((c, i) => {
    const x = 0.45 + i * (CW5 + CG);
    box(s, x, HY5, CW5, 0.78, i < 2 ? C.blue : i === 2 ? C.mid : C.navy, { r: 0.08 });
    s.addImage({ data: ICON[c.ic], x: x + 0.12, y: HY5 + 0.2, w: 0.38, h: 0.38 });
    text(s, `${i + 1} · ${c.v}`, x + 0.6, HY5 + 0.06, CW5 - 0.68, 0.24, { fontSize: 10.5, bold: true, color: C.orange, charSpacing: 1 });
    text(s, c.h, x + 0.6, HY5 + 0.3, CW5 - 0.68, 0.44, { fontSize: 11, bold: true, color: C.white, valign: "middle" });
    box(s, x, BY5, CW5, BH5, C.white, { r: 0.08, line: C.line });
    text(s, c.q, x + 0.12, BY5 + 0.08, CW5 - 0.24, 0.42, { fontSize: 10, italic: true, bold: true, color: C.mid, valign: "middle" });
    text(s, c.b.map((t, k) => ({ text: t, options: { bullet: { indent: 9 }, breakLine: k < c.b.length - 1 } })), x + 0.1, BY5 + 0.56, CW5 - 0.18, 1.6, { fontSize: 10, color: C.text, paraSpaceAfter: 3 });
    box(s, x + 0.08, BY5 + 2.2, CW5 - 0.16, 0.62, C.paler, { r: 0.06 });
    text(s, "STAPLES DATA", x + 0.16, BY5 + 2.25, CW5 - 0.3, 0.18, { fontSize: 7.5, bold: true, color: C.orange, charSpacing: 1 });
    text(s, c.d, x + 0.16, BY5 + 2.42, CW5 - 0.3, 0.38, { fontSize: 9.5, bold: true, color: C.mid });
    box(s, x + 0.08, BY5 + 2.9, CW5 - 0.16, 0.74, C.pale, { r: 0.06 });
    text(s, "OUTCOME", x + 0.16, BY5 + 2.95, CW5 - 0.3, 0.18, { fontSize: 7.5, bold: true, color: C.orange, charSpacing: 1 });
    text(s, c.o, x + 0.16, BY5 + 3.12, CW5 - 0.3, 0.48, { fontSize: 10.5, bold: true, color: C.navy });
  });
  // worked example strip: the backpacks case raised in the review (no dollar value invented)
  const BP = F.picks.Backpacks[0], BPA = BP.attr_check;
  {
    const y = 6.4, h = 0.6;
    box(s, 0.45, y, 12.43, h, C.navy, { r: 0.08 });
    text(s, [{ text: "WORKED EXAMPLE", options: { bold: true, color: C.orange, charSpacing: 1, breakLine: true } }, { text: "hiking / outdoor backpacks", options: { color: C.white, bold: true } }], 0.6, y, 2.05, h, { fontSize: 10, valign: "middle" });
    const parts = [
      { t: `Gap: ${Math.round(BPA.comp_share)}% at Amazon vs ${BPA.staples_hits} of ${BPA.staples_total} at Staples`, s: "PoC today", hot: true, w: 2.75 },
      { t: "Staples backpack velocity", s: "Staples data", w: 1.6 },
      { t: "Expected conversion", s: "Staples data", w: 1.45 },
      { t: `AUR (start: Amazon median ${money0(BP.median_price_competitor)})`, s: "modelled", w: 1.85 },
      { t: "Opportunity $", s: "rank, keep the top 20%", w: 1.5, end: true },
    ];
    let px = 2.72;
    parts.forEach((p, i) => {
      box(s, px, y + 0.08, p.w, h - 0.16, p.hot ? C.orange : p.end ? C.strong : C.blue, { r: 0.06 });
      text(s, [{ text: p.t, options: { bold: true, color: p.hot ? C.navy : C.white, breakLine: true } }, { text: p.s, options: { fontSize: 8, italic: true, color: p.hot ? C.navy : "CADCFC" } }], px + 0.06, y + 0.08, p.w - 0.12, h - 0.16, { fontSize: 9.5, align: "center", valign: "middle" });
      px += p.w;
      if (i < parts.length - 1) { text(s, i === parts.length - 2 ? "=" : "×", px, y, 0.18, h, { fontSize: 16, bold: true, color: C.white, align: "center", valign: "middle" }); px += 0.18; }
    });
  }
  s.addNotes(`Size of the prize: the next phase turns today's supply-side gap list into a demand-backed, dollar-ranked shortlist, built on the asks from the first review.\n1 Size: competitor activity scaled to Staples velocity, times expected conversion and a modelled average unit retail, gives opportunity dollars per archetype; stack-rank and keep the ~20% of lifts that solve 80% of the problem.\n2 Sense: null-search counts alone mislead because redirects hide unmet demand, so trace the funnel: search → product page → need met → conversion, and map each break point to an archetype.\n3 Guard: the PoC already screens cannibalisation on supply (${T.m1_sub_undercut_share}% of competitor products held back). With Staples data, merchants set tighter cannibalisation, price and margin limits near core and freer rules in adjacent categories (slide 8); the first move is a calibration session on ~60 side-by-side pairs.\n4 Target: split every opportunity by channel (Staples.com for SMB and consumers first; Staples Business later) and package it as a story for the merchant who owns the category (e.g. furniture, consumer electronics).\n5 Recruit: ${SRC.brands_on_staples_12_n} brands behind our picks already sell on Staples (${SRC.brands_on_staples_12.join(", ")}): quick wins. Wayfair's range is mostly house brands, so source the archetype, not the brand; rank independent competitor sellers by fit and performance.\nWorked example (the backpacks case from the review): ${Math.round(BPA.comp_share)}% of Amazon's backpacks are hiking/outdoor vs ${BPA.staples_hits} of ${BPA.staples_total} at Staples. The gap is known today; velocity, conversion and AUR come from Staples data, so no dollar figure is shown yet.`);

  // ======================= 6. GROWTH PATHS (option A) =======================
  s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Next steps" });
  s.addText("Growth Paths for the Marketplace", { placeholder: "title" });
  box(s, 0.45, 1.18, 12.43, 0.38, C.paler, { r: 0.08 });
  text(s, runs("Six paths, each answering a question raised in our first review: **sense** the demand, **size** it, then **act and learn**.", { fontSize: 11.5, color: C.text }, C.navy), 0.6, 1.18, 12.13, 0.38, { align: "center", valign: "middle" });
  const ALT = [
    { t: "SENSE demand", fill: C.blue, cards: [
      { ic: "srch", h: "Search-funnel signals", q: "Where do shoppers look, and leave?",
        b: ["Null & poor searches, incl. hidden redirects", "Trace search → PDP → need met → conversion", "Map each break point to an archetype"], d: "Search logs · funnel data", o: "Unmet demand, evidenced" },
      { ic: "basket", h: "Customer basket & vertical intelligence", q: "What is missing from today's baskets?",
        b: ["Profile top customers and their business verticals", "Find complements missing from their baskets", "Staples.com vs Staples Business, kept apart"], d: "Transactions · customer segments", o: "Bigger baskets for existing customers" },
    ] },
    { t: "SIZE & PRIORITISE", fill: C.mid, cards: [
      { ic: "dollar", h: "Size of the prize", q: "Which gaps are worth the most?",
        b: ["Competitor activity scaled to Staples velocity", "Times expected conversion & modelled AUR", "Stack-rank to the ~20% that solve 80%"], d: "Sales · conversion · price", o: "A $-ranked opportunity landscape" },
      { ic: "hand", h: "Sellers & brands to recruit", q: "Who should supply each gap?",
        b: [`Start with the ${SRC.brands_on_staples_12_n} brands already on Staples`, "Top competitor sellers Staples doesn't carry", "House brands: source the archetype instead"], d: "Seller data + competitor crawls", o: "A recruit list per archetype" },
    ] },
    { t: "ACT & LEARN", fill: C.navy, cards: [
      { ic: "rocket", h: "Adjacent launch & learn", q: "Which adjacent categories first?",
        b: ["Toys, hydration, travel & luggage, tech accessories", "Signals pick the subcategories, not the whole aisle", "Launch, measure, then scale what works"], d: "Search · sales after launch", o: "A confident first assortment" },
      { ic: "brief", h: "Category stories per merchant", q: "Who acts on it?",
        b: ["One story per category owner (furniture, CE…)", "Core gaps shared with merchants, not around them", "Same engine, refreshed by monthly re-crawls"], d: "Category ownership · channel", o: "Decisions owners sign up to" },
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
  s.addNotes(`Option A (same layout as the V11 growth-paths slide, cards re-aimed at the review's asks; keep this or slide 8, not both). Read left to right: sense the demand, size it, then act and learn.\n- Search-funnel signals: null search alone is not enough because redirects can hide unmet demand; trace whether shoppers reach a product page, whether it meets the need, and where conversion breaks.\n- Customer basket & vertical intelligence: top customers, their business verticals and what they already buy show which complements are missing; Staples.com and Staples Business are analysed separately.\n- Size of the prize: competitor activity scaled to Staples velocity, times conversion and a modelled AUR, stack-ranked to the vital ~20%.\n- Sellers & brands: ${SRC.brands_on_staples_12_n} brands behind our picks already sell on Staples; for Wayfair's house brands we source the archetype; independent competitor sellers ranked by fit and performance.\n- Adjacent launch & learn: toys (e.g. waiting-room rewards), hydration, travel and luggage, tech accessories; data picks the subcategories so the first load is confident, not every item.\n- Category stories: one story per merchant owner, so core-category gaps are raised with the merchant, not around them.`);

  // ======================= 7. WHERE TO PLAY (option B) =======================
  s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Next steps" });
  s.addText("Where to Play: Core vs Adjacent Guardrails", { placeholder: "title" });
  {
    const ZONES = [
      { t: "CORE OFFICE", seq: "LATER", fill: C.navy, ink: C.white, stance: "Protect the top line",
        b: ["Strict cannibalisation, price & margin floors", "Gaps raised with the category merchant", "Narrow, high-confidence adds only"],
        nodes: ["Office Desks", "Planners", "Desk Organizers", "Desk Pads", "Partitions"], ex: "e.g. luxe or smaller desks (under 40\")" },
      { t: "NEAR-CORE", seq: "NEXT", fill: C.mid, ink: C.white, stance: "Build the basket",
        b: ["Design-led looks Staples lacks today", "Capped picks per node and per attribute set", "Basket fit for existing customers"],
        nodes: ["Accent Chairs", "Desk Lamps", "Coffee Organizers", "Lunch Bags", "Clocks"], ex: "e.g. commuter bento, K-Cup drawers, barrel chair" },
      { t: "ADJACENT", seq: "FIRST", fill: C.sky, ink: C.navy, stance: "Grow & learn",
        b: ["Broader adds; signals choose the subcategories", "Launch, measure, then scale", "Low 1P overlap, so lighter gates"],
        nodes: ["Water Bottles", "Backpacks"], next: "Next: toys · luggage · tech accessories", ex: "e.g. hiking daypacks, hydration" },
    ];
    const ZG = 0.26, ZW = (12.43 - 2 * ZG) / 3, ZY = 1.88;
    box(s, 0.45, 1.2, 12.43, 0.5, C.paler, { r: 0.08 });
    text(s, runs("Closer to core → **less appetite to broaden**. Same gap, different action, depending on **proximity, customer and channel**.", { fontSize: 11.5, color: C.text }, C.navy), 0.6, 1.2, 12.13, 0.5, { align: "center", valign: "middle" });
    ZONES.forEach((z, i) => {
      const x = 0.45 + i * (ZW + ZG);
      box(s, x, ZY, ZW, 0.6, z.fill, { r: 0.08 });
      text(s, z.t, x + 0.18, ZY, ZW - 1.5, 0.6, { fontSize: 14, bold: true, color: z.ink, valign: "middle", charSpacing: 1 });
      chip(s, `START ${z.seq}`, x + ZW - 1.38, ZY + 0.15, 1.24, 0.3, C.orange, C.navy, 9);
      if (i < ZONES.length - 1) arrow(s, x + ZW + 0.04, ZY + 0.16, 0.18, 0.28);
      const by = ZY + 0.7;
      box(s, x, by, ZW, 3.62, C.white, { r: 0.08, line: C.line, shadow: true });
      text(s, z.stance, x + 0.18, by + 0.1, ZW - 0.36, 0.34, { fontSize: 14, bold: true, color: C.navy, valign: "middle" });
      text(s, z.b.map((t, k) => ({ text: t, options: { bullet: { indent: 10 }, breakLine: k < z.b.length - 1 } })), x + 0.14, by + 0.5, ZW - 0.3, 0.9, { fontSize: 10.5, color: C.text, paraSpaceAfter: 3 });
      box(s, x + 0.1, by + 1.5, ZW - 0.2, 1.62, C.paler, { r: 0.06 });
      const recN = z.nodes.reduce((a, k) => a + N[k].recommended, 0);
      text(s, `POC NODES (DRAFT) · ${recN} PICKS`, x + 0.2, by + 1.56, ZW - 0.4, 0.2, { fontSize: 8, bold: true, color: C.orange, charSpacing: 1 });
      z.nodes.forEach((k, j) => {
        const cx = x + 0.2 + (j % 2) * ((ZW - 0.4) / 2), cy = by + 1.84 + Math.floor(j / 2) * 0.36;
        circleIcon(s, ICON[NODE_ICON[k]], cx, cy, 0.28, z.fill === C.sky ? C.mid : z.fill);
        text(s, `${k} (${N[k].recommended})`, cx + 0.34, cy, (ZW - 0.4) / 2 - 0.36, 0.28, { fontSize: 9.5, color: C.text, valign: "middle" });
      });
      if (z.next) text(s, z.next, x + 0.2, by + 2.62, ZW - 0.4, 0.4, { fontSize: 10, bold: true, color: C.mid, valign: "middle" });
      text(s, z.ex, x + 0.18, by + 3.2, ZW - 0.36, 0.34, { fontSize: 10.5, italic: true, color: C.mid, valign: "middle" });
    });
    box(s, 0.45, 6.32, 12.43, 0.58, C.navy, { r: 0.08 });
    text(s, "TO AGREE", 0.62, 6.32, 1.3, 0.58, { fontSize: 12, bold: true, color: C.orange, valign: "middle", charSpacing: 1 });
    text(s, "Zones are our draft. Merchants set the zone of each category and its limits; the engine applies them on every run, for Staples.com first and Staples Business later.", 1.9, 6.32, 10.85, 0.58, { fontSize: 11.5, color: C.white, valign: "middle" });
  }
  s.addNotes(`Option B (new; keep this or slide 7, not both). The review's point: the closer a category is to Staples' core office business, the less appetite to fragment the assortment; far from core, Staples can add more to grow and learn. The same gap can therefore mean different actions.\nThe zones are OUR DRAFT for merchants to correct; the counts are the PoC's recommended archetypes per node.\n- Core office (start later): desks, planners, desk organizers, desk pads, partitions. Strict cannibalisation, price and margin floors; gaps such as luxe or smaller desks (Wayfair's range is ${S.desks_luxe.co}% luxe vs ${S.desks_luxe.st}% at Staples) go to the merchant as a conversation, not a list.\n- Near-core (next): chairs, lamps, coffee organizers, lunch bags, clocks. Design-led looks that build today's basket.\n- Adjacent (start first): water bottles (hydration) and backpacks (travel/commute) are already in scope; toys, luggage and tech accessories are the next config entries.\nThe engine already has the hooks: safety gates per method and a final gate per node; merchant rules become parameters per zone.`);

  // ======================= 8. PHASED PLAN & INCREMENTAL VALUE =======================
  s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Next steps" });
  s.addText("Phased Plan, and Why It Is More Than a Copilot Query", { placeholder: "title" });
  {
    const PH = [
      { t: "LAUNCH STORIES", ic: "brief", fill: C.blue, b: ["Guardrailed shortlist for the first Marketplace load", "One category story per merchant owner", "Built on today's PoC + merchant rules"], o: "A confident initial assortment" },
      { t: "SIZE THE PRIZE", ic: "dollar", fill: C.mid, b: ["Join sales, search funnel, conversion & baskets", "Opportunity $ per archetype, by channel", "Stack-rank to the vital ~20%"], o: "A $-ranked opportunity landscape" },
      { t: "LAUNCH, LEARN & SCALE", ic: "rocket", fill: C.navy, b: ["Track live performance per archetype", "Expand adjacent categories on evidence", "Vet seller listings; monthly re-crawls"], o: "Scale what works, drop what doesn't" },
    ];
    const LX = 0.45, LW = 7.5, PG = 0.2, PW = (LW - 2 * PG) / 3, PY = 1.25;
    text(s, "PHASED SUPPORT: ADAPTS TO STAPLES' ROADMAP", LX, PY, LW, 0.3, { fontSize: 12, bold: true, color: C.blue, valign: "middle", charSpacing: 1 });
    PH.forEach((p, i) => {
      const x = LX + i * (PW + PG), y = PY + 0.42;
      box(s, x, y, PW, 0.95, p.fill, { r: 0.08 });
      s.addImage({ data: ICON[p.ic], x: x + 0.14, y: y + 0.14, w: 0.34, h: 0.34 });
      text(s, `PHASE ${i + 1}`, x + 0.6, y + 0.1, PW - 0.7, 0.3, { fontSize: 10, bold: true, color: C.orange, charSpacing: 1, valign: "middle" });
      text(s, p.t, x + 0.14, y + 0.52, PW - 0.28, 0.36, { fontSize: 12.5, bold: true, color: C.white, valign: "middle" });
      if (i < PH.length - 1) arrow(s, x + PW + 0.01, y + 0.33, 0.18, 0.28);
      box(s, x, y + 1.05, PW, 2.55, C.white, { r: 0.08, line: C.line, shadow: true });
      text(s, p.b.map((t, k) => ({ text: t, options: { bullet: { indent: 10 }, breakLine: k < p.b.length - 1 } })), x + 0.12, y + 1.17, PW - 0.24, 1.55, { fontSize: 11.5, color: C.text, paraSpaceAfter: 6 });
      box(s, x + 0.08, y + 2.8, PW - 0.16, 0.72, C.pale, { r: 0.06 });
      text(s, "OUTCOME", x + 0.16, y + 2.85, PW - 0.3, 0.18, { fontSize: 7.5, bold: true, color: C.orange, charSpacing: 1 });
      text(s, p.o, x + 0.16, y + 3.03, PW - 0.3, 0.44, { fontSize: 11, bold: true, color: C.navy, valign: "middle" });
    });
    const RX = LX + LW + 0.3, RW = 12.88 - RX;
    box(s, RX, PY, RW, 5.65, C.navy, { r: 0.1 });
    text(s, "WHAT INTERNAL DATA ALONE CAN'T DO", RX + 0.22, PY + 0.12, RW - 0.44, 0.34, { fontSize: 12, bold: true, color: C.orange, valign: "middle", charSpacing: 1 });
    const DIF = [
      ["globe", "Sees outside Staples", `Competitor assortment (${k1(T.competitor_families)} families today): internal data can't show what Staples doesn't carry`],
      ["layersW", "Same yardstick on both sides", `${T.archetypes_built} archetypes from one attribute extractor run on Staples and competitors`],
      ["shieldW", "Cannibalisation-safe by design", `Two independent methods, each with its own safety gate; ${T.recommended} picks survive`],
      ["cogs", "A repeatable engine", "New node or competitor = config; re-run monthly as markets move"],
    ];
    DIF.forEach(([ic, h, d], i) => {
      const y = PY + 0.62 + i * 1.22;
      circleIcon(s, ICON[ic], RX + 0.22, y + 0.04, 0.5, C.mid);
      text(s, h, RX + 0.86, y, RW - 1.06, 0.32, { fontSize: 12.5, bold: true, color: C.white, valign: "middle" });
      text(s, d, RX + 0.86, y + 0.34, RW - 1.06, 0.7, { fontSize: 10.5, color: "CADCFC", valign: "top" });
    });
    box(s, LX, 5.4, LW, 1.5, C.paler, { r: 0.08 });
    text(s, [
      { text: "TWO WORKSTREAMS", options: { bold: true, color: C.orange, charSpacing: 1, fontSize: 10, breakLine: true } },
      { text: "1 · Acquire the product ", options: { bold: true, color: C.navy } }, { text: "(assortment, brands, sellers): where this engine works, and first.", options: { breakLine: true } },
      { text: "2 · Educate & acquire the customer ", options: { bold: true, color: C.navy } }, { text: "(digital experience, off-site retail media): once the product is live." },
    ], LX + 0.18, 5.48, LW - 0.36, 1.34, { fontSize: 11, color: C.text, valign: "middle", paraSpaceAfter: 4 });
  }
  s.addNotes(`Phased plan: LatentView supports phase by phase and adapts to Staples' roadmap rather than a fixed path, using Staples' existing data and tools and adding external data where it helps.\nPhase 1 Launch stories: a guardrailed shortlist for the first Marketplace load, packaged as a story per category owner (built on today's PoC plus the merchant rules).\nPhase 2 Size the prize: internal sales, search funnel, conversion, satisfaction and basket data turn gaps into opportunity dollars by channel.\nPhase 3 Launch, learn & scale: no Marketplace item is live yet, so after launch the actual performance decides where to expand.\nWhy more than a Copilot query on internal data: (1) the competitor side is external, internal tools can't see what Staples doesn't carry; (2) both sides are measured with one attribute instrument, so ${T.archetypes_built} archetypes are like-for-like; (3) cannibalisation is screened twice, independently; (4) it is an engine, re-runnable for any node or competitor.\nTwo workstreams (from the review): acquiring the product comes first; customer education and acquisition follow once the product is available.`);

  // ======================= 6. SOLUTION ARCHITECTURE =======================
  pres.addSection({ title: "Appendix" });
  s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Appendix" });
  s.addText("Solution Architecture: From Listings to Safe Recommendations", { placeholder: "title" });
  const stages = [
    { t: "Data Acquisition", w: 1.9, items: [["dbS", "Staples.com", `${SKUS.staples} SKUs · 12 nodes`], ["dbA", "Amazon", `${SKUS.amazon} SKUs · 7 nodes`], ["dbW", "Wayfair", `${SKUS.wayfair} SKUs · 5 nodes`]] },
    { t: "Prep & Mapping", w: 2.05, items: [["filter", "Clean & de-identify", "prices, text fixes, PII removed"], ["layer", "Product families", "colour / size variants merged"], ["sitemap", "Node mapping", "k-NN classifier"]] },
    { t: "Attributes & Archetypes", w: 2.3, items: [["tags", "3-tier attributes", "function · look · lifestyle, same extractor on both sides"], ["proj", "Neutral product embeddings", "extracted attributes only (no title, price or brand), bge-base"], ["puzzle", "Archetypes", "4–6-attribute combinations, up to 3 sets per node"]] },
    { t: "Two Scoring Methods", w: 2.76, methods: true },
    { t: "Gates & Picks", w: 1.9, items: [["shield", "Safety gates", "common → per method → final"], ["check", "Final list", "union of both methods, 3–10 per node"], ["storeB", "Products & sellers", "each beside its nearest Staples item"]] },
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
  s.addNotes("End-to-end flow. Prep & mapping: ingest and clean the three sources (PII from Wayfair reviews removed), merge colour/size variants into product families, map each competitor product to the right Staples node with a k-NN classifier over all Staples nodes. Attributes & archetypes: read every product's full text with the same extractor on both sides into 3 tiers of attributes; build archetypes as combinations of 4–6 attributes (no price). Neutral product embeddings: each product becomes a card of its extracted attributes only (same template on both sides, no title, price or brand, so neither retailer's copy style separates them), embedded with bge-base; it powers Method 1, the clustering cross-check and the nearest-Staples match for every example product. Method 1 in embedding space (whitespace, fit with Staples, aesthetic difference, cannibalisation risk, price position) gives VOS. Method 2 on attribute shares (share gap, price, colour, material/style, design) gives TG, with its own attribute cannibalisation check (ACR). Gates: each method has its own safety gate; the final gate takes the union and tiers it. Picks: example products safe under the recommending method, each shown next to the nearest Staples product, plus brand and seller notes.");

  // ======================= 7. METHOD 1 FRAMEWORK =======================
  s = pres.addSlide({ masterName: "CONTENT", sectionTitle: "Appendix" });
  s.addText("Method 1 (Vector View): Framework", { placeholder: "title" });
  {
    const M = F.m1, OK = ["D5F0E6", "5CC49A"], HOLD = ["FCEBCB", "E8B44A"], NO = ["E6E3FA", "A99BEA"];
    const g = 0.06, X0 = 1.75, W1 = 2.2, W2 = 2.6, W3 = 2.2, Y0 = 1.68, RH = 0.74, TOP = 4 * RH + 3 * g, BH = 0.86;
    const X2 = X0 + W1 + g, X3 = X2 + W2 + g, XE = X3 + W3;
    const cell = (x, y, w, h, [f, l], t, sub) => {
      box(s, x, y, w, h, f, { r: 0.08, line: l, lineW: 1 });
      text(s, [{ text: t, options: { bold: true, fontSize: 12, color: C.navy, breakLine: true } }, { text: sub, options: { fontSize: 9, color: C.text } }], x + 0.05, y, w - 0.1, h, { align: "center", valign: "middle" });
    };
    // column headers (CRS bands)
    [[X0, W1, `CRS < ${M.crs_low}`], [X2, W2, `${M.crs_low} ≤ CRS < ${M.crs_high}`], [X3, W3, `CRS ≥ ${M.crs_high}`]].forEach(([x, w, t]) =>
      text(s, t, x, 1.3, w, 0.3, { fontSize: 11, bold: true, color: C.mid, align: "center", valign: "middle" }));
    // column 1: low CRS
    const H2 = (TOP - g) / 2;
    cell(X0, Y0, W1, H2, OK, "CURATE", "true whitespace · approve");
    cell(X0, Y0 + H2 + g, W1, H2, HOLD, "EDGE", "weaker fit · hold for phase 2");
    // column 2: middle CRS
    cell(X2, Y0, W2, RH, OK, "LEAN-APPROVE", `AD ≥ ${M.ad_threshold} (clearly different look) · approve, flag`);
    cell(X2, Y0 + RH + g, W2, TOP - RH - g, HOLD, "REVIEW", "undecided · calibration queue");
    // column 3: high CRS, checked top-down
    [[NO, "1 · UNDERCUT", `PPR < ${M.ppr_undercut}× · hard reject`], [OK, "2 · TRADE-UP", `PPR ≥ ${M.ppr_tradeup}× + design/material upgrade`],
     [OK, "3 · STYLE-EXTENSION", `AD ≥ ${M.ad_threshold}: new colour/material/style`], [NO, "4 · SUBSTITUTE", "otherwise: same job, same look · reject"]]
      .forEach(([c, t, sub], j) => cell(X3, Y0 + j * (RH + g), W3, RH, c, t, sub));
    // bottom row: low AAS
    const YB = Y0 + TOP + g;
    cell(X0, YB, XE - X0, BH, NO, "OFF-BRAND", "poor fit with Staples' catalog and customers · reject (checked before CRS)");
    // AAS row labels + axis titles
    [[Y0, H2, `≥ T_high\n(${M.t_high})`], [Y0 + H2 + g, H2, "T_low–T_high"], [YB, BH, `< T_low\n(${M.t_low})`]].forEach(([y, h, t]) =>
      text(s, t, 0.72, y, X0 - 0.8, h, { fontSize: 10, color: C.muted, align: "right", valign: "middle" }));
    text(s, "AAS (Adjacency Affinity Score): fit with Staples →", 0.4, Y0, 0.36, YB + BH - Y0, { fontSize: 10.5, bold: true, color: C.navy, align: "center", valign: "middle", vert: "vert270" });
    text(s, "CRS (Cannibalisation Risk Score): functional closeness to a Staples product →", X0, YB + BH + 0.08, XE - X0, 0.3, { fontSize: 10.5, bold: true, color: C.navy, align: "center", valign: "middle" });
    // legend
    const LY = YB + BH + 0.48;
    [[OK, "approve (safe)"], [HOLD, "hold / undecided"], [NO, "reject"]].forEach(([[f, l], t], j) => {
      const x = X0 + j * 1.75;
      box(s, x, LY + 0.04, 0.18, 0.18, f, { r: 0.03, line: l, lineW: 1 });
      text(s, t, x + 0.26, LY, 1.45, 0.26, { fontSize: 9.5, color: C.text, valign: "middle" });
    });
    text(s, "EXCLUDE (identical to a Staples product) is checked first.", X0 + 4.1, LY, XE - X0 - 4.1, 0.26, { fontSize: 9.5, italic: true, color: C.muted, align: "right", valign: "middle" });
    // key terms
    const KX = 9.45, KW = 12.88 - KX;
    text(s, "KEY TERMS", KX, 1.3, KW, 0.3, { fontSize: 12, bold: true, color: C.blue, valign: "middle", charSpacing: 1 });
    const TERMS = [
      ["AAS", "Adjacency Affinity Score", "how well the product fits Staples' catalog and customers"],
      ["CRS", "Cannibalisation Risk Score", "how close it is in function to a Staples product (0–100); higher = more likely to take 1P sales"],
      ["PPR", "Price Position Ratio", "its price ÷ the median price of the nearest Staples products"],
      ["AD", "Aesthetic Delta", "look difference from the nearest Staples product (colour, material, style)"],
    ];
    const KG = 0.08, VH = 0.7, KH = (YB + BH - Y0 - VH - 4 * KG) / 4; // term cards + VOS box end level with the map
    TERMS.forEach(([ab, full, d], j) => {
      const y = Y0 + j * (KH + KG);
      box(s, KX, y, KW, KH, C.paler, { r: 0.08 });
      text(s, [{ text: ab, options: { bold: true, color: C.blue, fontSize: 13 } }, { text: `  (${full})`, options: { bold: true, color: C.navy, fontSize: 10.5 } }], KX + 0.14, y + 0.06, KW - 0.28, 0.28, { valign: "middle" });
      text(s, d, KX + 0.14, y + 0.36, KW - 0.28, KH - 0.4, { fontSize: 9.5, color: C.text, valign: "top" });
    });
    const VY = Y0 + 4 * (KH + KG);
    box(s, KX, VY, KW, YB + BH - VY, C.navy, { r: 0.08 });
    text(s, [{ text: "Green labels = safe for Method 1. ", options: { bold: true, color: C.orange } }, { text: "They are ranked by VOS (Vector Opportunity Score) and joined with Method 2's picks at the final gate.", options: { color: C.white } }], KX + 0.14, VY, KW - 0.28, YB + BH - VY, { fontSize: 10, valign: "middle" });
  }
  s.addNotes(`Method 1 decision map: every competitor product gets one label. First EXCLUDE (identical to a Staples product), then OFF-BRAND (AAS below T_low: poor fit with Staples' catalog and customers), then the CRS band decides. Low CRS (< ${F.m1.crs_low}): CURATE if AAS ≥ T_high (true whitespace), else EDGE (hold for phase 2). Middle CRS: LEAN-APPROVE if the look is clearly different (AD ≥ ${F.m1.ad_threshold}) and the fit is strong, else REVIEW (merchant calibration queue). High CRS (≥ ${F.m1.crs_high}), top-down: UNDERCUT (PPR < ${F.m1.ppr_undercut}×, hard reject), TRADE-UP (PPR ≥ ${F.m1.ppr_tradeup}× with a design or material upgrade), STYLE-EXTENSION (AD ≥ ${F.m1.ad_threshold}), otherwise SUBSTITUTE (same job, same look, reject).\nT_low / T_high are set from Staples' own AAS per L2 group (ranges ${F.m1.t_low} and ${F.m1.t_high}); all cut-offs are provisional until the merchant calibration session (slide 5, step 2 Protect).`);

  // ======================= 8. THANK YOU =======================
  pres.addSection({ title: "Close" });
  s = pres.addSlide({ masterName: "DARK", sectionTitle: "Close" });
  text(s, "Thank You", 0.7, 2.6, 8, 1.0, { fontSize: 48, bold: true, color: C.white });
  s.addShape("rect", { x: 0.72, y: 3.68, w: 1.2, h: 0.06, fill: { color: C.orange }, line: { color: C.orange, width: 0 } });
  text(s, "Questions & discussion", 0.7, 3.85, 8, 0.5, { fontSize: 22, color: "CADCFC" });
  text(s, "LatentView Analytics  ·  October 2026", 0.7, 6.25, 7, 0.35, { fontSize: 14, color: "CADCFC" });
  s.addNotes("Close. Next steps are on the executive summary and in detail on slides 5–9 (what we heard, size of the prize, where to play, phased plan).");

  await pres.writeFile({ fileName: OUT });
  console.log("wrote", OUT);
})();
