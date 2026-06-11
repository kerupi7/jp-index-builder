/*
 * verify.cjs — engine.js を独立計算と突き合わせて数値検証する開発用スクリプト。
 *   $ node verify.cjs
 * 本番サイトには不要。ロジックが正しいかを確認するためだけのもの。
 */
const Engine = require("./engine.js");
const data = require("./data/prices.json");

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}  ${extra || ""}`); }
}
function approx(a, b, tol = 1e-6) {
  return Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));
}

const codesAll = Object.keys(data.stocks);
const i0 = 0, i1 = data.dates.length - 1;
const n = i1 - i0 + 1;
console.log(`データ: source=${data.source} 銘柄=${codesAll.length} 営業日=${n} (${data.start}〜${data.end})\n`);

// ---- 1) 単一銘柄・指数モード = バイ&ホールド（始点100→ price比） ----------
console.log("[1] 単一銘柄の指数モードはバイ&ホールドに一致するはず");
{
  const c = codesAll[0];
  const idx = Engine.computeIndexSeries(data, [c], "equal", null, i0, i1);
  const p0 = data.stocks[c].close[i0], p1 = data.stocks[c].close[i1];
  const expected = (p1 / p0) * 100;
  check(`${c} 指数最終値 == price比*100`, approx(idx.level[i1 - i0], expected, 1e-9),
    `got ${idx.level[i1 - i0].toFixed(6)} exp ${expected.toFixed(6)}`);
}

// ---- 2) 単一銘柄・積立モードを独立計算と一致確認 --------------------------
console.log("\n[2] 単一銘柄の積立を独立計算と突き合わせ");
{
  const c = codesAll[1], daily = 100;
  const dca = Engine.computeDCASeries(data, [c], "equal", null, daily, i0, i1);
  let sh = 0;
  for (let t = i0; t <= i1; t++) sh += daily / data.stocks[c].close[t];
  const expectFinal = sh * data.stocks[c].close[i1];
  check(`${c} 最終資産が独立計算と一致`, approx(dca.asset[i1 - i0], expectFinal, 1e-6),
    `got ${dca.asset[i1 - i0].toFixed(4)} exp ${expectFinal.toFixed(4)}`);
  check(`元本 = daily*n`, approx(dca.invested[i1 - i0], daily * n),
    `got ${dca.invested[i1 - i0]} exp ${daily * n}`);
}

// ---- 3) 均等加重・積立を独立ループと一致確認（複数銘柄）-------------------
console.log("\n[3] 均等加重・積立（5銘柄）を独立ループと突き合わせ");
{
  const codes = codesAll.slice(0, 5), daily = 100;
  const dca = Engine.computeDCASeries(data, codes, "equal", null, daily, i0, i1);
  const sh = {}; codes.forEach((c) => (sh[c] = 0));
  for (let t = i0; t <= i1; t++) {
    const valid = codes.filter((c) => data.stocks[c].close[t] > 0);
    const per = daily / valid.length;
    for (const c of valid) sh[c] += per / data.stocks[c].close[t];
  }
  let exp = 0; codes.forEach((c) => (exp += sh[c] * data.stocks[c].close[i1]));
  check("均等加重 最終資産が独立計算と一致", approx(dca.asset[i1 - i0], exp, 1e-6),
    `got ${dca.asset[i1 - i0].toFixed(4)} exp ${exp.toFixed(4)}`);
  // perStock の合計 == asset
  const sumPer = dca.perStock.reduce((a, b) => a + b.value, 0);
  check("perStock合計 == 最終資産", approx(sumPer, dca.asset[i1 - i0], 1e-6));
  // 取得単価・含み損益・損益率の整合
  const r0 = dca.perStock[0];
  check("取得単価×株数 == 投資額", approx(r0.avgCost * r0.shares, r0.invested, 1e-6),
    `avg ${r0.avgCost} sh ${r0.shares} inv ${r0.invested}`);
  check("含み損益 == 評価額−投資額", approx(r0.pl, r0.value - r0.invested, 1e-9));
  check("損益率 == 現在値/取得単価−1", approx(r0.ret, r0.price / r0.avgCost - 1, 1e-9));
}

// ---- 4) ウェイト合計=1（各method）---------------------------------------
console.log("\n[4] 目標ウェイトの合計は常に1");
{
  const codes = codesAll.slice(0, 8);
  const pricesT = {}; codes.forEach((c) => (pricesT[c] = data.stocks[c].close[i1]));
  const sh = {}; codes.forEach((c) => (sh[c] = data.stocks[c].shares));
  for (const m of ["equal", "price", "mktcap"]) {
    const w = Engine.targetWeights(m, codes, pricesT, sh, null);
    const s = Object.values(w).reduce((a, b) => a + b, 0);
    check(`method=${m} weight合計=1`, approx(s, 1, 1e-9), `got ${s}`);
  }
  // custom 未指定 → 均等フォールバック
  const w = Engine.targetWeights("custom", codes, pricesT, sh, {});
  check("custom空 → 均等フォールバック", approx(w[codes[0]], 1 / codes.length));
}

// ---- 5) IRR の整合性（既知ケース）---------------------------------------
console.log("\n[5] IRRの整合性");
{
  // 毎日100円・全部そのまま残った（リターン0）→ IRR ≈ 0
  const irr0 = Engine.irrAnnual(100, 100 * 100, 100); // 100日, 元本=最終
  check("元本==最終資産なら年率IRR≈0", Math.abs(irr0) < 1e-3, `got ${irr0}`);
  // 最終資産が元本より大 → IRR>0
  const irrp = Engine.irrAnnual(100, 100 * 100 * 1.5, 100);
  check("最終>元本なら IRR>0", irrp > 0, `got ${irrp}`);
}

// ---- 6) 最大ドローダウン（既知系列）------------------------------------
console.log("\n[6] 最大ドローダウン");
{
  const dd = Engine.maxDrawdown([100, 120, 90, 110, 60, 130]); // 120→60 = -50%
  check("MDD == -0.5", approx(dd.mdd, -0.5, 1e-9), `got ${dd.mdd}`);
}

// ---- 7) 全40銘柄・全方式が走り、有限値を返す ----------------------------
console.log("\n[7] 全40銘柄で各方式が有限値を返す");
{
  for (const m of ["equal", "price", "mktcap"]) {
    const idx = Engine.computeIndexSeries(data, codesAll, m, null, i0, i1);
    const dca = Engine.computeDCASeries(data, codesAll, m, null, 100, i0, i1);
    const okIdx = idx.level.every((x) => isFinite(x) && x > 0);
    const okDca = dca.asset.every((x) => isFinite(x) && x >= 0);
    check(`${m}: 指数/積立とも有限`, okIdx && okDca);
  }
}

// ---- 8) 複数ベンチマーク（日経225・S&P500）と後方互換 -------------------
console.log("\n[8] 複数ベンチマーク対応");
{
  const idx = Engine.computeIndexSeries(data, codesAll, "equal", null, i0, i1);
  const dca = Engine.computeDCASeries(data, codesAll, "equal", null, 100, i0, i1);
  check("指数: benches 2本(日経/S&P)", idx.benches.length === 2, idx.benches.map((b) => b.name).join(","));
  check("積立: benchAssets 2本", dca.benchAssets.length === 2);
  check("各benchは始点100", idx.benches.every((b) => approx(b.level[0], 100)));
  check("benchAsset長さ==期間", dca.benchAssets[0].asset.length === n);
  // 後方互換: 旧 benchmark{} 単数スキーマでも1本返す
  const firstSym = Object.keys(data.benchmarks)[0];
  const old = { benchmark: { symbol: firstSym, name: "日経225", close: data.benchmarks[firstSym].close } };
  check("旧スキーマbenchmark{}を1本に正規化", Engine.benchmarksOf(old).length === 1);
}

// ---- サマリ：参考の実数値（均等 vs 日経 vs S&P500）----------------------
console.log("\n--- 参考: 均等加重40銘柄 vs 日経225 vs S&P500 (サンプルデータ) ---");
{
  const idx = Engine.computeIndexSeries(data, codesAll, "equal", null, i0, i1);
  const dca = Engine.computeDCASeries(data, codesAll, "equal", null, 100, i0, i1);
  const fin = idx.level[idx.level.length - 1];
  const bN = idx.benches[0].level[idx.benches[0].level.length - 1];
  const bS = idx.benches[1].level[idx.benches[1].level.length - 1];
  console.log(`指数モード(始点100): 均等 ${fin.toFixed(1)} / 日経 ${bN.toFixed(1)} / S&P ${bS.toFixed(1)}`);
  const fa = dca.asset[dca.asset.length - 1], inv = dca.invested[dca.invested.length - 1];
  const baN = dca.benchAssets[0].asset[n - 1], baS = dca.benchAssets[1].asset[n - 1];
  const pct = (a) => ((a / inv - 1) * 100).toFixed(1) + "%";
  console.log(`積立(毎日100円) 資産 ${Math.round(fa).toLocaleString()}円 元本 ${Math.round(inv).toLocaleString()}円`);
  console.log(`  リターン%: 自作 ${pct(fa)} / 日経積立 ${pct(baN)} / S&P積立 ${pct(baS)}`);
}

console.log(`\n=== 結果: ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
