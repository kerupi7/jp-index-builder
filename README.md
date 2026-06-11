# 自作指数ビルダー（JP Index Builder）

日本株を自由に組み合わせて自分だけの株価指数をつくり、**毎日◯円ずつ積立**したら
**日経225を超えられるか**を検証するWebツールＸ。GitHub Pages で静的公開できます。

- **指数モード** … 選んだ銘柄を毎日リバランスした株価指数（始点=100）を日経225・S&P500と比較
- **積立モード** … 毎日定額で買い続けた資産推移を、日経225・S&P500への同額積立と比較
- **チャート単位** … 「資産額(¥)」⇄「リターン(％)」をワンタップ切替。％表示で"何％差か"を直接比較
- **加重方式** … 均等 / 株価 / 時価総額 / カスタム比率 を切替
- データは **Yahoo Finance（無料・登録不要）** から取得 → `data/prices.json` に保存 → サイトはJSONを読むだけ（CORSの問題なし）

> ⚠️ 同梱の `data/prices.json` は動作確認用の **サンプル（乱数）** です。実データは `fetch_data.py` で取得して上書きしてください。

---

## すぐ見る（いちばん簡単）

`preview.html` を**ダブルクリック**してブラウザで開くだけ。サーバー不要・サンプルデータ入りで全機能を試せます。

## ローカルで本物どおりに動かす

ブラウザの仕様上 `data/prices.json` の読み込みには簡易サーバーが必要です。

```bash
cd jp-index-builder
python3 -m http.server 8000
# → ブラウザで http://localhost:8000 を開く
```

## 実データに差し替える

```bash
python3 fetch_data.py            # 直近約5年を取得（標準ライブラリのみ・pip不要）
python3 fetch_data.py --years 10 # 期間を変える
```

`data/prices.json` が実データで上書きされます。サイトを再読み込みすると、右上バッジが
「実データ Yahoo Finance・YYYY-MM-DD 時点」に変わります。

> Yahoo Financeにアクセスが集中するとまれに失敗します。その時は `--sleep 1.5` などで
> 間隔を空けて再実行してください。

---

## GitHub Pages で公開する

1. このフォルダの中身をリポジトリ直下に置いて push
2. GitHub の **Settings → Pages** で「Deploy from a branch」→ `main` / `(root)` を選択
3. 数十秒後、`https://<ユーザー名>.github.io/<リポジトリ名>/` で公開

### データを自動更新する（任意）

`.github/workflows/update-data.yml` を同梱しています。**Settings → Actions → General →
Workflow permissions** を「Read and write」にしておけば、**平日18:00 JST** に
`fetch_data.py` が走り、`data/prices.json` を自動コミットします（手動実行も可）。

---

## 銘柄を追加する

`jp_universe.py` の `UNIVERSE` に1行足すだけ。

```python
("6920", "レーザーテック", "電気機器", 90_000_000),
#  コード   社名            業種         発行済株式数(概算・時価総額加重用)
```

→ `python3 fetch_data.py` を再実行すれば反映されます。
将来、日経225の全構成銘柄を入れれば「日経225そのもの」も再現できます。

比較対象（ベンチマーク）も `jp_universe.py` の `BENCHMARKS` で増やせます（例: NYダウ `^DJI` を追加）。
シンボルはYahoo Finance形式。先頭のシンボルが営業日カレンダーの基準になります。

---

## 加重方式の違い（積立＝毎日の購入額をどう配分するか）

| 方式 | 配分 | 性格 |
|---|---|---|
| **均等加重** | 全銘柄に同額 | 中小型の上昇を拾いやすく、長期で時価総額型を上回りやすい。**日経超えの本命** |
| **株価加重** | 株価に比例 | 日経225と同じ方式。値がさ株の影響が大きい |
| **時価総額加重** | 時価総額に比例 | TOPIX型。大型株中心で指数本体に近い動き（発行株数は概算） |
| **カスタム比率** | 自分で指定 | 実験用。確信のある銘柄を厚くするなど |

## 指標の定義

- **累積リターン / CAGR** … 指数モードの単純騰落率・年率換算
- **年率リターン(IRR)** … 積立モードの資金加重収益率（入金タイミングを考慮した実質年率）
- **最大ドローダウン** … ピークからの最大下落率
- **vs 日経225** … 同条件の日経と比べた超過分

---

## ファイル構成

```
jp-index-builder/
├─ index.html          サイト本体（GitHub Pagesのトップ）
├─ style.css           デザイン
├─ engine.js           指数/積立の計算エンジン（DOM非依存）
├─ app.js              UI制御
├─ data/prices.json    株価データ（最初はサンプル／fetch_data.pyで実データ化）
├─ fetch_data.py       stooqから実データ取得
├─ jp_universe.py      収録銘柄リスト（ここを編集して銘柄追加）
├─ make_sample.py      サンプルデータ生成
├─ preview.html        オフライン単体版（ダブルクリックで開ける）
├─ requirements.txt
├─ .github/workflows/update-data.yml  データ自動更新
└─ （開発用）verify.cjs / smoke.cjs / build_preview.cjs
```

### 開発用テスト

```bash
node verify.cjs          # 計算ロジックの数値検証（依存なし）
npm i jsdom && node smoke.cjs   # ブラウザ相当のUIスモークテスト
node build_preview.cjs   # preview.html を再生成
```

---

## 注意・免責

配当・売買手数料・税金は考慮していません。積立は終値で端株購入できる前提の簡易シミュレーションです。
S&P500は現地通貨(USD)の指数水準で比較しており、為替(USD/JPY)は考慮していません。
時価総額加重の発行済株式数は概算値です。本ツールは情報提供のみを目的とし、投資勧誘・助言ではありません。
データ提供元 Yahoo Finance の精度・可用性についても保証しません。投資判断はご自身の責任で。
