# 豬場查詢系統 V3.4.14｜程式與專案整理版

本版由 V3.4.13 整理而來，**不修改 Firebase 專案設定、資料表結構、核准交易或既有豬場資料**。更新重點是清除檔案名稱上的舊版尾碼、統一靜態資源引用、重新產生 PWA 快取版本，並分離可直接部署的網站與完整開發測試資料。

## 資料夾

- `index.html`：網站入口
- `assets/css/`：以功能命名的樣式檔，無 V3.3.x 舊版尾碼
- `assets/js/`：地圖、申請與審核、響應式介面、Firebase 整合等原有功能模組
- `data/`：原有 315 筆名冊和 F03 地籍/圖層基礎資料；**不可任意刪除**
- `icons/`、`favicon.ico`、`manifest.webmanifest`、`sw.js`：PWA 外殼
- `firebase/firestore.rules`：既有 Firestore 安全規則（未修改）
- `tools/`：開發/診斷工具（僅完整原始碼 ZIP）
- `tests/`：回歸測試（僅完整原始碼 ZIP）

## GitHub Desktop 部署

1. 解壓 `豬場查詢系統 V3.4.14_GitHub部署版.zip`，將**裡面的檔案及資料夾**放進原 GitHub 專案根目錄，不要在根目錄多放一層資料夾。
2. **刪除原專案中**舊命名的 CSS/JS 檔（如 `app-v3320.css`、`mobile-v3320.js` 等），因為新版已改引用新檔名；不要刪除 Firebase 雲端資料，也不要重新初始化資料。
3. 使用 GitHub Desktop 檢查 Changes，Commit，Push origin。手機或電腦重新開啟網站；如 PWA 仍是舊畫面，關閉分頁再重開，讓 Service Worker 換版。
4. 用兩個帳號檢查送審、核准、跨裝置讀回與疑似標記的消失。

## 測試與限制

完整原始碼 ZIP 附 `tests/run_tests.py`，執行 `python tests/run_tests.py` 可檢查語法、引用、審核的離線測試及網頁檢查（視環境而定）。Firestore emulator 權限測試需要額外安裝開發相依套件。這次沒有連線到你的正式 Firebase，不代表已完成線上跨裝置驗收。

詳情參見 `整理與測試報告.md`。
