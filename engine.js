/*
 * engine.js — 指数/積立シミュレーションの純粋計算部（DOM非依存）。
 * ブラウザでは window.Engine、Node では require('./engine.js') で使える（UMD）。
 * ここに副作用は置かない。テスト(verify.cjs)はこのファイルを直接importして検証する。
 */
(function (root) {
  "use strict";

  // ---- 小道具 -----------------------------------------------------------
  function priceAt(data, code, t) {
    const v = data.stocks[code].close[t];
    return (v === null || v === undefined || v <= 0) ? null : v;
  }

  // ある日 t に有効な（株価が取れる）銘柄だけ返す
  function availableCodes(data, codes, t) {
    return codes.filter((c) => priceAt(data, c, t) !== null);
  }

  // 目標ウェイト（合計1）。method: 'equal' | 'price' | 'mktcap' | 'custom'
  // pricesT: その日の {code: price}, custom: {code: weight}
  function targetWeights(method, codes, pricesT, sharesMap, custom) {
    const raw = {};
    let sum = 0;
    for (const c of codes) {
      let w;
      if (method === "equal") w = 1;
      else if (method === "price") w = pricesT[c];
      else if (method === "mktcap") w = pricesT[c] * (sharesMap[c] || 0);
      else if (method === "custom") w = Math.max(0, (custom && custom[c]) || 0);
      else w = 1;
      raw[c] = w;
      sum += w;
    }
    const out = {};
    if (sum <= 0) {
      // 全部0（カスタムで未指定など）→ 均等にフォールバック
      for (const c of codes) out[c] = 1 / codes.length;
      return out;
    }
    for (const c of codes) out[c] = raw[c] / sum;
    return out;
  }

  // ---- 指数モード：毎日リバランスする加重リターン指数（始点=100）---------
  // 各ベンチ（日経225・S&P500…）も同じ始点=100に正規化して比較。
  function computeIndexSeries(data, codes, method, custom, i0, i1) {
    const dates = data.dates.slice(i0, i1 + 1);
    const bl = benchmarksOf(data);
    const level = [100];
    const benchLv = bl.map(() => [100]);
    const shMap = sharesMapOf(data);
    for (let t = i0 + 1; t <= i1; t++) {
      // 前日 t-1 の価格で目標ウェイトを決め、t のリターンを取る（両日とも価格がある銘柄のみ）
      const valid = codes.filter(
        (c) => priceAt(data, c, t - 1) !== null && priceAt(data, c, t) !== null
      );
      let ret = 0;
      if (valid.length) {
        const pPrev = {};
        for (const c of valid) pPrev[c] = priceAt(data, c, t - 1);
        const w = targetWeights(method, valid, pPrev, shMap, custom);
        for (const c of valid) {
          const r = priceAt(data, c, t) / priceAt(data, c, t - 1) - 1;
          ret += w[c] * r;
        }
      }
      level.push(level[level.length - 1] * (1 + ret));
      bl.forEach((b, k) => {
        const br = b.close[t] && b.close[t - 1] ? b.close[t] / b.close[t - 1] - 1 : 0;
        benchLv[k].push(benchLv[k][benchLv[k].length - 1] * (1 + br));
      });
    }
    const benches = bl.map((b, k) => ({ sym: b.sym, name: b.name, level: benchLv[k] }));
    return { dates, level, benches };
  }

  // ---- 積立モード：毎日 daily 円を目標ウェイトで購入（DCA）---------------
  function computeDCASeries(data, codes, method, custom, daily, i0, i1) {
    const dates = data.dates.slice(i0, i1 + 1);
    const bl = benchmarksOf(data);
    const sharesHeld = {};
    const investedInCode = {};
    for (const c of codes) {
      sharesHeld[c] = 0;
      investedInCode[c] = 0;
    }
    const benchUnits = bl.map(() => 0);
    const benchAssetsArr = bl.map(() => []);
    let invested = 0;
    const asset = [];
    const investedArr = [];
    const shMap = sharesMapOf(data);

    for (let t = i0; t <= i1; t++) {
      const valid = availableCodes(data, codes, t);
      const pricesT = {};
      for (const c of valid) pricesT[c] = priceAt(data, c, t);
      const w = targetWeights(method, valid, pricesT, shMap, custom);
      for (const c of valid) {
        const amt = daily * w[c];
        sharesHeld[c] += amt / pricesT[c];
        investedInCode[c] += amt;
      }
      invested += daily;
      bl.forEach((b, k) => { if (b.close[t]) benchUnits[k] += daily / b.close[t]; });

      let v = 0;
      for (const c of codes) {
        const p = priceAt(data, c, t);
        if (p !== null) v += sharesHeld[c] * p;
      }
      asset.push(v);
      investedArr.push(invested);
      bl.forEach((b, k) => benchAssetsArr[k].push(benchUnits[k] * (b.close[t] || 0)));
    }
    const benchAssets = bl.map((b, k) => ({ sym: b.sym, name: b.name, asset: benchAssetsArr[k] }));

    // 銘柄ごとの最終内訳
    const perStock = codes.map((c) => {
      const p = priceAt(data, c, i1);
      const sh = sharesHeld[c];
      const inv = investedInCode[c];
      const value = p !== null ? sh * p : 0;
      return {
        code: c,
        name: data.stocks[c].name,
        sector: data.stocks[c].sector,
        invested: inv,          // 累計投資額（このカスタム比率で毎日積んだ合計）
        shares: sh,             // 保有株数（端株あり）
        price: p,               // 現在値
        avgCost: sh > 0 ? inv / sh : 0,   // 取得単価＝投資額÷株数（DCA平均）
        value,                  // 評価額＝株数×現在値
        pl: value - inv,        // 含み損益
        ret: inv > 0 ? value / inv - 1 : 0, // 損益率＝現在値/取得単価−1 と同じ
      };
    });

    return { dates, asset, invested: investedArr, benchAssets, perStock };
  }

  // ---- 指標 -------------------------------------------------------------
  function maxDrawdown(series) {
    let peak = -Infinity, mdd = 0, peakIdx = 0, troughIdx = 0, curPeak = 0;
    for (let i = 0; i < series.length; i++) {
      const v = series[i];
      if (v > peak) { peak = v; curPeak = i; }
      const dd = (v - peak) / peak;
      if (dd < mdd) { mdd = dd; peakIdx = curPeak; troughIdx = i; }
    }
    return { mdd, peakIdx, troughIdx };
  }

  function cagr(first, last, nDays) {
    if (first <= 0 || nDays <= 1) return 0;
    return Math.pow(last / first, 252 / (nDays - 1)) - 1;
  }

  function annualVol(level) {
    const rets = [];
    for (let i = 1; i < level.length; i++) rets.push(level[i] / level[i - 1] - 1);
    if (rets.length < 2) return 0;
    const m = rets.reduce((a, b) => a + b, 0) / rets.length;
    const v = rets.reduce((a, b) => a + (b - m) * (b - m), 0) / (rets.length - 1);
    return Math.sqrt(v) * Math.sqrt(252);
  }

  // 積立の年率リターン（資金加重・IRR）。毎日 -daily、最終日に +finalValue。
  function irrAnnual(daily, finalValue, n) {
    if (finalValue <= 0 || n < 2) return 0;
    const npv = (r) => {
      let s = 0;
      for (let t = 0; t < n; t++) s += -daily / Math.pow(1 + r, t);
      s += finalValue / Math.pow(1 + r, n - 1);
      return s;
    };
    let lo = -0.5, hi = 0.5; // 日次レート
    if (npv(lo) < 0 && npv(hi) < 0) return -1;
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2;
      const val = npv(mid);
      if (Math.abs(val) < 1e-6) { lo = hi = mid; break; }
      if (val > 0) lo = mid; else hi = mid;
    }
    const rDaily = (lo + hi) / 2;
    return Math.pow(1 + rDaily, 252) - 1;
  }

  // ---- 内部 -------------------------------------------------------------
  function sharesMapOf(data) {
    const m = {};
    for (const c in data.stocks) m[c] = data.stocks[c].shares || 0;
    return m;
  }

  // ベンチマーク一覧を取り出す（新スキーマ benchmarks{} / 旧 benchmark{} 両対応）
  function benchmarksOf(data) {
    if (data.benchmarks) {
      return Object.keys(data.benchmarks).map((sym) => ({
        sym, name: data.benchmarks[sym].name, close: data.benchmarks[sym].close,
      }));
    }
    if (data.benchmark) {
      return [{ sym: data.benchmark.symbol, name: data.benchmark.name, close: data.benchmark.close }];
    }
    return [];
  }

  // ---- 保有ポートフォリオ評価 ----------------------------------------------
  // 取得日(dstr)が入る営業日インデックス（その日以降で最初の営業日）。
  function dateIndex(dates, dstr) {
    if (!dstr || dstr <= dates[0]) return 0;
    for (let t = 0; t < dates.length; t++) if (dates[t] >= dstr) return t;
    return dates.length - 1;
  }

  // holdings: [{code, shares, cost(取得単価), date(取得日 YYYY-MM-DD)}]
  // 返すもの: 評価額・累計元本・各ベンチ「同じ資金を同じ日に入れた場合」の価値（時系列）。
  function computePortfolio(data, holdings) {
    const dates = data.dates;
    const benches = benchmarksOf(data);
    const H = holdings
      .filter((h) => data.stocks[h.code] && h.shares > 0)
      .map((h) => {
        const ei = dateIndex(dates, h.date);
        return { ...h, ei, bEntry: benches.map((b) => b.close[ei]) };
      });
    if (!H.length) return null;

    const i0 = Math.min(...H.map((h) => h.ei));
    const i1 = dates.length - 1;
    const value = [], cost = [];
    const benchVals = benches.map(() => []);

    for (let t = i0; t <= i1; t++) {
      let v = 0, c = 0;
      const bv = benches.map(() => 0);
      for (const h of H) {
        if (h.ei > t) continue; // まだ取得していない
        const invested = h.shares * h.cost;
        c += invested;
        const p = priceAt(data, h.code, t);
        if (p !== null) v += h.shares * p;
        benches.forEach((b, k) => {
          const be = h.bEntry[k], bt = b.close[t];
          if (be && bt) bv[k] += invested * (bt / be); // 同額・同日に指数へ入れたら
        });
      }
      value.push(v); cost.push(c);
      benches.forEach((b, k) => benchVals[k].push(bv[k]));
    }

    const perHolding = H.map((h) => {
      const p = priceAt(data, h.code, i1);
      const invested = h.shares * h.cost;
      const val = p !== null ? h.shares * p : 0;
      return {
        code: h.code, name: data.stocks[h.code].name, sector: data.stocks[h.code].sector,
        shares: h.shares, cost: h.cost, date: h.date, price: p,
        invested, value: val, pl: val - invested,
        ret: invested > 0 ? val / invested - 1 : 0,
      };
    });

    return {
      dates: dates.slice(i0, i1 + 1),
      value, cost,
      benches: benches.map((b, k) => ({ sym: b.sym, name: b.name, value: benchVals[k] })),
      perHolding, i0, i1,
    };
  }

  const Engine = {
    priceAt, availableCodes, targetWeights, benchmarksOf, dateIndex,
    computeIndexSeries, computeDCASeries, computePortfolio,
    maxDrawdown, cagr, annualVol, irrAnnual,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = Engine;
  root.Engine = Engine;
})(typeof globalThis !== "undefined" ? globalThis : this);
