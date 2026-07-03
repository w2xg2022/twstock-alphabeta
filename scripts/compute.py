#!/usr/bin/env python3
"""下載台股還原(權息調整後)股價，計算60/120/240交易日的alpha/beta，輸出 docs/data/alphabeta.json"""
import csv
import json
import sys
import time
from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd
import requests
import yfinance as yf

WINDOWS = (60, 120, 240)
PERIOD = "18mo"  # 240個交易日約需11~12個月，多留緩衝
CHUNK_SIZE = 100
# 大盤基準改用FinMind(TaiwanStockPrice)，因為yfinance的^TWII/^TWOII指數資料常常落後或不完整
# (實測^TWOII常卡在好幾天前，個股本身資料是新的)；個股價格仍用yfinance還原價
BENCHMARKS = {"TWSE": "TAIEX", "OTC": "TPEx"}
FINMIND_URL = "https://api.finmindtrade.com/api/v4/data"
ANNUALIZE_DAYS = 252
RISK_FREE_RATE = 0.015  # 約略無風險利率，CAPM期望報酬率用

# 軌跡圖：最近60個交易日，每個交易日取一個點
TRAJECTORY_POINTS = 60


def load_stock_list(path: str = "data/stock_list.csv") -> list[dict]:
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def fetch_close(tickers: list[str], retries: int = 3) -> pd.DataFrame:
    """批次下載多檔ticker的還原收盤價，回傳 DataFrame(columns=ticker, index=date)"""
    last_err = None
    for attempt in range(retries):
        try:
            data = yf.download(
                tickers=tickers,
                period=PERIOD,
                interval="1d",
                auto_adjust=True,
                group_by="ticker",
                threads=False,
                progress=False,
            )
            if len(tickers) == 1:
                t = tickers[0]
                if "Close" not in data.columns:
                    return pd.DataFrame()
                return data[["Close"]].rename(columns={"Close": t})
            closes = {}
            for t in tickers:
                if t in data.columns.get_level_values(0):
                    closes[t] = data[t]["Close"]
            return pd.DataFrame(closes)
        except Exception as e:  # noqa: BLE001
            last_err = e
            time.sleep(3 * (attempt + 1))
    print(f"警告: 批次下載失敗 {tickers[:3]}...: {last_err}", file=sys.stderr)
    return pd.DataFrame()


def fetch_finmind_index(data_id: str, start_date: str, retries: int = 3) -> pd.Series:
    """從FinMind抓大盤指數收盤價(TAIEX=加權指數, TPEx=櫃買指數)，回傳Series(index=date)"""
    last_err = None
    for attempt in range(retries):
        try:
            resp = requests.get(
                FINMIND_URL,
                params={"dataset": "TaiwanStockPrice", "data_id": data_id, "start_date": start_date},
                timeout=30,
            )
            resp.raise_for_status()
            data = resp.json().get("data", [])
            if not data:
                raise RuntimeError("FinMind回傳無資料")
            df = pd.DataFrame(data)
            df["date"] = pd.to_datetime(df["date"])
            return df.set_index("date")["close"].sort_index()
        except Exception as e:  # noqa: BLE001
            last_err = e
            time.sleep(3 * (attempt + 1))
    print(f"警告: FinMind下載失敗 {data_id}: {last_err}", file=sys.stderr)
    return pd.Series(dtype=float)


def chunked(seq: list, size: int):
    for i in range(0, len(seq), size):
        yield seq[i:i + size]


def regress(stock_ret: np.ndarray, mkt_ret: np.ndarray, n: int):
    if len(stock_ret) < n or len(mkt_ret) < n:
        return None, None
    s = stock_ret[-n:]
    m = mkt_ret[-n:]
    if np.std(m) == 0:
        return None, None
    beta, alpha_daily = np.polyfit(m, s, 1)
    alpha_annual = alpha_daily * ANNUALIZE_DAYS
    return round(float(beta), 4), round(float(alpha_annual), 4)


def regress_point(s_win: np.ndarray, m_win: np.ndarray):
    if len(s_win) < 2 or len(m_win) < 2 or np.std(m_win) == 0:
        return None, None
    beta, alpha_daily = np.polyfit(m_win, s_win, 1)
    alpha_annual = alpha_daily * ANNUALIZE_DAYS
    return round(float(beta), 4), round(float(alpha_annual), 4)


def expected_return(beta, m_win: np.ndarray):
    """CAPM期望報酬率(年化): Rf + beta * (大盤年化報酬 - Rf)"""
    if beta is None:
        return None
    mkt_annual = float(np.mean(m_win)) * ANNUALIZE_DAYS
    return round(RISK_FREE_RATE + beta * (mkt_annual - RISK_FREE_RATE), 4)


def compute_trajectory(s_ret: np.ndarray, m_ret: np.ndarray):
    """回傳最近TRAJECTORY_POINTS個交易日、每日的 beta / CAPM期望報酬率，每個window各一組序列
    （不足TRAJECTORY_POINTS天的用None左補齊，方便跟全域日期陣列對齊）"""
    total = len(s_ret)
    start = max(0, total - TRAJECTORY_POINTS)
    anchors = list(range(start + 1, total + 1))
    if not anchors:
        return None

    traj = {}
    has_any = False
    for n in WINDOWS:
        betas, alphas, ers = [], [], []
        for idx in anchors:
            if idx < n:
                betas.append(None)
                alphas.append(None)
                ers.append(None)
                continue
            s_win = s_ret[idx - n:idx]
            m_win = m_ret[idx - n:idx]
            beta, alpha = regress_point(s_win, m_win)
            betas.append(beta)
            alphas.append(alpha)
            ers.append(expected_return(beta, m_win))
            has_any = has_any or beta is not None
        pad = TRAJECTORY_POINTS - len(betas)
        if pad > 0:
            betas = [None] * pad + betas
            alphas = [None] * pad + alphas
            ers = [None] * pad + ers
        traj[f"beta{n}"] = betas
        traj[f"alpha{n}"] = alphas
        traj[f"er{n}"] = ers
    return traj if has_any else None


def main() -> int:
    stocks = load_stock_list()
    if not stocks:
        print("data/stock_list.csv 是空的，先跑 fetch_list.py", file=sys.stderr)
        return 1

    print("下載大盤基準資料(FinMind)...")
    start_date = (datetime.now(timezone.utc) - timedelta(days=560)).strftime("%Y-%m-%d")
    bench_ret = {}
    trajectory_dates = {}
    for market, data_id in BENCHMARKS.items():
        series = fetch_finmind_index(data_id, start_date)
        if not series.empty:
            bench_ret[market] = series
            bench_ret_series = series.pct_change().dropna()
            tail = bench_ret_series.index[-TRAJECTORY_POINTS:]
            trajectory_dates[market] = [d.strftime("%Y-%m-%d") for d in tail]
        else:
            print(f"警告: 大盤基準 {data_id} 下載失敗", file=sys.stderr)
            bench_ret[market] = pd.Series(dtype=float)
            trajectory_dates[market] = []

    results = []
    trajectories = {}
    tickers = [s["ticker"] for s in stocks]
    by_ticker = {s["ticker"]: s for s in stocks}
    total_chunks = (len(tickers) + CHUNK_SIZE - 1) // CHUNK_SIZE

    for idx, chunk in enumerate(chunked(tickers, CHUNK_SIZE), start=1):
        print(f"下載股價批次 {idx}/{total_chunks} ({len(chunk)} 檔)...")
        close_df = fetch_close(chunk)
        if close_df.empty:
            time.sleep(2)
            continue

        for ticker in chunk:
            if ticker not in close_df.columns:
                continue
            info = by_ticker[ticker]
            market = info["market"]
            mkt_close = bench_ret.get(market)
            if mkt_close is None or mkt_close.empty:
                continue

            stock_close = close_df[ticker].dropna()
            merged = pd.concat(
                [stock_close.rename("s"), mkt_close.rename("m")], axis=1, join="inner"
            ).dropna()
            if len(merged) < min(WINDOWS) + 1:
                continue

            s_ret_series = merged["s"].pct_change().dropna()
            m_ret_series = merged["m"].pct_change().dropna()
            s_ret = s_ret_series.to_numpy()
            m_ret = m_ret_series.to_numpy()

            row = {
                "code": info["code"],
                "name": info["name"],
                "market": market,
                "ticker": ticker,
                "as_of": merged.index[-1].strftime("%Y-%m-%d"),
            }
            has_any = False
            for n in WINDOWS:
                beta, alpha = regress(s_ret, m_ret, n)
                row[f"beta{n}"] = beta
                row[f"alpha{n}"] = alpha
                row[f"er{n}"] = expected_return(beta, m_ret[-n:]) if beta is not None and len(m_ret) >= n else None
                has_any = has_any or beta is not None
            if has_any:
                results.append(row)

            traj = compute_trajectory(s_ret, m_ret)
            if traj is not None:
                trajectories[info["code"]] = traj

        time.sleep(1.5)

    data_date = max((r["as_of"] for r in results), default="")

    output = {
        "updated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "data_date": data_date,
        "windows": list(WINDOWS),
        "benchmarks": BENCHMARKS,
        "count": len(results),
        "stocks": results,
    }

    with open("docs/data/alphabeta.json", "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, separators=(",", ":"))

    csv_fields = ["code", "name", "market", "ticker", "as_of"]
    for n in WINDOWS:
        csv_fields += [f"beta{n}", f"alpha{n}", f"er{n}"]
    with open("docs/data/alphabeta.csv", "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=csv_fields)
        writer.writeheader()
        writer.writerows(results)

    trajectory_output = {
        "updated_at": output["updated_at"],
        "windows": list(WINDOWS),
        "risk_free_rate": RISK_FREE_RATE,
        "points": TRAJECTORY_POINTS,
        "dates": trajectory_dates,
        "stocks": trajectories,
    }
    with open("docs/data/trajectory.json", "w", encoding="utf-8") as f:
        json.dump(trajectory_output, f, ensure_ascii=False, separators=(",", ":"))

    print(f"完成，共 {len(results)} 檔寫入 docs/data/alphabeta.json(.csv)，{len(trajectories)} 檔寫入 docs/data/trajectory.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
