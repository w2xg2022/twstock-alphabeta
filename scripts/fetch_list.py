#!/usr/bin/env python3
"""抓取台股上市、上櫃公司清單，輸出 data/stock_list.csv"""
import csv
import io
import os
import sys
import time

import requests

URL_TWSE = "https://mopsfin.twse.com.tw/opendata/t187ap03_L.csv"
URL_OTC = "https://mopsfin.twse.com.tw/opendata/t187ap03_O.csv"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; twstock-alphabeta-bot/1.0)"
}


def fetch_csv(url: str, retries: int = 3) -> list[dict]:
    last_err = None
    for attempt in range(retries):
        try:
            resp = requests.get(url, headers=HEADERS, timeout=30)
            resp.raise_for_status()
            resp.encoding = "utf-8"
            reader = csv.DictReader(io.StringIO(resp.text))
            return list(reader)
        except Exception as e:  # noqa: BLE001
            last_err = e
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"下載失敗: {url}") from last_err


def normalize(rows: list[dict], market: str, suffix: str) -> list[dict]:
    out = []
    for row in rows:
        code = (row.get("公司代號") or row.get("﻿公司代號") or "").strip()
        name = (row.get("公司名稱") or "").strip()
        if not code or not code.isdigit():
            continue
        out.append({
            "code": code,
            "name": name,
            "market": market,
            "ticker": f"{code}{suffix}",
        })
    return out


def load_previous(path: str) -> dict:
    if not os.path.exists(path):
        return {}
    with open(path, newline="", encoding="utf-8") as f:
        return {row["code"]: row for row in csv.DictReader(f)}


def report_diff(old_rows: dict, new_rows: list[dict]) -> None:
    if not old_rows:
        return
    new_by_code = {r["code"]: r for r in new_rows}
    added = sorted(set(new_by_code) - set(old_rows))
    removed = sorted(set(old_rows) - set(new_by_code))
    if added:
        print(f"新增 {len(added)} 檔: " + ", ".join(f"{c}{new_by_code[c]['name']}" for c in added))
    if removed:
        print(f"下市/移除 {len(removed)} 檔: " + ", ".join(f"{c}{old_rows[c]['name']}" for c in removed))
    if not added and not removed:
        print("清單與前次相同，無新增或下市")


def main() -> int:
    out_path = "data/stock_list.csv"
    old_rows = load_previous(out_path)

    twse_rows = normalize(fetch_csv(URL_TWSE), "TWSE", ".TW")
    otc_rows = normalize(fetch_csv(URL_OTC), "OTC", ".TWO")
    all_rows = twse_rows + otc_rows
    all_rows.sort(key=lambda r: r["code"])

    report_diff(old_rows, all_rows)

    with open(out_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["code", "name", "market", "ticker"])
        writer.writeheader()
        writer.writerows(all_rows)

    print(f"寫入 {len(all_rows)} 筆 ({len(twse_rows)} 上市 + {len(otc_rows)} 上櫃) -> {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
