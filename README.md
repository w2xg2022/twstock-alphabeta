# twstock-alphabeta

台股（上市、上櫃）個股 alpha / beta 資料庫。個股還原價來自 [yfinance](https://github.com/ranaroussi/yfinance)，大盤基準指數改用 [FinMind](https://finmindtrade.com/) API（yfinance 的 `^TWII`／`^TWOII` 指數資料常延遲或不完整，尤其 `^TWOII` 實測會卡在好幾個交易日前，FinMind 的 `TAIEX`／`TPEx` 較即時可靠）。

線上查詢：**[https://w2xg2022.github.io/twstock-alphabeta/](https://w2xg2022.github.io/twstock-alphabeta/)**（GitHub 會強制在同分頁開啟連結；若想開新分頁，可按住 Ctrl 點擊連結，Mac 按住 ⌘ 點擊；按住 Shift 點擊則開新視窗）

下載當日完整資料（CSV）：**[Releases](https://github.com/w2xg2022/twstock-alphabeta/releases)**，每個交易日發布一份 `alphabeta_YYYYMMDD.csv`（全部個股 60/120/240 日 α、β、E(R)）。

## 資料說明

- **股票範圍**：證交所公開資訊觀測站上市（`t187ap03_L.csv`）、上櫃（`t187ap03_O.csv`）公司清單
- **價格**：yfinance `auto_adjust=True`，即還原股利、股票分割後的調整收盤價
- **基準指數**：FinMind `TaiwanStockPrice`，上市股票對 `TAIEX`（加權指數），上櫃股票對 `TPEx`（櫃買指數）
- **計算窗口**：60、120、240 個交易日
- **算法**：對股票日報酬率、大盤日報酬率做線性迴歸（OLS）
  - β：迴歸斜率
  - α：迴歸截距 × 252（年化）
- **更新頻率**：GitHub Actions 排程，台灣時間週二至週六約 11:30 自動執行（配合 yfinance 資料在交易日隔天上午更新的節奏）

## 目錄結構

```
scripts/fetch_list.py   抓取上市/上櫃公司清單 -> data/stock_list.csv
scripts/compute.py      下載股價、計算 alpha/beta -> docs/data/alphabeta.json(.csv)、docs/data/trajectory.json
docs/                   GitHub Pages 靜態查詢頁面
.github/workflows/      自動更新排程
```

## 本地執行

```bash
python3 -m venv venv
./venv/bin/pip install -r requirements.txt
./venv/bin/python scripts/fetch_list.py
./venv/bin/python scripts/compute.py
```

## 免責聲明

本倉庫資料僅供研究與學習參考，不構成任何投資建議。資料來源、計算方式可能存在誤差或延遲，使用者應自行核實並承擔相關風險。
