# 豬場地圖查核 V3.3.18｜Google Firebase 共同編輯版

本版基於 V3.3.17 改寫為 **Google Firebase Authentication + Cloud Firestore**，不需要 Supabase。已保留原有 315 筆豬場、232 筆座標、83 筆未定位、112 年雲林縣 3,593 個 F03 畜牧使用多邊形，以及小豬圖示、PWA、22 縣市與虎尾／土庫獨立篩選、雙圖地圖定位、橫式牧場名稱。

> **重要：此 ZIP 沒有你的 Firebase 專案設定，目前還不能跨裝置同步。** 設定完成後，GitHub Pages 提供網頁，Firestore 保存已審核的共用地址，Google 帳號登入後可提出修改建議；管理者採納後，所有開啟網站的使用者即時看到更新。原有人工查核與核定紀錄仍在本機，不在本次同步範圍。

## 一、一次性設定，請照順序

1. 使用原有 Google 帳號，登入 https://console.firebase.google.com/ ，建立一個 **Firebase 專案**。選 Spark 免費方案即可開始；不需先買 Google Cloud。
2. **建立 Cloud Firestore**：建議 Standard 版、位置 `asia-east1`（台灣），採 **Production mode**，不要 Test mode。建立完成後，進入 Firestore → **Rules／規則**，把 `firebase/firestore.rules` **完整複製貼上並發布**。此檔是正式權限設定；未發布前，網站無法提交建議。
3. **啟用 Google 登入**：Firebase Authentication → Sign-in method／登入方式 → Google → 啟用，選擇支援信箱並儲存。待 GitHub 網址確定後，到 Authentication → Settings → Authorized domains 加入 `<帳號>.github.io`（不含 `https://` 或 repo 路徑）。
4. **註冊 Web 應用程式**：專案總覽點 `</>`（Web），暱稱可用 `Pig Farm Map PWA`；不必啟用 Firebase Hosting。註冊後 Firebase 會顯示 `firebaseConfig`，把 `apiKey`、`authDomain`、`projectId`、`appId`、`messagingSenderId`、`storageBucket` 一一填入 `assets/js/cloud-config.js`。只貼一般 Firebase Web 設定，**絕不可貼服務帳戶私鑰、Admin SDK JSON 或 Google 密碼**。
5. 把本 ZIP 解壓後的**所有檔案及資料夾**上傳到 GitHub 儲存庫根目錄，在 GitHub → Settings → Pages 選部署來源（main / root）。使用 HTTPS 正式網址開啟系統。
6. 在網站點右上角 **「☁ 共同編輯」→「使用 Google 帳號登入」**，先用你的 Google 帳號登入一次。到 Firebase 控制台 → Authentication → Users 找到剛登入帳號的 **UID** 並複製。
7. 回到 Firebase 控制台 → Firestore → Data／資料 → 新增集合 **`admins`**（全小寫），以你的 **UID 當文件 ID**，文件新增欄位 `role`，型別 `string`，值 `admin`。**只在 Firebase 控制台建立，不能讓訪客自行指定。** 回到網站重新整理或登出登入後，右上角將顯示「管理者」。
8. 管理者點「☁ 共同編輯」→ **「初始化／補齊315筆初始豬場」**。第一次會匯入原始315筆，日後只補缺漏，不會覆寫已修改的場址。請確認雲端清單數量。匯入過程如果斷線，再次點補齊即可。
9. 使用兩個不同的 Google 帳號或瀏覽器測試：A 選豬場 → 編輯 → 提交地址更正；管理者看到待審核 → 採納；A、B 都應自動收到正式地址／座標更新。

## 二、資料分工

- `farms/{uid}`：可公開查閱的正式場址名稱、縣市、鄉鎮、地址、經緯度、版本號；一般登入者**不能直接更新或刪除**。
- `suggestions/{autoId}`：Google 登入者提交的更正建議；最近 50 筆僅登入使用者可以查看。不能自己竄改「已審核」狀態。
- `admins/{uid}`：由 Firebase 控制台建立的管理者名單；前端無新增、編輯、刪除權限。
- 原始豬場列表內的人工判定、F03、工作區、查核日誌仍是**各自瀏覽器本機儲存**。這些不是 Firestore 的共用資料。

## 三、版本衝突與資料安全

- 管理者審核採用 `runTransaction`。**建議所依據的正式版本**如果已經過其他審核更改，舊建議會被拒絕採納，須重新提交，不會覆蓋最新地址。
- `firebase/firestore.rules` 在**資料庫端**禁止非管理員改動正式場址、禁止自行加入 admins、禁止刪除，並驗證場址欄位、經緯度範圍、建議提交者和版本。
- 開放公開寫入前應建立反濫用機制：本版**沒有 CAPTCHA、速率限制、檢舉功能**。Firestore 規則不會自動防止大量合法登入帳戶反覆提交；大規模公開前先評估 App Check、限流與費用監控。
- 未設定 Firebase 時，畫面會明確提示「本機模式」；不能把本機修改當成已同步。Firebase 連線失敗也會顯示錯誤。
- Google 登入用 `signInWithPopup()` 避免 GitHub Pages 跨站 redirect 的已知限制；iOS PWA 或部分瀏覽器若封鎖彈窗，請先改用 Safari／Chrome 網頁模式登入。**手機登入仍需真機驗收。**

## 四、部署與更新

```text
index.html
manifest.webmanifest
sw.js
favicon.ico
assets/css/app.css
assets/js/{app.js,community.js,cloud-config.js,pig-core.js,f03-services.js,pwa-install.js}
data/f03-y112-yunlin.js
data/legacy-farms.js   （315筆原始豬場，缺此檔會導致首次開啟清單為空）
icons/*.png
firebase/firestore.rules     （上傳給專案管理者使用；必須在 Firebase 控制台發布）
tools/                  （官方 F03 進階查核工具）
```

若修改 Firebase Web 設定，應重新上傳更新後的 `cloud-config.js`，PWA 的設定檔採網路優先讀取以防舊版快取。`sw.js` 僅快取網站殼與靜態圖資，**不快取 Firestore 的共享資料**。

## 五、測試／限制

- 已做 Node JavaScript 語法、靜態依賴、315筆清單與 F03 資料一致性檢查；受控瀏覽器 UI 測試詳見 `測試報告.md`。
- **尚未有真實 Firebase 專案**，因此不能聲稱 Google 登入、Firestore Rules、雙裝置即時同步、管理者權限已在線上通過驗收。務必按前述第9步在正式網站實測。
- Google 公開說明：https://firebase.google.com/docs/firestore/security/get-started 、https://firebase.google.com/docs/auth/web/google-signin 、https://firebase.google.com/docs/firestore/manage-data/transactions

**補修：** V3.3.17 舊部署包缺少首次開啟所需的 `PIG_FARM_LEGACY_SEED` 載入檔。此版新增 `data/legacy-farms.js`，與原始上傳 JSON 的315筆一致；這也是首次啟用 Firestore 管理員初始化的資料來源。
