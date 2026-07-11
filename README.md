# twstock-alphabeta

台股（上市、上櫃）個股 alpha / beta 資料庫。個股還原價來自 [yfinance](https://github.com/ranaroussi/yfinance)，大盤基準指數改用 [FinMind](https://finmindtrade.com/) API（yfinance 的 `^TWII`／`^TWOII` 指數資料常延遲或不完整，尤其 `^TWOII` 實測會卡在好幾個交易日前，FinMind 的資料較即時可靠）。

線上查詢：**[https://w2xg2022.github.io/twstock-alphabeta/](https://w2xg2022.github.io/twstock-alphabeta/)**（GitHub 會強制在同分頁開啟連結；若想開新分頁，可按住 Ctrl 點擊連結，Mac 按住 ⌘ 點擊；按住 Shift 點擊則開新視窗）

下載當日完整資料（CSV）：**[Releases](https://github.com/w2xg2022/twstock-alphabeta/releases)**，每個交易日發布一份 `alphabeta_YYYYMMDD.csv`（全部個股 60/120/240 日 α、β、E(R)）。

## 資料說明

- **股票範圍**：證交所公開資訊觀測站上市（`t187ap03_L.csv`）、上櫃（`t187ap03_O.csv`）公司清單
- **價格**：yfinance `auto_adjust=True`，即還原股利、股票分割後的調整收盤價（等同含息的類報酬率價格）
- **基準指數**：FinMind `TaiwanStockTotalReturnIndex`（報酬指數，含息），上市股票對 `TAIEX`（加權報酬指數），上櫃股票對 `TPEx`（櫃買報酬指數）。特意用報酬指數而非單純的價格指數（`TaiwanStockPrice`），因為個股那邊已經是還原股息後的價格，基準指數若不含息會讓 α 系統性偏高（個股含息、大盤不含息，比較基礎不一致）
- **計算窗口**：60、120、240 個交易日
- **算法**：對股票日報酬率、大盤日報酬率做線性迴歸（OLS）
  - β：迴歸斜率
  - α：迴歸截距 × 252（年化）
- **更新頻率**：GitHub Actions 排程，台灣時間週一至週五 16:00 自動執行（GitHub Actions 排程本身以延遲/不準時聞名，抓收盤後2.5小時是留給它的緩衝）。交易日 13:30 收盤後，個股（yfinance）與大盤基準（FinMind）資料下午即已可靠可用，不需要再等到隔天早上。程式會自動偵測資料實際反映的交易日（`data_date`），即使提早或延後執行，Release／CSV 檔名與內文交易日都不會標錯。

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
