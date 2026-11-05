# 豬場查詢系統 V3.3.62 — 一般使用者送審診斷與規則調整

在 V3.3.61 基礎上，送審表單新增即時可見的回饋；若遭 Firebase 拒絕，顯示錯誤碼、專案 ID，並以本人授權查詢確認同一位置是否已送審。

`firebase/firestore.rules` 的 farmSubmissions 建立權限改用 Google 身分供應者條件，以避免因 email_verified 權杖欄位不一致而被阻擋。保留管理員核定、正式資料與本人查核的既有授權條件。

部署前請備份目前 Firestore 規則，對照差異後發布；完整網站必須同步更新 GitHub Pages。不要重新初始化初始名冊。正式 Firestore 與手機真實操作仍需線上驗收。
