# 保有トラッカー（JP Holdings Tracker）

自分の保有株（**株数・取得単価・取得日**）を入力して、評価額の推移と
**日経225・S&P500とのパフォーマンス比較**を毎日チェックできるWebツール。GitHub Pages で静的公開できます。

- **保有を入力** … 銘柄・株式数・取得単価・取得日を追加（複数ロットOK）
- **増減を毎日チャート** … 評価額／リターン％を時系列で表示
- **指数と比較** … 「同じ資金を同じ取得日に日経225・S&P500へ入れていたら」の価値を並べ、保有が上回っているか一目で
- 保有データは**ブラウザ内(localStorage)だけ**に保存 → 公開リポジトリには出ない（非公開）
- 価格データは **Yahoo Finance（無料）** から取得 → `data/prices.json` に保存 → サイトはJSONを読むだけ（CORS問題なし）

> ⚠️ 同梱の `data/prices.json` は動作確認用の**サンプル（乱数）**の場合があります。実データは `fetch_data.py` で取得して上書きしてください。

---

## すぐ見る

`preview.html` を**ダブルクリック**でブラウザが開き、サンプルデータで全機能を試せます。

## ローカルで本物どおりに動かす

```bash
cd jp-index-builder
python3 -m http.server 8000
# → ブラウザで http://localhost:8000
```

## 実データに差し替える（Yahoo Finance）

```bash
python3 fetch_data.py            # 直近約5年（標準ライブラリ＋curl・pip不要）
python3 fetch_data.py --limit 5  # お試しで先頭5銘柄だけ
```

`data/prices.json` が実データで上書きされ、右上バッジが「実データ Yahoo Finance・YYYY-MM-DD」に変わります。
（取得は内部で `curl` を使います。macOS/Linuxには標準で入っています。）

---

## 使い方

1. 左の「① 保有を追加」で **銘柄／株式数／取得単価／取得日** を入れて「保有を追加」
2. 中央のチャートに **保有・日経225・S&P500** が重なって表示される
3. 右上で **「リターン%」⇄「評価額」** を切替。％表示で、あなたの線が指数の線より上なら指数超え
4. 下の表で銘柄ごとの取得単価・現在値・評価額・含み損益・損益率を確認

「サンプル投入」ボタンで例（約2年前に主要株を各100株購入の想定）をすぐ試せます。

---

## GitHub Pages で公開

1. このフォルダの中身をリポジトリ直下に push
2. **Settings ▸ Pages** で「Deploy from a branch」→ `main` / `(root)`
3. `https://<ユーザー名>.github.io/<リポジトリ名>/` で公開

### データ自動更新（任意）

`.github/workflows/update-data.yml` 同梱。**Settings ▸ Actions ▸ General ▸ Workflow permissions** を
「Read and write」にすると、平日18時(JST)に `fetch_data.py` が走り `data/prices.json` を自動更新します。

---

## 扱える銘柄を増やす

`jp_universe.py` の `UNIVERSE` に1行追加 → `python3 fetch_data.py`。
保有に入れたい銘柄が収録外なら、ここに足してから再取得してください（存在しないコードは自動スキップ）。

比較対象（日経225・S&P500）も `BENCHMARKS` で増減できます（例: NYダウ `^DJI`）。

---

## ファイル構成

```
jp-index-builder/
├─ index.html        サイト本体（保有トラッカー）
├─ style.css         デザイン
├─ engine.js         評価・ベンチ比較の計算（computePortfolio）
├─ app.js            UI制御（保有入力・チャート・テーブル）
├─ data/prices.json  価格データ（fetch_data.pyで実データ化）
├─ fetch_data.py     Yahoo Financeから実データ取得（curl経由）
├─ jp_universe.py    収録銘柄リスト（編集して銘柄追加）
├─ make_sample.py    サンプルデータ生成
├─ preview.html      オフライン単体版（ダブルクリック起動）
├─ .github/workflows/update-data.yml  データ自動更新
└─ （開発用）verify.cjs / smoke.cjs / build_preview.cjs
```

### 開発テスト

```bash
node verify.cjs               # 計算ロジック検証（依存なし）
npm i jsdom && node smoke.cjs # ブラウザ相当のUIスモークテスト
node build_preview.cjs        # preview.html 再生成
```

---

## 注意・免責

配当・売買手数料・税金は考慮していません。評価額＝株数×終値の簡易計算です。
日経225・S&P500との比較は「同じ資金を同じ取得日に各指数へ入れた場合」で、S&P500は現地通貨(USD)指数・為替未考慮。
本ツールは情報提供のみを目的とし、投資勧誘・助言ではありません。データ提供元 Yahoo Finance の精度・可用性も保証しません。投資判断はご自身の責任で。
