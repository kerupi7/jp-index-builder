/* build_preview.cjs — engine.js/app.js/style.css と data/prices.json から、
 * サーバー不要・ダブルクリックで開ける単体HTML(preview.html)を生成する（開発用）。
 *   $ node build_preview.cjs
 */
const fs = require("fs");
const path = require("path");
const dir = __dirname;
const R = (f) => fs.readFileSync(path.join(dir, f), "utf8");

const style = R("style.css");
const engine = R("engine.js");
const app = R("app.js");
const data = JSON.parse(R("data/prices.json"));

// 週次に間引いてサイズを縮小（プレビュー用途）
const step = 5;
const keep = [];
for (let i = 0; i < data.dates.length; i += step) keep.push(i);
if (keep[keep.length - 1] !== data.dates.length - 1) keep.push(data.dates.length - 1);
const pick = (arr) => keep.map((i) => arr[i]);

const small = {
  source: "SAMPLE", generated_at: data.generated_at,
  start: data.dates[keep[0]], end: data.dates[keep[keep.length - 1]],
  dates: pick(data.dates),
  benchmarks: {},
  stocks: {},
};
for (const sym in data.benchmarks) {
  small.benchmarks[sym] = { name: data.benchmarks[sym].name, close: pick(data.benchmarks[sym].close) };
}
for (const c in data.stocks) {
  const s = data.stocks[c];
  small.stocks[c] = { name: s.name, sector: s.sector, shares: s.shares, close: pick(s.close) };
}

// index.html の body を流用せず、ここで最小マークアップを再掲（index.htmlと同一ID）
const body = R("index.html")
  .replace(/^[\s\S]*?<body>/, "")
  .replace(/<\/body>[\s\S]*$/, "");

const out = `<!DOCTYPE html>
<html lang="ja"><head><meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>自作指数ビルダー（オフライン・プレビュー）</title>
<style>${style}</style>
</head><body>
${body}
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.3/chart.umd.min.js"></script>
<script>window.__PRICES__=${JSON.stringify(small)};</script>
<script>${engine}</script>
<script>${app}</script>
</body></html>`;

fs.writeFileSync(path.join(dir, "preview.html"), out);
const kb = (Buffer.byteLength(out) / 1024).toFixed(0);
console.log(`preview.html 生成: ${kb}KB / ${small.dates.length}点 × ${Object.keys(small.stocks).length}銘柄`);
