# -*- coding: utf-8 -*-
"""
デモ用サンプルデータ生成（合成・乱数）。

実データ取得（fetch_data.py）の前に、サイトの動作を確認するための仮データを作る。
source="SAMPLE" を明記。値はランダムウォークで、実際の株価ではありません。
本番では必ず fetch_data.py を実行して data/prices.json を上書きしてください。
"""
import datetime as dt
import json
import math
import os
import random

from jp_universe import UNIVERSE, BENCHMARKS

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(HERE, "data")

random.seed(42)  # 再現性のため固定

START = dt.date(2021, 6, 1)
END = dt.date(2026, 6, 5)

# おおよその開始株価（雰囲気用・実値ではない）
START_PRICE = {
    "7203": 2000, "6758": 11000, "6861": 50000, "9984": 5500, "8306": 650,
    "9983": 70000, "6098": 5000, "4063": 18000, "8035": 18000, "6501": 5000,
    "9432": 130, "9433": 4000, "4502": 3500, "4519": 3600, "7974": 6000,
    "6902": 1900, "7267": 1300, "8058": 3500, "8001": 3500, "8031": 2800,
    "8316": 4000, "8411": 1500, "6367": 22000, "6594": 12000, "6981": 8000,
    "6954": 22000, "4661": 18000, "9020": 7000, "9022": 16000, "2914": 2200,
    "4568": 2700, "6273": 60000, "7741": 14000, "6920": 18000, "3382": 5500,
    "4543": 4000, "6857": 8000, "8766": 2600, "9434": 1450, "5108": 5000,
}


def trading_days(start, end):
    d, out = start, []
    while d <= end:
        if d.weekday() < 5:  # 月〜金（祝日は簡略化のため無視）
            out.append(d.isoformat())
        d += dt.timedelta(days=1)
    return out


def walk(n, s0, mu_annual, sigma_annual, market):
    """市場(market)にbetaで連動させつつ個別ドリフトを乗せたランダムウォーク。"""
    dt_ = 1 / 252
    beta = random.uniform(0.6, 1.3)
    prices = [s0]
    for t in range(1, n):
        mkt_ret = market[t] / market[t - 1] - 1
        idio = random.gauss(0, sigma_annual * math.sqrt(dt_))
        drift = (mu_annual - 0.5 * sigma_annual ** 2) * dt_
        ret = beta * mkt_ret + drift + idio
        prices.append(round(prices[-1] * (1 + ret), 2))
    return prices


def main():
    dates = trading_days(START, END)
    n = len(dates)

    def gbm(s0, mu, sig):
        s = [s0]
        for _ in range(1, n):
            r = (mu - 0.5 * sig ** 2) / 252 + random.gauss(0, sig / math.sqrt(252))
            s.append(round(s[-1] * (1 + r), 2))
        return s

    # 各ベンチマークを合成。先頭(日経)を個別株のベータ基準に使う。
    BENCH_PARAMS = {
        "^N225":   (28000.0, 0.10, 0.16),
        "^GSPC":   (4250.0,  0.13, 0.15),
        "^IXIC":   (14000.0, 0.16, 0.20),
        "^NDX":    (15000.0, 0.18, 0.22),
        "^NYFANG": (6000.0,  0.22, 0.30),
    }
    benchmarks = {}
    nk = None
    for b in BENCHMARKS:
        sym = b["symbol"].upper()
        s0, mu, sig = BENCH_PARAMS.get(sym, (10000.0, 0.10, 0.18))
        series = gbm(s0, mu, sig)
        if nk is None:
            nk = series
        benchmarks[sym] = {"name": b["name"], "close": series}

    stocks = {}
    for code, name, sector, shares in UNIVERSE:
        s0 = START_PRICE.get(code) or (800 + (int(code) % 12000))  # 未登録コードは適当に散らす
        # 小型〜中型に少し高いドリフトを与え、均等加重が指数を上回りやすい構図にする（デモ）
        # 中小型(株価が低め)にやや高いドリフトを与え、均等加重が指数を上回りやすい構図に（デモ）
        small_tilt = 0.04 if s0 < 5000 else 0.0
        mu = random.uniform(0.05, 0.18) + small_tilt
        sigma = random.uniform(0.22, 0.42)
        stocks[code] = {
            "name": name,
            "sector": sector,
            "shares": shares,
            "close": walk(n, s0, mu, sigma, nk),
        }

    out = {
        "source": "SAMPLE",
        "generated_at": dt.date.today().isoformat(),
        "start": dates[0],
        "end": dates[-1],
        "dates": dates,
        "benchmarks": benchmarks,
        "stocks": stocks,
    }
    os.makedirs(DATA_DIR, exist_ok=True)
    path = os.path.join(DATA_DIR, "prices.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(f"SAMPLE 生成: {path}")
    print(f"  銘柄 {len(stocks)} / 営業日 {n} / {dates[0]}〜{dates[-1]}")


if __name__ == "__main__":
    main()
