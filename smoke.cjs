/* smoke.cjs — jsdomでindex.html+engine.js+app.jsを実際に動かすブラウザ相当テスト（開発用） */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const dir = __dirname;
const html = fs.readFileSync(path.join(dir, "index.html"), "utf8");
const pricesJSON = fs.readFileSync(path.join(dir, "data", "prices.json"), "utf8");
const NSTOCK = Object.keys(JSON.parse(pricesJSON).stocks).length;  // 収録銘柄数（動的）

const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url: "http://localhost/" });
const { window } = dom;
const { document } = window;

// --- スタブ ---
window.fetch = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(JSON.parse(pricesJSON)) });
window.Chart = class { constructor(ctx, cfg) { this.data = cfg.data; this.options = cfg.options; } update() {} destroy() {} };
window.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
window.cancelAnimationFrame = (id) => clearTimeout(id);

// --- スクリプト注入（window文脈でeval）---
window.eval(fs.readFileSync(path.join(dir, "engine.js"), "utf8"));
window.eval(fs.readFileSync(path.join(dir, "app.js"), "utf8"));

const tick = () => new Promise((r) => setTimeout(r, 8));
let pass = 0, fail = 0;
const check = (n, c, x) => c ? (pass++, console.log("  ✓ " + n)) : (fail++, console.log("  ✗ " + n + "  " + (x || "")));
const $ = (s) => document.querySelector(s);
const setRadio = (v) => { const r = document.querySelector(`input[name=wm][value=${v}]`); r.checked = true; r.dispatchEvent(new window.Event("change")); };

(async () => {
  await tick(); await tick(); // fetch→init→schedule(rAF)

  console.log("[起動]");
  check("データバッジがサンプル表示", /サンプル/.test($("#dataBadge").textContent), $("#dataBadge").textContent);
  check("銘柄リスト=収録数", document.querySelectorAll("#stockList .stock-item").length === NSTOCK,
    `list ${document.querySelectorAll("#stockList .stock-item").length} vs ${NSTOCK}`);
  check("初期選択=主要10", $("#selCount").textContent === "10", $("#selCount").textContent);
  check("比較チップ3つ(自作/日経/S&P)", document.querySelectorAll("#compareStrip .cmp").length === 3,
    document.querySelectorAll("#compareStrip .cmp").length);
  check("DCA表が10行", document.querySelectorAll("#constTable tbody tr").length === 10,
    document.querySelectorAll("#constTable tbody tr").length);
  check("DCA表に評価額列", /評価額/.test($("#constTable thead").textContent));
  check("DCA表に取得単価列", /取得単価/.test($("#constTable thead").textContent));
  check("DCA表に含み損益列", /含み損益/.test($("#constTable thead").textContent));
  check("取得単価セルに¥", /¥[\d,]/.test($("#constTable tbody").textContent));
  const cmpTxt = $("#compareStrip").textContent;
  check("チップに自作指数", /自作指数/.test(cmpTxt));
  check("チップに日経225", /日経225/.test(cmpTxt));
  check("チップにS&P500", /S&P500/.test(cmpTxt));
  check("統計行に最終資産¥", /最終資産/.test($("#statLine").textContent) && /¥[\d,]/.test($("#statLine").textContent));
  check("チップに＋ーの%表示", /[+−]\d/.test(cmpTxt), cmpTxt.slice(0, 40));

  console.log("\n[リターン%トグル]");
  $('#unitToggle button[data-unit=pct]').click(); await tick(); await tick();
  check("pctボタンがactive", $('#unitToggle button[data-unit=pct]').classList.contains("active"));
  check("凡例が%表示に", /％|%/.test($("#chartLegendNote").textContent), $("#chartLegendNote").textContent);
  $('#unitToggle button[data-unit=abs]').click(); await tick(); await tick();
  check("abs戻しで資産表示", /評価額|元本/.test($("#chartLegendNote").textContent), $("#chartLegendNote").textContent);

  console.log("\n[指数モードへ切替]");
  $('.mode-tab[data-mode=index]').click();
  await tick(); await tick();
  check("チャート見出しが指数", /指数/.test($("#chartTitle").textContent), $("#chartTitle").textContent);
  check("指数表に期間リターン列", /期間リターン/.test($("#constTable thead").textContent));
  check("指数モードでチップ3つ", document.querySelectorAll("#compareStrip .cmp").length === 3);
  check("統計行にCAGR", /CAGR/.test($("#statLine").textContent));

  console.log("\n[全選択]");
  $("#btnAll").click(); await tick(); await tick();
  check("選択数=収録数", $("#selCount").textContent === String(NSTOCK), $("#selCount").textContent);
  check("表が収録数の行", document.querySelectorAll("#constTable tbody tr").length === NSTOCK,
    document.querySelectorAll("#constTable tbody tr").length);

  console.log("\n[カスタム比率]");
  setRadio("custom"); await tick(); await tick();
  check("カスタムパネル表示", !$("#customPanel").classList.contains("hidden"));
  check("カスタム行=収録数", document.querySelectorAll("#customPanel .custom-row").length === NSTOCK,
    document.querySelectorAll("#customPanel .custom-row").length);

  console.log("\n[時価総額/株価でも落ちない]");
  setRadio("mktcap"); await tick(); await tick();
  check("mktcapでチップ描画", document.querySelectorAll("#compareStrip .cmp").length === 3);
  setRadio("price"); await tick(); await tick();
  check("priceでチップ描画", document.querySelectorAll("#compareStrip .cmp").length === 3);

  console.log("\n[期間を狭める]");
  setRadio("equal"); await tick();
  const sr = $("#startRange"); sr.value = Math.floor(window.Engine ? 600 : 600); sr.dispatchEvent(new window.Event("input"));
  await tick(); await tick();
  check("開始ラベル更新", $("#startLabel").textContent.length === 10, $("#startLabel").textContent);
  check("狭めても表に行", document.querySelectorAll("#constTable tbody tr").length > 0);

  console.log("\n[保存→呼び出し]");
  $("#saveName").value = "テスト指数"; $("#btnSave").click(); await tick();
  check("保存リストに1件", document.querySelectorAll("#savedList .saved-item").length === 1,
    document.querySelectorAll("#savedList .saved-item").length);
  $("#btnClear").click(); await tick(); await tick();
  check("クリアで0銘柄", $("#selCount").textContent === "0");
  document.querySelector("#savedList .saved-item .snm").click(); await tick(); await tick();
  check("呼び出しで銘柄復帰", +$("#selCount").textContent > 0, $("#selCount").textContent);

  console.log("\n[空選択ガード]");
  $("#btnClear").click(); await tick(); await tick();
  check("空でもクラッシュしない", /銘柄/.test($("#compareStrip").textContent));

  console.log(`\n=== smoke: ${pass} passed, ${fail} failed ===`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("FATAL", e); process.exit(2); });
