/* app.js — UI制御。engine.js(window.Engine) と Chart.js を使う。 */
(function () {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const TOP10 = ["7203", "6758", "6861", "9984", "8306", "9983", "6098", "8035", "9432", "8058"];
  const MODE_DESC = {
    dca: "毎日◯円ずつ買い続けたら資産がどう増えるか（積立／ドルコスト平均法）。同額を日経225に積立した場合と比較します。",
    index: "選んだ銘柄を毎日リバランスした株価指数（始点=100）。日経225の指数水準と比較します。",
  };

  const state = {
    data: null,
    selected: new Set(),
    method: "equal",
    custom: {},        // {code: 相対ウェイト}
    i0: 0, i1: 0,
    daily: 100,
    mode: "dca",
    unit: "pct",   // チャートの単位: 'pct'(リターン% ＝デフォルト) | 'abs'(資産額/指数)
  };
  let chart = null;
  let rafId = null;

  // ---------- 起動 ----------
  // 単体プレビュー(preview.html)では window.__PRICES__ に直接データを埋め込む。
  // 通常(GitHub Pages)は data/prices.json を取得する。
  if (window.__PRICES__) {
    init(window.__PRICES__);
  } else {
    fetch("data/prices.json", { cache: "no-store" })
      .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then((d) => init(d))
      .catch((e) => {
        $("#dataBadge").textContent = "データ読込失敗: data/prices.json";
        $("#dataBadge").className = "badge badge-warn";
        console.error(e);
      });
  }

  function init(data) {
    state.data = data;
    state.i0 = 0; state.i1 = data.dates.length - 1;

    // データバッジ
    const badge = $("#dataBadge");
    if (data.source && data.source !== "SAMPLE") {
      const srcName = { yahoo: "Yahoo Finance", stooq: "stooq" }[data.source] || data.source;
      badge.textContent = `実データ ${srcName}・${data.end} 時点`;
      badge.className = "badge badge-ok";
    } else {
      badge.textContent = "サンプルデータ（実データは fetch_data.py で取得）";
      badge.className = "badge badge-warn";
    }

    buildSectorFilter();
    buildStockList();
    buildRanges();

    // デフォルト選択：主要10・均等
    TOP10.forEach((c) => { if (data.stocks[c]) state.selected.add(c); });
    syncCheckboxes();
    updateSelCount();

    wireEvents();
    renderModeUI();
    renderSaved();
    $("#disclaimer").innerHTML =
      "※ 配当・売買手数料・税金は考慮していません。積立は終値で端株購入できる前提の簡易シミュレーションです。" +
      "S&P500は現地通貨(USD)の指数水準で比較し、為替(USD/JPY)は考慮していません。" +
      "時価総額加重の発行済株式数は概算値です。本ツールは情報提供のみを目的とし、投資勧誘・助言ではありません。投資判断はご自身の責任で。";
    schedule();
  }

  // ---------- 銘柄リスト ----------
  function buildSectorFilter() {
    const secs = [...new Set(Object.values(state.data.stocks).map((s) => s.sector))].sort();
    const sel = $("#sectorFilter");
    secs.forEach((s) => {
      const o = document.createElement("option"); o.value = s; o.textContent = s; sel.appendChild(o);
    });
  }

  function buildStockList() {
    const list = $("#stockList");
    list.innerHTML = "";
    const q = $("#search").value.trim().toLowerCase();
    const sec = $("#sectorFilter").value;
    const codes = Object.keys(state.data.stocks).sort();
    for (const c of codes) {
      const s = state.data.stocks[c];
      if (sec && s.sector !== sec) continue;
      if (q && !(c.includes(q) || s.name.toLowerCase().includes(q))) continue;
      const row = document.createElement("label");
      row.className = "stock-item";
      row.innerHTML =
        `<input type="checkbox" data-code="${c}" ${state.selected.has(c) ? "checked" : ""}/>` +
        `<span class="code">${c}</span><span class="nm">${s.name}</span>` +
        `<span class="sec">${s.sector}</span>`;
      list.appendChild(row);
    }
    list.querySelectorAll("input").forEach((cb) =>
      cb.addEventListener("change", (e) => {
        const c = e.target.dataset.code;
        if (e.target.checked) state.selected.add(c); else state.selected.delete(c);
        updateSelCount(); renderCustomPanel(); schedule();
      })
    );
  }

  function syncCheckboxes() {
    document.querySelectorAll('#stockList input[data-code]').forEach((cb) => {
      cb.checked = state.selected.has(cb.dataset.code);
    });
  }
  function updateSelCount() { $("#selCount").textContent = state.selected.size; }

  // ---------- 期間スライダー ----------
  function buildRanges() {
    const n = state.data.dates.length;
    const sr = $("#startRange"), er = $("#endRange");
    sr.max = er.max = n - 1; sr.value = 0; er.value = n - 1;
    updateRangeLabels();
  }
  function updateRangeLabels() {
    $("#startLabel").textContent = state.data.dates[state.i0];
    $("#endLabel").textContent = state.data.dates[state.i1];
  }

  // ---------- カスタム比率 ----------
  function renderCustomPanel() {
    const panel = $("#customPanel");
    if (state.method !== "custom") { panel.classList.add("hidden"); return; }
    panel.classList.remove("hidden");
    panel.innerHTML = "";
    const codes = [...state.selected];
    if (!codes.length) { panel.innerHTML = '<small>銘柄を選ぶと比率を設定できます</small>'; return; }
    const note = document.createElement("small");
    note.style.cssText = "color:var(--mut);display:block;margin-bottom:6px;line-height:1.45";
    note.textContent = "比率＝毎日の買付金額の配分。取得単価はこの比率で平均化され、評価額の構成比は値動きでズレます。";
    panel.appendChild(note);
    const total = codes.reduce((a, c) => a + (state.custom[c] || 1), 0);
    codes.forEach((c) => {
      if (state.custom[c] == null) state.custom[c] = 1;
      const pct = ((state.custom[c] || 0) / total * 100).toFixed(1);
      const row = document.createElement("div");
      row.className = "custom-row";
      row.innerHTML = `<span class="nm">${state.data.stocks[c].name}</span>` +
        `<input type="number" min="0" step="0.5" value="${state.custom[c]}" data-code="${c}"/>` +
        `<span class="pct">${pct}%</span>`;
      panel.appendChild(row);
    });
    panel.querySelectorAll("input").forEach((inp) =>
      inp.addEventListener("input", (e) => {
        state.custom[e.target.dataset.code] = parseFloat(e.target.value) || 0;
        renderCustomPanel(); schedule();
      })
    );
  }

  // ---------- イベント ----------
  function wireEvents() {
    $("#search").addEventListener("input", buildStockList);
    $("#sectorFilter").addEventListener("change", buildStockList);
    $("#btnAll").addEventListener("click", () => {
      Object.keys(state.data.stocks).forEach((c) => state.selected.add(c));
      syncCheckboxes(); updateSelCount(); renderCustomPanel(); schedule();
    });
    $("#btnTop10").addEventListener("click", () => {
      state.selected = new Set(TOP10.filter((c) => state.data.stocks[c]));
      buildStockList(); updateSelCount(); renderCustomPanel(); schedule();
    });
    $("#btnClear").addEventListener("click", () => {
      state.selected.clear(); syncCheckboxes(); updateSelCount(); renderCustomPanel(); schedule();
    });
    document.querySelectorAll('input[name="wm"]').forEach((r) =>
      r.addEventListener("change", (e) => { state.method = e.target.value; renderCustomPanel(); schedule(); })
    );
    $("#startRange").addEventListener("input", (e) => {
      state.i0 = Math.min(+e.target.value, state.i1 - 1); e.target.value = state.i0;
      updateRangeLabels(); schedule();
    });
    $("#endRange").addEventListener("input", (e) => {
      state.i1 = Math.max(+e.target.value, state.i0 + 1); e.target.value = state.i1;
      updateRangeLabels(); schedule();
    });
    $("#dailyAmount").addEventListener("input", (e) => {
      state.daily = Math.max(1, +e.target.value || 1); schedule();
    });
    document.querySelectorAll(".mode-tab").forEach((t) =>
      t.addEventListener("click", () => {
        document.querySelectorAll(".mode-tab").forEach((x) => x.classList.remove("active"));
        t.classList.add("active"); state.mode = t.dataset.mode; renderModeUI(); schedule();
      })
    );
    document.querySelectorAll("#unitToggle button").forEach((b) =>
      b.addEventListener("click", () => {
        state.unit = b.dataset.unit;
        document.querySelectorAll("#unitToggle button").forEach((x) => x.classList.toggle("active", x === b));
        schedule();
      })
    );
    $("#btnSave").addEventListener("click", saveCurrent);
  }

  function renderModeUI() {
    $("#modeDesc").textContent = MODE_DESC[state.mode];
    $("#amountRow").style.display = state.mode === "dca" ? "" : "none";
    $("#chartTitle").textContent = state.mode === "dca" ? "資産推移（毎日積立）" : "指数の推移（始点=100）";
    const absBtn = document.querySelector('#unitToggle button[data-unit="abs"]');
    if (absBtn) absBtn.textContent = state.mode === "dca" ? "資産額" : "指数(100)";
  }

  // ---------- 計算＆描画（デバウンス） ----------
  function schedule() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(run);
  }

  const SELF_COLOR = "--accent";
  const BENCH_COLORS = ["--warn", "--accent2", "--up", "--down"]; // 日経=amber, S&P=purple…

  function run() {
    const E = window.Engine;
    const codes = [...state.selected].filter((c) => state.data.stocks[c]);
    if (!codes.length) { renderEmpty(); return; }
    const { i0, i1, method, custom, daily, mode, unit } = state;

    if (mode === "dca") {
      const dca = E.computeDCASeries(state.data, codes, method, custom, daily, i0, i1);
      const n = i1 - i0 + 1;
      const inv = dca.invested;
      const finalAsset = dca.asset[n - 1];
      const invested = inv[n - 1];
      const plPct = invested > 0 ? finalAsset / invested - 1 : 0;
      const irr = E.irrAnnual(daily, finalAsset, n);
      const mdd = E.maxDrawdown(dca.asset).mdd;

      // 比較チップ（＝チャートの各ライン。これが「全部一括の＋ー」）
      const chips = [{ label: "自作指数", color: cssVar(SELF_COLOR), pct: plPct, sub: yen(finalAsset) }];
      dca.benchAssets.forEach((b, k) => {
        const bPct = invested > 0 ? b.asset[n - 1] / invested - 1 : 0;
        chips.push({ label: b.name, color: cssVar(BENCH_COLORS[k % BENCH_COLORS.length]), pct: bPct, sub: ppGap(plPct - bPct) });
      });
      renderCompare(chips);
      renderStatLine([
        ["投資元本", yen(invested)], ["最終資産", yen(finalAsset)],
        ["年率IRR", signPct(irr)], ["最大DD", pct(mdd)], ["期間", `${n.toLocaleString()}営業日`],
      ]);

      let datasets, yFmt, note;
      if (unit === "pct") {
        const toPct = (arr) => arr.map((v, i) => (inv[i] > 0 ? (v / inv[i] - 1) * 100 : 0));
        datasets = [line("自作指数", toPct(dca.asset), SELF_COLOR, false)];
        dca.benchAssets.forEach((b, k) => datasets.push(line(b.name, toPct(b.asset), BENCH_COLORS[k % BENCH_COLORS.length], false)));
        yFmt = (v) => (v >= 0 ? "+" : "") + v.toFixed(0) + "%";
        note = "元本に対するリターン％（全部 同じ毎日積立で比較）";
      } else {
        datasets = [line("自作指数の資産", dca.asset, SELF_COLOR, false), line("投資元本", dca.invested, "--mut2", true)];
        dca.benchAssets.forEach((b, k) => datasets.push(line(`${b.name}に積立`, b.asset, BENCH_COLORS[k % BENCH_COLORS.length], false)));
        yFmt = (v) => yenShort(v);
        note = "実線=評価額／点線=元本";
      }
      drawChart(dca.dates, datasets, yFmt);
      $("#chartLegendNote").textContent = note;
      renderTableDCA(dca, finalAsset);
    } else {
      const idx = E.computeIndexSeries(state.data, codes, method, custom, i0, i1);
      const n = i1 - i0 + 1;
      const lvl = idx.level[idx.level.length - 1];
      const totRet = lvl / 100 - 1;
      const cagr = E.cagr(100, lvl, n);
      const vol = E.annualVol(idx.level);
      const mdd = E.maxDrawdown(idx.level).mdd;

      const chips = [{ label: "自作指数", color: cssVar(SELF_COLOR), pct: totRet, sub: `指数 ${lvl.toFixed(1)}` }];
      idx.benches.forEach((b, k) => {
        const bRet = b.level[b.level.length - 1] / 100 - 1;
        chips.push({ label: b.name, color: cssVar(BENCH_COLORS[k % BENCH_COLORS.length]), pct: bRet, sub: ppGap(totRet - bRet) });
      });
      renderCompare(chips);
      renderStatLine([
        ["年率CAGR", signPct(cagr)], ["年率ボラ", pct(vol)], ["最大DD", pct(mdd)], ["期間", `${n.toLocaleString()}営業日`],
      ]);

      let datasets, yFmt, note;
      if (unit === "pct") {
        const toPct = (arr) => arr.map((v) => v - 100);
        datasets = [line("自作指数", toPct(idx.level), SELF_COLOR, false)];
        idx.benches.forEach((b, k) => datasets.push(line(b.name, toPct(b.level), BENCH_COLORS[k % BENCH_COLORS.length], false)));
        yFmt = (v) => (v >= 0 ? "+" : "") + v.toFixed(0) + "%";
        note = "始点からのリターン％";
      } else {
        datasets = [line("自作指数", idx.level, SELF_COLOR, false)];
        idx.benches.forEach((b, k) => datasets.push(line(b.name, b.level, BENCH_COLORS[k % BENCH_COLORS.length], false)));
        yFmt = (v) => v.toFixed(0);
        note = "始点=100に正規化";
      }
      drawChart(idx.dates, datasets, yFmt);
      $("#chartLegendNote").textContent = note;
      renderTableIndex(codes);
    }
  }

  // 自作との差を「+◯%pt / −◯%pt」で
  function ppGap(d) { return "自作と " + (d >= 0 ? "+" : "−") + Math.abs(d * 100).toFixed(1) + "%pt"; }

  function renderEmpty() {
    $("#compareStrip").innerHTML = '<div class="cmp"><span class="dot" style="--c:var(--mut2)"></span><div class="cmp-body"><span class="cmp-label">銘柄未選択</span><span class="cmp-sub">左で銘柄を選んでください</span></div></div>';
    $("#statLine").innerHTML = "";
    $("#constTable").querySelector("thead").innerHTML = "";
    $("#constTable").querySelector("tbody").innerHTML = "";
    if (chart) { chart.destroy(); chart = null; }
  }

  // ---------- 比較チップ＆統計行（カードの代わり） ----------
  function renderCompare(items) {
    $("#compareStrip").innerHTML = items.map((it) =>
      `<div class="cmp"><span class="dot" style="--c:${it.color}"></span>` +
      `<div class="cmp-body"><span class="cmp-label">${it.label}</span>` +
      `<span class="cmp-pct ${it.pct >= 0 ? "up" : "down"}">${signPct(it.pct)}</span>` +
      `<span class="cmp-sub">${it.sub || ""}</span></div></div>`
    ).join("");
  }
  function renderStatLine(pairs) {
    $("#statLine").innerHTML = pairs.map(([k, v]) => `<span>${k}<b>${v}</b></span>`).join("");
  }

  // ---------- チャート ----------
  function cssVar(name) { return getComputedStyle(document.body).getPropertyValue(name).trim(); }
  function line(label, data, varName, dashed) {
    return { label, data, color: cssVar(varName), dashed };
  }
  function drawChart(dates, lines, yFmt) {
    const ctx = $("#mainChart");
    const datasets = lines.map((l) => ({
      label: l.label, data: l.data, borderColor: l.color,
      backgroundColor: l.color + "22",
      borderWidth: l.dashed ? 1.5 : 2, borderDash: l.dashed ? [5, 4] : [],
      pointRadius: 0, tension: 0.08, fill: false,
    }));
    const opts = {
      responsive: true, maintainAspectRatio: false, animation: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { labels: { color: cssVar("--mut"), boxWidth: 14, font: { size: 12 } } },
        tooltip: {
          callbacks: {
            title: (it) => dates[it[0].dataIndex],
            label: (it) => `${it.dataset.label}: ${yFmt(it.parsed.y)}`,
          },
        },
      },
      scales: {
        x: { ticks: { color: cssVar("--mut2"), maxTicksLimit: 8, autoSkip: true }, grid: { color: "rgba(42,50,82,.35)" } },
        y: { ticks: { color: cssVar("--mut2"), callback: yFmt }, grid: { color: "rgba(42,50,82,.35)" } },
      },
    };
    if (chart) { chart.data.labels = dates; chart.data.datasets = datasets; chart.options = opts; chart.update(); }
    else chart = new Chart(ctx, { type: "line", data: { labels: dates, datasets }, options: opts });
  }

  // ---------- テーブル ----------
  let sortKey = "value", sortDir = -1;
  function renderTableDCA(dca, total) {
    const rows = dca.perStock.filter((r) => state.selected.has(r.code));
    const cols = [
      ["code", "コード"], ["name", "銘柄"],
      ["invested", "投資額"], ["avgCost", "取得単価"], ["value", "評価額"],
      ["pl", "含み損益"], ["ret", "損益率"], ["weight", "評価額比"],
    ];
    rows.forEach((r) => (r.weight = total > 0 ? r.value / total : 0));
    sortRows(rows);
    const thead = cols.map(([k, lbl]) =>
      `<th data-k="${k}" class="${sortKey === k ? (sortDir < 0 ? "s-desc" : "s-asc") : ""}">${lbl}</th>`).join("");
    $("#constTable").querySelector("thead").innerHTML = `<tr>${thead}</tr>`;
    const maxW = Math.max(...rows.map((r) => r.weight), 0.0001);
    $("#constTable").querySelector("tbody").innerHTML = rows.map((r) =>
      `<tr><td class="code">${r.code}</td><td style="text-align:left">${r.name}</td>` +
      `<td>${yen(r.invested)}</td><td>${yen(r.avgCost)}</td><td>${yen(r.value)}</td>` +
      `<td class="${r.pl >= 0 ? "up" : "down"}">${signYen(r.pl)}</td>` +
      `<td class="${r.ret >= 0 ? "up" : "down"}">${signPct(r.ret)}</td>` +
      `<td>${(r.weight * 100).toFixed(1)}%<span class="bar" style="width:${(r.weight / maxW * 46).toFixed(0)}px"></span></td></tr>`
    ).join("");
    wireSort(() => renderTableDCA(dca, total));
  }

  function renderTableIndex(codes) {
    const E = window.Engine, d = state.data, i0 = state.i0, i1 = state.i1;
    const pricesT = {}; const sh = {};
    codes.forEach((c) => { pricesT[c] = E.priceAt(d, c, i1); sh[c] = d.stocks[c].shares; });
    const w = E.targetWeights(state.method, codes, pricesT, sh, state.custom);
    const rows = codes.map((c) => {
      const p0 = E.priceAt(d, c, i0), p1 = E.priceAt(d, c, i1);
      return {
        code: c, name: d.stocks[c].name, sector: d.stocks[c].sector,
        weight: w[c] || 0, ret: p0 && p1 ? p1 / p0 - 1 : 0,
      };
    });
    const cols = [["code", "コード"], ["name", "銘柄"], ["sector", "業種"], ["weight", "目標ウェイト"], ["ret", "期間リターン"]];
    sortRows(rows);
    const thead = cols.map(([k, lbl]) =>
      `<th data-k="${k}" class="${sortKey === k ? (sortDir < 0 ? "s-desc" : "s-asc") : ""}">${lbl}</th>`).join("");
    $("#constTable").querySelector("thead").innerHTML = `<tr>${thead}</tr>`;
    const maxW = Math.max(...rows.map((r) => r.weight), 0.0001);
    $("#constTable").querySelector("tbody").innerHTML = rows.map((r) =>
      `<tr><td class="code">${r.code}</td><td style="text-align:left">${r.name}</td><td style="text-align:left"><span class="sec">${r.sector}</span></td>` +
      `<td>${(r.weight * 100).toFixed(1)}%<span class="bar" style="width:${(r.weight / maxW * 46).toFixed(0)}px"></span></td>` +
      `<td class="${r.ret >= 0 ? "up" : "down"}">${signPct(r.ret)}</td></tr>`
    ).join("");
    wireSort(() => renderTableIndex(codes));
  }

  function sortRows(rows) {
    rows.sort((a, b) => {
      let x = a[sortKey], y = b[sortKey];
      if (typeof x === "string") return sortDir * x.localeCompare(y, "ja");
      return sortDir * ((x || 0) - (y || 0));
    });
  }
  function wireSort(rerender) {
    $("#constTable").querySelectorAll("thead th").forEach((th) =>
      th.addEventListener("click", () => {
        const k = th.dataset.k;
        if (sortKey === k) sortDir *= -1; else { sortKey = k; sortDir = -1; }
        rerender();
      })
    );
  }

  // ---------- 保存/呼び出し ----------
  const LS = "jpidx.saved.v1";
  function loadSaved() { try { return JSON.parse(localStorage.getItem(LS)) || []; } catch { return []; } }
  function saveCurrent() {
    const name = $("#saveName").value.trim() || `指数 ${new Date().toLocaleDateString("ja")}`;
    const items = loadSaved();
    items.unshift({
      name, codes: [...state.selected], method: state.method,
      custom: { ...state.custom }, daily: state.daily, mode: state.mode,
    });
    localStorage.setItem(LS, JSON.stringify(items.slice(0, 30)));
    $("#saveName").value = ""; renderSaved(); toast(`「${name}」を保存しました`);
  }
  function renderSaved() {
    const items = loadSaved();
    const el = $("#savedList");
    if (!items.length) { el.innerHTML = '<small>保存した指数がここに並びます</small>'; return; }
    el.innerHTML = "";
    items.forEach((it, i) => {
      const row = document.createElement("div");
      row.className = "saved-item";
      row.innerHTML = `<span class="snm" title="呼び出す">${it.name}</span><small>${it.codes.length}銘柄</small><button title="削除">✕</button>`;
      row.querySelector(".snm").addEventListener("click", () => applySaved(it));
      row.querySelector("button").addEventListener("click", () => {
        const arr = loadSaved(); arr.splice(i, 1); localStorage.setItem(LS, JSON.stringify(arr)); renderSaved();
      });
      el.appendChild(row);
    });
  }
  function applySaved(it) {
    state.selected = new Set(it.codes.filter((c) => state.data.stocks[c]));
    state.method = it.method; state.custom = { ...it.custom };
    state.daily = it.daily || 100; state.mode = it.mode || "dca";
    document.querySelector(`input[name="wm"][value="${state.method}"]`).checked = true;
    $("#dailyAmount").value = state.daily;
    document.querySelectorAll(".mode-tab").forEach((x) => x.classList.toggle("active", x.dataset.mode === state.mode));
    buildStockList(); updateSelCount(); renderCustomPanel(); renderModeUI(); schedule();
    toast(`「${it.name}」を呼び出しました`);
  }

  // ---------- フォーマッタ ----------
  function yen(v) { return "¥" + Math.round(v).toLocaleString("ja"); }
  function signYen(v) { return (v >= 0 ? "+¥" : "−¥") + Math.abs(Math.round(v)).toLocaleString("ja"); }
  function yenShort(v) {
    if (Math.abs(v) >= 1e8) return (v / 1e8).toFixed(1) + "億";
    if (Math.abs(v) >= 1e4) return (v / 1e4).toFixed(1) + "万";
    return Math.round(v).toLocaleString("ja");
  }
  function pct(v) { return (v * 100).toFixed(1) + "%"; }
  function signPct(v) { return (v >= 0 ? "+" : "−") + Math.abs(v * 100).toFixed(1) + "%"; }

  let toastT = null;
  function toast(msg) {
    const t = $("#toast"); t.textContent = msg; t.classList.remove("hidden");
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.add("hidden"), 2200);
  }
})();
