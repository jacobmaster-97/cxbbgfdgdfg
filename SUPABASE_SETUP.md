# Supabase 登入與共用資料

目前版本在 GitHub 靜態網站使用電郵及密碼登入。雲端共用班別、學生、時間表、校曆及加分紀錄（含規則及植物進度）。白板筆跡、個人圖片、功課紙、顯示設定和來源圖片／PDF只在本機，不上傳內容或連結。

## 專案設定

1. 建立自己的 Supabase 專案；地區選接近使用地點，資料庫密碼自行保管。
2. Authentication 的登入設定啟用 Email，關閉「Allow new users to sign up」及匿名登入。
3. Authentication → Users → Add user → Create new user，建立自己的教師電郵及密碼；為自己建立的帳戶選 Auto Confirm User。管理 Supabase 的帳戶和教師登入帳戶可以不同。
4. SQL Editor → New query：貼入 [supabase/setup.sql](./supabase/setup.sql)，按 Run。程式建立資料表、資料驗證、帳戶隔離及版本核對函式；可再次執行，不會刪除資料。
5. Connect 提供 Project URL 及 Publishable key。設定於 [dist/cloud-config.js](./dist/cloud-config.js)。本專案已填入使用者提供的公開連接資料。**不要把 Secret key、service_role key、資料庫密碼或教師密碼放進 GitHub。**
6. 使用已更新的靜態網站網址；不是 Apps Script 的 `/exec`。本機預覽也須透過 http://localhost 開啟，不能直接點開 file:// HTML。

不需要 Google Cloud Console、Google OAuth 驗證、Supabase Storage 或另設伺服器。首版只提供既有帳戶登入，没有公開註冊、Google 登入或寄信重設密碼；忘記密碼時由專案擁有者在 Supabase 控制台管理。

## 首次使用及資料搬遷

1. 在原有資料所在的裝置和瀏覽器，開啟更新後的網站。按右上角「登入與同步」；需要時先在未登入模式下載「本機共用資料備份」。
2. 用已建立的教師電郵及密碼登入。
3. 如要保留舊本機資料，展開「匯入共用資料或舊本機資料」，按「匯入原有本機資料」，確認資料數量。原本未登入的資料另行保留。
4. 在首次連接選「把本機資料首次存入雲端」。不要把空白資料誤認為舊資料已自動搬遷。
5. 平板開啟同一網站，登入同一教師帳戶，選「使用雲端資料」。
6. 若原資料來自其他網站来源，先從那個網站匯出備份。整合 JSON 可於此面板還原；舊分項備份可在首頁設定的「資料備份與還原」按類別匯入。

新帳戶不會自動取得未登入時的名單，也不會取得另一教師的名單。不同帳戶使用分開的本機資料；白板和圖片依裝置保留，不跟隨帳戶同步。登出會返回原有未登入的本機模式，原帳戶未上傳的修改仍留在自己的快取。

## 同步與衝突

- 開啟讀取；儲存約 2 秒後自動上傳，每 30 秒檢查更新，回到前景和恢復連線時再檢查。
- 離線、網絡失效或專案暫停時，共用資料修改保存在本機。網頁已載入時可繼續操作；此版不提供離線首次／重新載入網站的保證。
- 雲端新資料不會取代未儲存的表單；完成並儲存或取消編輯後再同步。
- 以資料版本及交易鎖保護寫入；回應遺失後以相同請求安全重試。
- 不同欄位、不同學生及不同 ID 的加分紀錄可三方合併。同一欄位被改為不同值、刪除與編輯同一項、或無法安全判斷時，會停止並提示選擇整份本機或雲端版本。
- 選擇雲端／合併／匯入前保存一份本機載入前備份。請先下载整合備份再處理衝突。
- 雲端工作區保留最近 **50 個成功版本**，整份共用資料上限 **900 KB**。最新資料位於 teacher_workspaces；teacher_workspace_versions 用於歷史及重試。不要在 Table Editor 直接編輯資料，以免破壞版本核對。
- 清除網站資料會刪除本機白板及尚未上傳的修改。瀏覽器會保留登入工作階段，因此共用電腦使用後應登出。

## 權限安排

兩張表均啟用 RLS：登入者只能讀自己的 owner_id；匿名者不可讀寫。網頁不能直接寫資料表，只能呼叫核對 `auth.uid()` 的讀取及寫入函式。函式不接受由客戶端傳入的擁有者 ID。Publishable key 可公開，保護資料的是登入權杖及資料庫權限。

本次設定已從公開介面確認電郵登入啟用、公開註冊關閉、未登入者呼叫讀取函式被拒絕。完整真實登入與寫回仍需要使用者自行登入實測；不應把密碼傳到對話。

## 開發驗證

```sh
node --test tests/cloud-model.test.cjs
PGLITE_MODULE=/path/to/@electric-sql/pglite node --test tests/cloud-database.test.cjs
PGLITE_MODULE=/path/to/@electric-sql/pglite PLAYWRIGHT_MODULE=/path/to/playwright PLAYWRIGHT_CHANNEL=chrome node tests/cloud-browser.cjs
```

資料庫測試使用本機 PostgreSQL（PGlite）執行完整設定檔，驗證 RLS、拒絕匿名／直接寫入、版本核對、請求去重、格式限制及 50 版保留。瀏覽器測試使用真實靜態程式及本機 PostgreSQL，僅模擬 Auth 和 HTTP 連接，涵蓋桌機／平板、離線、草稿、切換帳戶、加分、時間表、備份與本機媒體排除。

GitHub 推送需使用者明確指示。Supabase 已設定不等於網站已更新。

官方文件：[電郵密碼登入](https://supabase.com/docs/guides/auth/passwords)、[公開金鑰](https://supabase.com/docs/guides/getting-started/api-keys)、[RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)、[免費專案暫停](https://supabase.com/docs/guides/platform/free-project-pausing)。
