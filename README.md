# 豬場查詢系統 V3.3.57

GitHub Pages 完整部署包。將 ZIP 內網站檔案解壓後覆蓋 GitHub Pages 原站台；不要把 ZIP 本身直接當作 index.html。

### 本版更新
修正手機、平板勾選「顯示豬場名稱」時可能卡住。名稱只在可見範圍按數量上限顯示，放大地圖可看更多。正式豬場 Firestore 即時同步不變。

### Firebase
`firebase/firestore.rules` 為現有規則參考檔，若已發布 V3.3.46 規則則本版不需更動 Firebase。原名冊不需再初始化。

完整測試範圍與限制請看 `更新與測試報告.md`。
