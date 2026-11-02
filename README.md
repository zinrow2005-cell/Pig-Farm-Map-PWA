# 豬場地圖查核 V3.3.19 — Firebase 登入與行動裝置地圖優先版

## 上傳 GitHub Pages

ZIP 解壓後**整份內容**放在 GitHub Pages 儲存庫根目錄；不可只上傳 `index.html`。

- 已配置現有 Firebase Web App；請保護 Firestore 安全規則，先確認 `firebase/firestore.rules` 已在 Firebase 控制台發布。
- 頁面右上有 **Google 登入**。登入後自動檢查 `/admins/{UID}` 是否存在 `role: "admin"`（**string 字串**）。
- 管理員首次登入、雲端 `farms` 為空時，會開啟「☁ 共同編輯」視窗，顯示「初始化／補齊315筆初始豬場」。
- 按「初始化／補齊」前請先核對 Firestore 正式豬場是否確實為空；初始化只新增缺漏 UID，不覆寫現有已核准資料。
- 使用者提交的場址變動進入 suggestions 待審清單，核准後 Firestore 會同步修改正式場址；人工 F03 查核不是共用資料。
- 手機和平板：預設大地圖；底部「豬場清單」展開抽屜；底部「查核操作」可開啟準星、標記或工作台。
- 小尺寸手機預設單張正射影像；仍可切回雙圖或盤查圖。平板可使用雙圖。
- 若 iOS 主畫面 PWA 不能開啟 Google 登入彈窗，先在 Safari 的 HTTPS 網站開啟並登入測試；需另行驗證真正的 PWA 登入相容性。
- 重新整理後若仍有舊介面，請關閉已安裝的 PWA 再重新開啟，並檢查網站是否已部署新 `sw.js`。

## 安全與資料

- 請不要把服務帳戶私鑰或 Firebase Admin SDK JSON 放進公開 GitHub 儲存庫。
- Firebase Web API Key 會公開於前端，不能代替 Firestore 安全規則。
- 原有 315 筆名冊和 112 年雲林 F03（3,593 個多邊形）隨部署提供；各自有不同的資料用途。
- 沒有 Firebase 連線時不能聲稱更正已同步；保留本機原有功能但正式共編需連線後才能操作。
- 資料庫位置與管理者權限由你自己的 Firebase 控制台控制，本次未直接存取或修改雲端。

## 連線診斷

部署後開啟 `tools/firebase-check.html`，先確認 Firebase SDK 與 Firestore 能否取得資料；再用兩個帳號驗證修改送審及核准後同步。
