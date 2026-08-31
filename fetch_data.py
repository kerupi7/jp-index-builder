# -*- coding: utf-8 -*-
"""
実データ取得スクリプト（Yahoo Finance・無料・登録不要）。

  $ python3 fetch_data.py             # 直近約5年を取得
  $ python3 fetch_data.py --years 10  # 期間を変える
  $ python3 fetch_data.py --limit 5   # お試しで先頭5銘柄だけ

仕組み:
  Pythonのurllibだとなぜか 429（Too Many Requests）で弾かれるが、システムの curl は通る。
  そこで実際の取得は subprocess で curl を呼ぶ（macOS/Linuxには標準で入っている）。
  取得したJSONをPythonで整形し、日経225の営業日に揃えて data/prices.json に保存する。

依存: 標準ライブラリ＋システムの curl のみ（pip install 不要）。
"""
import argparse
import bisect
import datetime as dt
import json
import os
import subprocess
import sys
import time
import urllib.parse

from jp_universe import UNIVERSE, BENCHMARKS

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(HERE, "data")
UA = "Mozilla/5.0"  # 手動curlで通ったのと同じ最小UA


def curl_json(url, timeout=40):
    """システムのcurlでURLを取得しJSONを返す。 (payload, err) を返す。"""
    try:
        p = subprocess.run(
            ["curl", "-s", "--max-time", str(timeout), "-A", UA, url],
            capture_output=True, timeout=timeout + 5)
    except FileNotFoundError:
        return None, "curlが見つかりません（macOS/Linuxには通常入っています）"
    except subprocess.TimeoutExpired:
        return None, "タイムアウト"
    body = p.stdout.decode("utf-8", "replace").strip()
    if not body:
        return None, "空応答"
    try:
        return json.loads(body), None
    except ValueError:
        return None, f"JSON解析失敗(先頭: {body[:50]!r})"


# 日足が欠測した日を埋めるために使う分足の候補（interval, range）。
# Yahooの取得可能期間: 5分足=約60日 / 1時間足=約730日。新しい穴ほど細かい足で埋まる。
INTRADAY_FALLBACKS = [("5m", "60d"), ("1h", "730d")]


def fetch_intraday_daily(symbol, interval, rng, timeout=40):
    """分足を日単位に畳んで {日付: その日の最終終値} を返す。失敗時は空dict。

    日足(interval=1d)がYahoo側の不具合で null になる日がある（2026-08-28 の
    ^N225 / ^GSPC / ^NDX / ^NYFANG が実例。個別株は無事だった）。その日の値を
    分足から拾い直すために使う。日足との差は実測で最大0.017%。
    """
    url = (f"https://query1.finance.yahoo.com/v8/finance/chart/"
           f"{urllib.parse.quote(symbol)}?range={rng}&interval={interval}")
    payload, _err = curl_json(url, timeout=timeout)
    if payload is None:
        return {}
    result = ((payload.get("chart") or {}).get("result") or [None])[0]
    if not result or not result.get("timestamp"):
        return {}
    ts = result["timestamp"]
    gmt = (result.get("meta") or {}).get("gmtoffset", 0) or 0
    try:
        closes = result["indicators"]["quote"][0]["close"]
    except (KeyError, IndexError, TypeError):
        return {}
    out = {}
    for t, c in zip(ts, closes):
        if c is None:
            continue
        out[dt.datetime.utcfromtimestamp(t + gmt).strftime("%Y-%m-%d")] = float(c)
    return out


def fetch_yahoo(symbol, rng, retries=4, sleep=1.0, adj=False):
    """Yahoo Financeの日足を取得して (rows, gaps) を返す。失敗時は ([], {...})。

    rows は [(date, close), ...] の昇順。
    gaps は {"filled": [(date, interval), ...], "unfilled": [date, ...]}。
    終値が null の日は日付ごと捨てず、分足→前日値の順で必ず埋めて日付を残す。
    捨てると営業日カレンダー（先頭の日経225が基準）から日が消え、下流が1日古い値を読む。
    adj=True なら調整後終値(adjclose)を優先（ETF/個別の分割・配当補正用）。指数は通常adjclose無し→closeに自動フォールバック。"""
    url = (f"https://query1.finance.yahoo.com/v8/finance/chart/"
           f"{urllib.parse.quote(symbol)}?range={rng}&interval=1d")
    for attempt in range(1, retries + 1):
        payload, err = curl_json(url)
        if payload is None:
            print(f"    ! {symbol}: {err} 再試行 {attempt}/{retries}")
            time.sleep(sleep * attempt)
            continue
        chart = payload.get("chart") or {}
        if chart.get("error"):
            print(f"    ! {symbol}: APIエラー({chart['error']}) 再試行 {attempt}/{retries}")
            time.sleep(sleep * attempt)
            continue
        result = (chart.get("result") or [None])[0]
        if not result or not result.get("timestamp"):
            print(f"    ! {symbol}: データなし 再試行 {attempt}/{retries}")
            time.sleep(sleep * attempt)
            continue

        ts = result["timestamp"]
        gmt = (result.get("meta") or {}).get("gmtoffset", 0) or 0
        ind = result.get("indicators") or {}
        closes = None
        if adj:  # 調整後終値を優先（分割・配当補正）
            try:
                closes = ind["adjclose"][0]["adjclose"]
            except (KeyError, IndexError, TypeError):
                closes = None
        if closes is None:
            try:
                closes = ind["quote"][0]["close"]
            except (KeyError, IndexError, TypeError):
                print(f"    ! {symbol}: 終値フィールドなし 再試行 {attempt}/{retries}")
                time.sleep(sleep * attempt)
                continue

        by_date, holes = {}, []
        for t, c in zip(ts, closes):
            d = dt.datetime.utcfromtimestamp(t + gmt).strftime("%Y-%m-%d")
            if c is None:
                holes.append(d)   # 立会はあったが値が来ていない日
                continue
            by_date[d] = float(c)
        holes = [d for d in holes if d not in by_date]

        filled = []
        if holes and by_date:
            for interval, irng in INTRADAY_FALLBACKS:
                remaining = [d for d in holes if d not in by_date]
                if not remaining:
                    break
                print(f"    ~ {symbol}: 日足が空の日 {', '.join(remaining)} を{interval}で補完中...")
                intraday = fetch_intraday_daily(symbol, interval, irng)
                for d in remaining:
                    if d in intraday:
                        by_date[d] = intraday[d]
                        filled.append((d, interval))
                time.sleep(sleep)
        unfilled = [d for d in holes if d not in by_date]
        if unfilled and by_date:
            # 分足でも取れない古い穴。前日終値で埋めて「日付だけは残す」。
            known = sorted(by_date)
            for d in unfilled:
                k = bisect.bisect_left(known, d)
                if k > 0:
                    by_date[d] = by_date[known[k - 1]]
            print(f"    ! {symbol}: 分足でも埋まらない日 {', '.join(unfilled)} → 前日終値で代用")

        rows = sorted(by_date.items())
        if rows:
            return rows, {"filled": filled, "unfilled": unfilled}
        time.sleep(sleep * attempt)
    return [], {"filled": [], "unfilled": []}


def years_to_range(y):
    for lim, name in [(1, "1y"), (2, "2y"), (5, "5y"), (10, "10y")]:
        if y <= lim:
            return name
    return "max"


def align(master_dates, rows):
    """master_dates の各日に「その日以前で最新の終値」を割り当てる（as-of 結合）。

    日本の営業日カレンダーに海外指数(S&P500等)を載せる際、日本が休みの日の
    海外セッションを取りこぼさないよう、日付の完全一致ではなく「その日までで最新」を採る。
    欠損日は直近営業日の終値で前方補完。データ開始前(先頭)は None。
    rows は (date, close) の昇順リストを想定。
    """
    rows = sorted(rows)
    out, last, j, n = [], None, 0, len(rows)
    for d in master_dates:
        while j < n and rows[j][0] <= d:
            last = rows[j][1]
            j += 1
        out.append(last)
    return out


# 株式分割の段差を後方調整するための分割比候補（順分割と逆分割の両方）。
_SPLIT_FACTORS = [2, 3, 4, 5, 6, 7, 8, 10, 12, 15, 20, 25, 30, 50, 100,
                  1 / 2, 1 / 3, 1 / 4, 1 / 5, 1 / 6, 1 / 8, 1 / 10, 1 / 20,
                  3 / 2, 5 / 2, 4 / 3, 5 / 4, 5 / 3, 10 / 3]


def _nearest_split_factor(r, tol=0.05):
    """日次比 r が分割比 1/f に近ければ分割係数 f を返す。該当なしは None。"""
    inv = 1.0 / r
    best, best_err = None, tol
    for f in _SPLIT_FACTORS:
        err = abs(inv - f) / f
        if err < best_err:
            best, best_err = f, err
    return best


def backadjust_splits(close):
    """終値系列の株式分割の段差を後方調整して連続にする。

    Yahooの調整後終値が直近の分割を反映しきれていない場合の保険。1日で±48%超
    かつ比率が単純な分割比(1:2, 1:10 など)に一致する段差だけを分割とみなし、
    その日より前の値を分割係数で割って（逆分割なら掛けて）スケールを揃える。
    通常の値動きや、分割比に一致しない急変（決算ギャップ等）は変更しない。
    """
    out = list(close)
    for i in range(1, len(close)):
        a, b = close[i - 1], close[i]  # 検出は常に元系列の比で行う
        if not a or not b:
            continue
        r = b / a
        if 0.66 < r < 1.52:  # 通常の値動き（±約50%以内）はスキップ
            continue
        f = _nearest_split_factor(r)
        if not f:
            continue  # 大きく動いたが分割比に一致しない → 実際の変動として保持
        for j in range(i):  # 段差より前を分割係数で後方調整
            if out[j] is not None:
                out[j] = out[j] / f
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--years", type=float, default=5, help="取得年数 (default 5)")
    ap.add_argument("--sleep", type=float, default=1.0, help="リクエスト間の待機秒 (default 1.0)")
    ap.add_argument("--limit", type=int, default=0, help="取得銘柄数の上限（0=全部・お試しは5など）")
    args = ap.parse_args()
    universe = UNIVERSE if args.limit <= 0 else UNIVERSE[:args.limit]
    rng = years_to_range(args.years)

    today = dt.date.today()
    print(f"取得期間: range={rng}（約{args.years}年・Yahoo Finance / curl経由）")

    # 日足が空だった日の記録。unfilled が残った週は下流（土曜まとめ）が生成を止める。
    gaps_filled, gaps_unfilled = [], []

    def note_gaps(symbol, g):
        for d, iv in g["filled"]:
            gaps_filled.append({"symbol": symbol, "date": d, "interval": iv})
        for d in g["unfilled"]:
            gaps_unfilled.append({"symbol": symbol, "date": d})

    # 1) ベンチマーク。先頭(日経225)が営業日カレンダーの基準。
    benchmarks = {}
    master_dates = None
    for j, b in enumerate(BENCHMARKS):
        print(f"[bench {j + 1}/{len(BENCHMARKS)}] {b['name']} ({b['symbol']}) 取得中...")
        rows, gaps = fetch_yahoo(b["symbol"], rng, sleep=args.sleep, adj=True)
        note_gaps(b["symbol"], gaps)
        if not rows:
            if j == 0:
                print("致命的: 基準ベンチ(日経225)を取得できませんでした。")
                print("  → 手動で `curl -s -A \"Mozilla/5.0\" \"https://query1.finance.yahoo.com/v8/finance/chart/%5EN225?range=5d&interval=1d\" | head -c 80` が通るか確認してください。")
                sys.exit(1)
            print(f"    -> スキップ（{b['name']}取得失敗）")
            continue
        if master_dates is None:
            master_dates = [d for d, _ in rows]
            close = [c for _, c in rows]
            print(f"  営業日数: {len(master_dates)}")
        else:
            close = align(master_dates, rows)
        # 分割段差の保険（1306.T等のETFは調整漏れが起きうる。指数は段差なしで素通り）
        close = backadjust_splits(close)
        benchmarks[b["symbol"].upper()] = {"name": b["name"], "close": close}
        time.sleep(args.sleep)

    # 2) 各銘柄（コード.T）
    stocks = {}
    for i, (code, name, sector, shares) in enumerate(universe, 1):
        sym = f"{code}.T"
        print(f"[{i}/{len(universe)}] {code} {name} 取得中...")
        rows, gaps = fetch_yahoo(sym, rng, sleep=args.sleep)
        note_gaps(sym, gaps)
        if not rows:
            print(f"    -> スキップ（データ取得失敗）")
            continue
        stocks[code] = {
            "name": name, "sector": sector, "shares": shares,
            "close": align(master_dates, rows),
        }
        time.sleep(args.sleep)

    out = {
        "source": "yahoo",
        "generated_at": today.isoformat(),
        "start": master_dates[0],
        "end": master_dates[-1],
        "dates": master_dates,
        "benchmarks": benchmarks,
        "stocks": stocks,
        "gaps_filled": gaps_filled,
        "gaps_unfilled": gaps_unfilled,
    }
    os.makedirs(DATA_DIR, exist_ok=True)
    path = os.path.join(DATA_DIR, "prices.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    if gaps_filled:
        print(f"\n補完: 日足が空だった {len(gaps_filled)} 件を分足で埋めました")
        for g in gaps_filled:
            print(f"    {g['date']} {g['symbol']} ({g['interval']})")
    if gaps_unfilled:
        print(f"\n警告: 埋められなかった欠測 {len(gaps_unfilled)} 件（前日終値で代用）")
        for g in gaps_unfilled:
            print(f"    {g['date']} {g['symbol']}")
    print(f"\n完了: {path}")
    print(f"  銘柄数 {len(stocks)} / ベンチ {', '.join(b['name'] for b in BENCHMARKS if b['symbol'].upper() in benchmarks)}"
          f" / 営業日 {len(master_dates)} / {out['start']}〜{out['end']}")


if __name__ == "__main__":
    main()
