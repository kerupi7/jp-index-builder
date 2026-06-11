/* smoke.cjs — jsdomで保有トラッカー(index.html+engine.js+app.js)を実際に動かすテスト（開発用） */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const dir = __dirname;
const html = fs.readFileSync(path.join(dir, "index.html"), "utf8");
const pricesJSON = fs.readFileSync(path.join(dir, "data", "prices.json"), "utf8");
const DATA = JSON.parse(pricesJSON);
const NSTOCK = Object.keys(DATA.stocks).length;
const NBENCH = Object.keys(DATA.benchmarks).length;

const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url: "http://localhost/" });
const { window } = dom;
const { document } = window;

window.fetch = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(JSON.parse(pricesJSON)) });
window.Chart = class { constructor(c, cfg) { this.data = cfg.data; this.options = cfg.options; } update() {} destroy() {} resize() {} };
window.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
window.cancelAnimationFrame = (id) => clearTimeout(id);

window.eval(fs.readFileSync(path.join(dir, "engine.js"), "utf8"));
window.eval(fs.readFileSync(path.join(dir, "app.js"), "utf8"));

const tick = () => new Promise((r) => setTimeout(r, 8));
let pass = 0, fail = 0;
const check = (n, c, x) => c ? (pass++, console.log("  ✓ " + n)) : (fail++, console.log("  ✗ " + n + "  " + (x || "")));
const $ = (s) => document.querySelector(s);
const entryDate = DATA.dates[Math.max(0, DATA.dates.length - 250)];

function addHolding(ticker, shares, cost, date) {
  $("#inTicker").value = ticker; $("#inShares").value = String(shares);
  $("#inCost").value = String(cost); $("#inDate").value = date;
  $("#btnAdd").click();
}

(async () => {
  await tick(); await tick();

  console.log("[起動]");
  check("データバッジがサンプル", /サンプル/.test($("#dataBadge").textContent), $("#dataBadge").textContent);
  check("datalistに収録数の候補", document.querySelectorAll("#tickerList option").length === NSTOCK,
    document.querySelectorAll("#tickerList option").length);
  check("初期は保有0・空状態", $("#holdCount").textContent === "0" && /保有未入力/.test($("#compareStrip").textContent));

  console.log("\n[保有を1件追加]");
  addHolding("7203 トヨタ自動車", 100, 2500, entryDate);
  await tick(); await tick();
  check("保有数1", $("#holdCount").textContent === "1", $("#holdCount").textContent);
  check("保有一覧に1件", document.querySelectorAll("#holdingList .holding-item").length === 1);
  check("比較チップ=保有+ベンチ数", document.querySelectorAll("#compareStrip .cmp").length === 1 + NBENCH,
    document.querySelectorAll("#compareStrip .cmp").length + " vs " + (1 + NBENCH));
  check("保有が主役カード(.cmp-self)", document.querySelectorAll("#compareStrip .cmp-self").length === 1);
  check("ベンチはグリッド配置", document.querySelectorAll("#compareStrip .cmp-benches .cmp").length === NBENCH);
  check("主役に勝ち数表示", /指数中 \d+ に勝ち/.test($("#compareStrip").textContent));
  check("チップに保有/日経225/S&P500", /保有/.test($("#compareStrip").textContent) && /日経225/.test($("#compareStrip").textContent) && /S&P500/.test($("#compareStrip").textContent));
  check("保有テーブル1行", document.querySelectorAll("#holdingsTable tbody tr").length === 1);
  check("テーブルに取得単価・取得日列", /取得単価/.test($("#holdingsTable thead").textContent) && /取得日/.test($("#holdingsTable thead").textContent));
  check("統計行に投資額¥", /投資額/.test($("#statLine").textContent) && /¥[\d,]/.test($("#statLine").textContent));
  check("localStorageに保存", /7203/.test(window.localStorage.getItem("jpidx.holdings.v1") || ""));

  console.log("\n[¥/%トグル]");
  $('#unitToggle button[data-unit=abs]').click(); await tick(); await tick();
  check("評価額表示", /評価額|元本/.test($("#chartLegendNote").textContent), $("#chartLegendNote").textContent);
  $('#unitToggle button[data-unit=pct]').click(); await tick(); await tick();
  check("リターン%表示", /％|%/.test($("#chartLegendNote").textContent), $("#chartLegendNote").textContent);

  console.log("\n[名前で追加(コード解決)]");
  addHolding("ソニーグループ", 50, 12000, entryDate);
  await tick(); await tick();
  check("名前→コード解決で追加(2件)", $("#holdCount").textContent === "2", $("#holdCount").textContent);
  check("テーブル2行", document.querySelectorAll("#holdingsTable tbody tr").length === 2);

  console.log("\n[不正入力ガード]");
  addHolding("", 100, 2500, entryDate); await tick();
  check("銘柄空はエラー表示", $("#formMsg").classList.contains("err"));
  check("件数は増えない(2のまま)", $("#holdCount").textContent === "2");

  console.log("\n[1件削除]");
  $("#holdingList .h-del").click(); await tick(); await tick();
  check("削除で1件に", $("#holdCount").textContent === "1", $("#holdCount").textContent);

  console.log("\n[サンプル投入]");
  $("#btnSample").click(); await tick(); await tick();
  check("サンプルで複数保有", Number($("#holdCount").textContent) >= 3, $("#holdCount").textContent);
  check("テーブルも複数行", document.querySelectorAll("#holdingsTable tbody tr").length >= 3);
  check("チャート行(日経/S&P/保有)", $("#mainChart") !== null);

  console.log("\n[全消去]");
  $("#btnClearAll").click(); await tick(); await tick();
  check("0件・空状態に戻る", $("#holdCount").textContent === "0" && /保有未入力/.test($("#compareStrip").textContent));

  console.log("\n[英数字コード285A(キオクシア)]");
  if (DATA.stocks["285A"]) {
    addHolding("285A キオクシアHD", 100, 2000, entryDate); await tick(); await tick();
    check("285A(英数字)解決で追加", $("#holdCount").textContent === "1", $("#holdCount").textContent);
  } else {
    check("285Aがサンプルに存在(make_sample要再生成)", false, "no 285A in data");
  }

  console.log("\n[小数株数(フル桁)]");
  $("#btnClearAll").click(); await tick();
  addHolding("7203 トヨタ自動車", 0.46948356, 2500, entryDate); await tick(); await tick();
  check("小数株数を受付(1件)", $("#holdCount").textContent === "1", $("#holdCount").textContent);
  check("一覧にフル桁表示", /0\.46948356/.test($("#holdingList").textContent), $("#holdingList").textContent.slice(0, 50));
  check("表にもフル桁", /0\.46948356/.test($("#holdingsTable tbody").textContent));

  console.log("\n[撮影モード]");
  $("#btnShot").click(); await tick();
  check("撮影モードON", document.body.classList.contains("shot-mode"));
  check("ボタン表示が戻す", /戻す/.test($("#btnShot").textContent));
  $("#btnShot").click(); await tick();
  check("撮影モードOFFに戻る", !document.body.classList.contains("shot-mode"));

  console.log(`\n=== smoke: ${pass} passed, ${fail} failed ===`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("FATAL", e); process.exit(2); });
