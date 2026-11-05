# 豬場查詢系統 V3.3.61 — 一般使用者送審修正版

## 修正原因
手機操作影片出現「沒有資料庫存取權限」。舊版對尚不存在的 `farmSubmissions` 紀錄先執行交易讀取，但 Firestore `get` 規則只允許讀取已存在且屬於自己的案件，首次送審可能在寫入前被拒絕。

## 修正方式
`assets/js/community.js` 一般使用者送審改為在穩定 ID 上直接 `setDoc`，不再先讀取不存在的文件。`farmSubmissions` 安全規則保留 `create` 驗證及一般使用者不得 `update`，因此首次送審可建立、同地塊重送不覆寫。管理員直接儲存及正式審核路徑未修改。

## 部署
1. 先備份正式豬場及原 Firebase 規則。
2. GitHub Pages 完整覆蓋本包內容，確認左上 V3.3.61。
3. 核對 Firebase Console > Firestore Database > Rules 裡的 `farmSubmissions` 允許符合條件的登入者 `create`。若仍是舊規則，可使用本包 `firebase/firestore.rules`，先備份並比較你的自訂規則再發布。
4. 朋友用 Google 登入，選地塊、填名稱與座標並送審；畫面應顯示「已送交管理員審查」，「待審核定」分頁有該筆案件。管理員重新讀取待審。
5. 若仍回報 permission-denied，請確認正式發布的規則內容和 Firebase 專案是否正確，並保留錯誤畫面。

## 安全
不能因一次點擊就假定成功。只有 Firestore 回應寫入成功才顯示送審成功。本機人工查核與正式豬場不受此版本變更。
