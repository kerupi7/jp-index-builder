/* app.js — 保有トラッカー。engine.js(window.Engine) と Chart.js を使う。 */
(function () {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const LS = "jpidx.holdings.v1";
  const SELF_COLOR = "--accent";
  // 日経=amber, S&P=purple, NASDAQ=teal, NASDAQ100=blue, FANG+=pink, 予備=red
  const BENCH_COLORS = ["#f0b429", "#7c5cff", "#22c79a", "#5b8cff", "#e0567c", "#ff5d6c"];

  const state = { data: null, holdings: [], unit: "pct" };
  let chart = null, rafId = null;

  // ---------- 起動 ----------
  if (window.__PRICES__) init(window.__PRICES__);
  else {
    fetch("data/prices.json", { cache: "no-store" })
      .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(init)
      .catch((e) => {
        $("#dataBadge").textContent = "データ読込失敗: data/prices.json";
        $("#dataBadge").className = "badge badge-warn";
        console.error(e);
      });
  }

  function init(data) {
    state.data = data;
    const badge = $("#dataBadge");
    if (data.source && data.source !== "SAMPLE") {
      const nm = { yahoo: "Yahoo Finance", stooq: "stooq" }[data.source] || data.source;
      badge.textContent = `実データ ${nm}・${data.end} 時点`;
      badge.className = "badge badge-ok";
    } else {
      badge.textContent = "サンプルデータ（実データは fetch_data.py で取得）";
      badge.className = "badge badge-warn";
    }

    buildDatalist();
    // 既定の取得日＝当日（ローカル時刻のYYYY-MM-DD）
    const defaultDate = new Date().toLocaleDateString("sv-SE");
    $("#inDate").value = defaultDate;
    if (window.flatpickr) {
      const loc = (window.flatpickr.l10ns && window.flatpickr.l10ns.ja) || "default";
      window.flatpickr("#inDate", {
        dateFormat: "Y-m-d", locale: loc,
        minDate: data.start, maxDate: "today", defaultDate, disableMobile: true,
      });
    }
    state.holdings = loadHoldings();

    wireEvents();
    $("#disclaimer").innerHTML =
      "※ 配当・売買手数料・税金は考慮していません。評価額＝株数×終値。日経225・S&P500のラインは" +
      "「同じ資金を同じ取得日に各指数へ入れていたら」の価値で、あなたの保有がそれを上回れば指数超えです。" +
      "S&P500は現地通貨(USD)指数で為替は未考慮。発行株数等の概算あり。本ツールは情報提供のみ・投資助言ではありません。";
    renderHoldingList();
    schedule();
  }

  function buildDatalist() {
    const dl = $("#tickerList");
    const codes = Object.keys(state.data.stocks).sort();
    dl.innerHTML = codes.map((c) => `<option value="${c} ${state.data.stocks[c].name}"></option>`).join("");
  }

  // 入力文字列から証券コードを解決
  function resolveCode(input) {
    const s = (input || "").trim();
    // 先頭トークン（datalistは "コード 名称" 形式なのでコードが先頭）
    const first = s.split(/\s+/)[0].toUpperCase();
    if (state.data.stocks[first]) return first;
    // 4桁数字コード
    const m = s.match(/\d{4}/);
    if (m && state.data.stocks[m[0]]) return m[0];
    // 新形式の英数字コード（例: 285A）
    const m2 = s.toUpperCase().match(/\b\d{3}[0-9A-Z]\b/);
    if (m2 && state.data.stocks[m2[0]]) return m2[0];
    // 名前一致
    if (s.length >= 2) {
      for (const c in state.data.stocks) if (state.data.stocks[c].name === s) return c;
      for (const c in state.data.stocks) if (state.data.stocks[c].name.includes(s)) return c;
    }
    return null;
  }

  // ---------- 保有の追加・保存 ----------
  function loadHoldings() { try { return JSON.parse(localStorage.getItem(LS)) || []; } catch { return []; } }
  function saveHoldings() { localStorage.setItem(LS, JSON.stringify(state.holdings)); }

  function addHolding() {
    const msg = $("#formMsg");
    const code = resolveCode($("#inTicker").value);
    const shares = parseFloat($("#inShares").value);
    const cost = parseFloat($("#inCost").value);
    const date = $("#inDate").value || state.data.end;
    if (!code) { msg.className = "formmsg err"; msg.textContent = "銘柄が見つかりません（収録外なら jp_universe.py に追加→再取得）"; return; }
    if (!(shares > 0)) { msg.className = "formmsg err"; msg.textContent = "株式数を入力してください"; return; }
    if (!(cost > 0)) { msg.className = "formmsg err"; msg.textContent = "取得単価を入力してください"; return; }
    state.holdings.push({ code, shares, cost, date });
    saveHoldings();
    msg.className = "formmsg ok";
    msg.textContent = `${state.data.stocks[code].name} を追加しました`;
    $("#inTicker").value = ""; $("#inShares").value = ""; $("#inCost").value = "";
    renderHoldingList(); schedule();
  }

  function renderHoldingList() {
    $("#holdCount").textContent = state.holdings.length;
    const el = $("#holdingList");
    if (!state.holdings.length) {
      el.innerHTML = '<div class="holding-empty">まだ保有がありません。上で追加するか「サンプル投入」を押してください。</div>';
      return;
    }
    el.innerHTML = "";
    state.holdings.forEach((h, i) => {
      const nm = state.data.stocks[h.code] ? state.data.stocks[h.code].name : h.code;
      const row = document.createElement("div");
      row.className = "holding-item";
      row.innerHTML =
        `<span class="h-nm">${h.code} ${nm}</span>` +
        `<button class="h-del" title="削除">✕</button>` +
        `<span class="h-sub">${fmtShares(h.shares)}株 × ¥${Math.round(h.cost).toLocaleString()} ・ ${h.date}</span>`;
      row.querySelector(".h-del").addEventListener("click", () => {
        state.holdings.splice(i, 1); saveHoldings(); renderHoldingList(); schedule();
      });
      el.appendChild(row);
    });
  }

  function loadSample() {
    const E = window.Engine, d = state.data;
    const idx = Math.max(0, d.dates.length - 500); // 約2年前
    const date = d.dates[idx];
    const picks = ["7203", "6758", "9984", "8035", "9432"].filter((c) => d.stocks[c]);
    state.holdings = picks.map((c) => ({
      code: c, shares: 100,
      cost: Math.round((E.priceAt(d, c, idx) || 1000) * 100) / 100,
      date,
    }));
    saveHoldings(); renderHoldingList(); schedule();
    toast("サンプル保有を入れました（約2年前に各100株購入の想定）");
  }

  // ---------- イベント ----------
  function wireEvents() {
    $("#btnAdd").addEventListener("click", addHolding);
    $("#inCost").addEventListener("keydown", (e) => { if (e.key === "Enter") addHolding(); });
    $("#btnSample").addEventListener("click", loadSample);
    $("#btnClearAll").addEventListener("click", () => {
      if (!state.holdings.length) return;
      state.holdings = []; saveHoldings(); renderHoldingList(); schedule();
    });
    document.querySelectorAll("#unitToggle button").forEach((b) =>
      b.addEventListener("click", () => {
        state.unit = b.dataset.unit;
        document.querySelectorAll("#unitToggle button").forEach((x) => x.classList.toggle("active", x === b));
        schedule();
      })
    );
    $("#btnShot").addEventListener("click", () => {
      const on = document.body.classList.toggle("shot-mode");
      $("#btnShot").textContent = on ? "✓ 通常に戻す" : "📷 撮影モード";
      setTimeout(() => { if (chart) chart.resize(); }, 60); // レイアウト変化にチャートを合わせる
    });
  }

  // ---------- 計算＆描画 ----------
  function schedule() { if (rafId) cancelAnimationFrame(rafId); rafId = requestAnimationFrame(run); }

  function run() {
    const E = window.Engine;
    const pf = state.holdings.length ? E.computePortfolio(state.data, state.holdings) : null;
    if (!pf) { renderEmpty(); return; }
    const n = pf.value.length;
    const costF = pf.cost[n - 1], valF = pf.value[n - 1];
    const pRet = costF > 0 ? valF / costF - 1 : 0;

    const chips = [{ label: "保有", color: col(SELF_COLOR), pct: pRet, sub: yen(valF) }];
    pf.benches.forEach((b, k) => {
      const bf = b.value[n - 1], bRet = costF > 0 ? bf / costF - 1 : 0;
      chips.push({ label: b.name, color: col(BENCH_COLORS[k % BENCH_COLORS.length]), pct: bRet, sub: ppGap(pRet - bRet) });
    });
    renderCompare(chips);
    renderStatLine([
      ["投資額", yen(costF)], ["評価額", yen(valF)], ["含み損益", signYen(valF - costF)],
      ["損益率", signPct(pRet)], ["期間", `${n.toLocaleString()}営業日`],
    ]);

    let datasets, yFmt, note;
    if (state.unit === "pct") {
      const toPct = (arr) => arr.map((v, i) => (pf.cost[i] > 0 ? (v / pf.cost[i] - 1) * 100 : 0));
      datasets = [line("保有", toPct(pf.value), SELF_COLOR, false)];
      pf.benches.forEach((b, k) => datasets.push(line(b.name, toPct(b.value), BENCH_COLORS[k % BENCH_COLORS.length], false)));
      yFmt = (v) => (v >= 0 ? "+" : "") + v.toFixed(0) + "%";
      note = "元本に対するリターン％（同じ資金を同じ取得日に各指数へ入れた場合と比較）";
    } else {
      datasets = [line("保有評価額", pf.value, SELF_COLOR, false), line("投資元本", pf.cost, "--mut2", true)];
      pf.benches.forEach((b, k) => datasets.push(line(`${b.name}に同額`, b.value, BENCH_COLORS[k % BENCH_COLORS.length], false)));
      yFmt = (v) => yenShort(v);
      note = "実線=評価額／点線=投じた元本";
    }
    try { drawChart(pf.dates, datasets, yFmt); $("#chartLegendNote").textContent = note; }
    catch (e) { console.error("chart error", e); }
    renderHoldingsTable(pf, valF);
  }

  function renderEmpty() {
    $("#compareStrip").innerHTML = '<div class="cmp"><span class="dot" style="--c:var(--mut2)"></span><div class="cmp-body"><span class="cmp-label">保有未入力</span><span class="cmp-sub">左で保有を追加してください</span></div></div>';
    $("#statLine").innerHTML = "";
    $("#holdingsTable").querySelector("thead").innerHTML = "";
    $("#holdingsTable").querySelector("tbody").innerHTML = "";
    if (chart) { chart.destroy(); chart = null; }
  }

  // ---------- 比較チップ・統計行 ----------
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
  function ppGap(d) { return "保有と " + (d >= 0 ? "+" : "−") + Math.abs(d * 100).toFixed(2) + "%pt"; }

  // ---------- チャート ----------
  function cssVar(name) { return getComputedStyle(document.body).getPropertyValue(name).trim(); }
  function col(c) { return c && c.charAt(0) === "-" ? cssVar(c) : c; } // 変数名(--x)なら解決、hexはそのまま
  function line(label, data, c, dashed) { return { label, data, color: col(c), dashed }; }
  function drawChart(dates, lines, yFmt) {
    const pr = dates.length <= 4 ? 3 : 0; // 点が少ない時は見えるように丸を出す
    const datasets = lines.map((l) => ({
      label: l.label, data: l.data, borderColor: l.color, backgroundColor: l.color + "22",
      borderWidth: l.dashed ? 1.5 : 2, borderDash: l.dashed ? [5, 4] : [], pointRadius: pr, tension: 0.08, fill: false,
    }));
    const opts = {
      responsive: true, maintainAspectRatio: false, animation: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { labels: { color: cssVar("--mut"), boxWidth: 14, font: { size: 12 } } },
        tooltip: { callbacks: { title: (it) => dates[it[0].dataIndex], label: (it) => `${it.dataset.label}: ${yFmt(it.parsed.y)}` } },
      },
      scales: {
        x: { ticks: { color: cssVar("--mut2"), maxTicksLimit: 8, autoSkip: true }, grid: { color: "rgba(42,50,82,.35)" } },
        y: { ticks: { color: cssVar("--mut2"), callback: yFmt }, grid: { color: "rgba(42,50,82,.35)" } },
      },
    };
    if (chart) { chart.data.labels = dates; chart.data.datasets = datasets; chart.options = opts; chart.update(); }
    else chart = new Chart($("#mainChart"), { type: "line", data: { labels: dates, datasets }, options: opts });
  }

  // ---------- 保有テーブル ----------
  let sortKey = "value", sortDir = -1;
  function renderHoldingsTable(pf, total) {
    const rows = pf.perHolding.map((r) => ({ ...r, weight: total > 0 ? r.value / total : 0 }));
    const cols = [
      ["code", "コード"], ["name", "銘柄"], ["shares", "株数"], ["cost", "取得単価"], ["date", "取得日"],
      ["price", "現在値"], ["value", "評価額"], ["pl", "含み損益"], ["ret", "損益率"], ["weight", "比率"],
    ];
    rows.sort((a, b) => {
      const x = a[sortKey], y = b[sortKey];
      if (typeof x === "string") return sortDir * String(x).localeCompare(String(y), "ja");
      return sortDir * ((x || 0) - (y || 0));
    });
    const thead = cols.map(([k, l]) => `<th data-k="${k}" class="${sortKey === k ? (sortDir < 0 ? "s-desc" : "s-asc") : ""}">${l}</th>`).join("");
    $("#holdingsTable").querySelector("thead").innerHTML = `<tr>${thead}</tr>`;
    const maxW = Math.max(...rows.map((r) => r.weight), 0.0001);
    $("#holdingsTable").querySelector("tbody").innerHTML = rows.map((r) =>
      `<tr><td class="code">${r.code}</td><td style="text-align:left">${r.name}</td>` +
      `<td>${fmtShares(r.shares)}</td><td>${yen(r.cost)}</td><td>${r.date}</td>` +
      `<td>${r.price !== null ? yen(r.price) : "—"}</td><td>${yen(r.value)}</td>` +
      `<td class="${r.pl >= 0 ? "up" : "down"}">${signYen(r.pl)}</td>` +
      `<td class="${r.ret >= 0 ? "up" : "down"}">${signPct(r.ret)}</td>` +
      `<td>${(r.weight * 100).toFixed(1)}%<span class="bar" style="width:${(r.weight / maxW * 44).toFixed(0)}px"></span></td></tr>`
    ).join("");
    $("#holdingsTable").querySelectorAll("thead th").forEach((th) =>
      th.addEventListener("click", () => {
        const k = th.dataset.k;
        if (sortKey === k) sortDir *= -1; else { sortKey = k; sortDir = -1; }
        renderHoldingsTable(pf, total);
      })
    );
  }

  // ---------- フォーマッタ ----------
  function yen(v) { return "¥" + Math.round(v).toLocaleString("ja"); }
  function signYen(v) { return (v >= 0 ? "+¥" : "−¥") + Math.abs(Math.round(v)).toLocaleString("ja"); }
  function yenShort(v) {
    if (Math.abs(v) >= 1e8) return (v / 1e8).toFixed(2) + "億";
    if (Math.abs(v) >= 1e4) return (v / 1e4).toFixed(1) + "万";
    return Math.round(v).toLocaleString("ja");
  }
  function pct(v) { return (v * 100).toFixed(2) + "%"; }
  function signPct(v) { return (v >= 0 ? "+" : "−") + Math.abs(v * 100).toFixed(2) + "%"; }
  // 株数: 整数はそのまま、小数はフル桁(最大8桁)で表示
  function fmtShares(v) { return Number.isInteger(v) ? v.toLocaleString("ja") : v.toLocaleString("ja", { maximumFractionDigits: 8 }); }

  let toastT = null;
  function toast(msg) {
    const t = $("#toast"); t.textContent = msg; t.classList.remove("hidden");
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.add("hidden"), 2400);
  }
})();
