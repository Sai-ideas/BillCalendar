# V0.3 規格審閱與 MVP 架構收斂提案（供 Agent / 開發者 Review）

- **狀態**：Reviewed — 主要架構建議已收斂，待 PR Merge 後同步正式 Architecture / UX / Issues；本文件本身不是已實作證明。
- **對應基準**：需求基準 V0.3（`README.md`, `docs/PRD.md`, `docs/ARCHITECTURE.md`, `docs/UX.md`, `docs/ROADMAP.md`）
- **目的**：在不違反 `docs/ROADMAP.md`「尚待決策（不可假裝已確定）」原則的前提下，針對進入 **階段 1（基礎）與階段 2（月曆）** 前必須收斂的資料模型、索引效能與未決 UX 行為提出具體技術提案，供另一個 Agent 或維護者逐項 Review。

---

## 1. 整體規格評估（V0.3 優勢確認）

1. **核心抽象乾淨**：
   - 「資料模組獨立、日期視圖整合」避免了單一萬用資料表的欄位膨脹。
   - 「個人心情 ＝ `kind = 'personal'` 的聊天室」使個人隨手記與家庭聊天共用同一套 `messages` 資料結構、分頁游標、`ChatPanel` UI 與「訊息轉事件／待辦／日記草稿」邏輯，大幅降低前後端維護成本。
2. **無狀態媒體與低成本邊界明確**：
   - 明確排除檔案上傳、R2、BLOB 與 WebP 壓縮，僅保存外部 HTTPS URL，確保 Cloudflare Workers + D1 的部署單純且不觸發額外儲存計費。
3. **跨空間隱私邊界嚴謹**：
   - 明確定義私人日記永不共享、群組訊息衍生之私人紀錄不繼承家庭權限、以及反向查詢來源訊息時必須重新驗證雙端權限。

---

## 2. 架構與 Schema 修正提案（Architecture Proposals）

### 提案 A1：MVP 採用單一具名來源外鍵（Review 結論：採納並修訂）

- `events.source_message_id`、`tasks.source_message_id`：可為 NULL，參照 `messages(id)`；各自為來源欄位建立索引。
- **不在 MVP 同時保存同一關聯於 `record_links`**，避免兩份真相不一致。每個事件／待辦至多一則直接來源訊息；同一訊息可衍生多個事件／待辦。
- 聊天轉私人日記採「複製為草稿」，目前不必建立永久來源外鍵；日後多來源或跨類型關聯有明確需求再評估 join table。
- **MVP 訊息原則採軟刪除（`deleted_at`），保留 ID 與來源連結**。一般閱讀與搜尋均不可再取回已刪內容；實際資料保留／清除政策及管理員存取需另定義。若未來執行實體刪除，外鍵可 `ON DELETE SET NULL`，UI 顯示無來源，不可假裝仍有原訊息。
- 正反向導覽**每次同時檢查目標與來源的存取權**；家庭訊息衍生私人待辦時，其他家庭成員不得看到待辦本體，**也不能看到是否建立了該私人待辦**。後端只回傳授權可見的關聯數量與詳情。
- 使用者離開家庭後，即便保留了其私人事件或待辦，也不可藉來源連結讀取原家庭訊息。軟刪除的來源只能顯示「已移除」，無權限來源只顯示泛化不可存取訊息，避免資訊洩漏。
- 驗收：單訊息建立多目標、修改目標不改原文、軟刪／退群回源顯示、跨空間不可見性，皆須列為測試。

---

### 提案 A2：分開訊息的發送日期與補記日期（Review 結論：採納並修訂）

- `created_at`：UTC 建立時間，作為訊息時間軸主要排序依據（同時間以 `id` 斷同分）。
- `local_date TEXT NOT NULL`：依訊息發送當下聊天室指定時區計算的本地發送日期（`YYYY-MM-DD`）；MVP 預設 `Asia/Taipei`。供聊天日期定位與按發送日的月曆存在性摘要。
- `record_date TEXT NULL`：使用者明確指定的生活紀錄日期，供未來補記使用；**不得覆寫 `local_date`**。MVP 可不提供編輯該欄位的 UI。
- 建立索引 `CREATE INDEX idx_messages_room_date_created ON messages(room_id, local_date, created_at, id);`；如日後開放按補記日期篩選，再評估獨立索引。
- 月曆標記先以 `selectedSpace` 對應聊天室的 `local_date` 定義存在性；未來若需要「指定紀錄日」圖示，必須另訂清楚的聚合規則。
- 當 `local_date` 與 `created_at` 可能排序不同（例如聊天空間時區變更）時，定位 SQL 需先查當日符合的訊息，再以 UTC / id 載入其相鄰上下文，**不得直接假設 `ORDER BY local_date, created_at` 永遠等於完整聊天時間軸**。
- 索引有助於縮小掃描範圍，但不能承諾固定為 Index-Only Scan；以 `EXPLAIN QUERY PLAN` 與測試資料驗證實際查詢計畫與效能。

---

### 提案 A3：單一專案結構（Vite + Hono + Cloudflare Workers 同倉整合）

- **建議方案**：
  - 採用 Cloudflare 官方推薦的 **Vite + Hono + Wrangler 單一專案結構**（而非拆分為獨立的 `frontend/` 與 `backend/` 兩個 `package.json`）：
    ```text
    BillCalendar/
    ├── src/
    │   ├── client/        # React + Tailwind + Vite 前端
    │   ├── server/        # Hono API routes + 權限 middleware + D1 queries
    │   └── shared/        # 前後端共用的 TypeScript 型別、Zod 驗證、農曆/日期工具
    ├── drizzle/           # D1 SQL migrations
    ├── wrangler.toml      # Cloudflare Workers + D1 binding 設定
    └── vite.config.ts
    ```
  - **效益**：前後端直接共用 `src/shared/` 的 API Request/Response 型別與時區／農曆工具，避免型別漂移，且本地開發只需單一指令即可啟動。

---

## 3. 針對 `docs/ROADMAP.md` 尚待決策項目的 MVP 預設提案

為避免實作階段 1～8 時卡在未決事項，以下針對 `docs/ROADMAP.md` 列出的待決問題提出 **MVP 最簡安全預設值（供 Review 確認是否採納）**：

| 編號 | `ROADMAP.md` 待決事項 | 提案之 MVP 預設方案 | 理由與安全考量 |
| :--- | :--- | :--- | :--- |
| **D1** | **家庭邀請在無郵件驗證 Demo 的使用流程** | **方案：應用程式內「待接受邀請清單」**<br>使用者 A 在家庭設定輸入 `invited_email` 建立 `family_invitations (status='pending')`。當測試者切換身份為該 Email（使用者 B）時，頂部導覽列顯示「您有 1 個家庭邀請」，點擊「接受」即寫入 `family_members` 並將邀請改為 `accepted`。 | 完全不需設定 SMTP/寄信服務，又能完整測試「邀請 -> 接受/拒絕 -> 權限生效」的真實狀態機。 |
| **D2** | **聊天訊息編輯／刪除與已轉換事件之關聯維持** | **方案：MVP 訊息僅支援新增（或軟刪除保留 ID），衍生事件獨立存活**<br>1. 訊息轉成事件／待辦後，事件／待辦擁有獨立複製的 `title` 欄位，修改訊息不影響已建立的事件。<br>2. 若訊息被刪除（或軟刪除 `deleted_at`），事件／待辦保留，但其「查看來源聊天」回傳 `source_status: 'deleted' | 'inaccessible'`，UI 顯示「原訊息已移除或無權限查看」。 | 符合 `PRD.md`「原文保持不變」與 `ARCHITECTURE.md`「若已退出家庭、訊息遭刪除，回傳不可存取／已移除狀態」。 |
| **D3** | **同一天有個人及多個家庭聊天時的 icon 定位策略** | **方案：依頂端全域 `selectedSpace` 決定範圍**<br>1. 當頂端選擇「個人空間」時：月曆格的聊天/心情 icon 反映「個人心情聊天室」是否有紀錄，點擊切換至右側「心情」分頁。<br>2. 當頂端選擇「某個家庭空間」時：聊天 icon 反映「該家庭聊天室」是否有紀錄，點擊切換至右側「聊天」分頁。<br>3. 「私人日記 icon」僅在「個人空間」（或永遠只對本人查詢自己的 `diaries`）顯示，點擊開啟「日記」分頁，絕不查詢或顯示他人日記。 | 消除「同一個 icon 點下去不知道要開個人還是哪個家庭」的歧義，且與頂端空間切換器（Space Switcher）語意完全一致。 |
| **D4** | **日期的時區預設及跨國家庭的日期顯示策略** | **方案：`calendars` / `users` 保存預設時區字串（MVP 固定預設 `'Asia/Taipei'`）**<br>1. 全天事件（`all_day = true`）、待辦 `due_date`、記帳 `occurred_on`、日記 `entry_date` 均以純日期字串 `YYYY-MM-DD` 儲存，不做時區偏移。<br>2. 具時間之事件（`all_day = false`）以 ISO 8601 UTC 字串儲存 `starts_at`/`ends_at`，並搭配事件或空間的 `timezone`（預設 `Asia/Taipei`）換算落在哪個月曆格。 | 避免跨時區環境（例如 Cloudflare Workers 執行環境為 UTC）導致全天事件或日記偏一天。 |
| **D5** | **事件重複、農曆閏月、台灣假期資料來源與正確性** | **方案：MVP 僅做「西曆對照農曆與節氣／傳統節日顯示」，不實作週期重複事件排程**<br>1. 使用純前端/共用 JS 離線演算法庫（如 `lunar-javascript`，零外部 API 依賴、含 1900–2100 完整農曆閏月與二十四節氣）渲染月曆格農曆日期（如「初一」、「中秋」）。<br>2. 台灣國定假日以靜態 JSON 設定檔（例如 `2026-2027` 政府行政機關辦公日曆表摘要）提供，並在 UI 標註「節假日僅供參考」。 | 完全符合 `PRD.md`「農曆每年重複排程暫非 MVP」的要求，且離線計算快速、無外部 API 失敗風險。 |
| **D6** | **家庭角色權限（管理員、成員可執行的具體動作）** | **方案：MVP 定義兩種角色 `admin`（建立者）與 `member`**<br>- `admin`：可修改家庭名稱、發送／撤銷邀請、移除成員、讀寫所有家庭行程／待辦／帳本／聊天。<br>- `member`：可讀寫所有家庭行程／待辦／帳本／聊天、可自行退出家庭，但不可管理成員或刪除家庭。 | 規則簡單直覺，足以覆蓋家庭協作與權限邊界測試（例如成員退出家庭後無法再透過舊關聯讀取家庭聊天）。 |
| **D7** | **外部圖床允許清單及 Imgur 頁面連結的呈現方式** | **方案：嚴格 `<img src>` 直連渲染 + 非直連網址降級為安全外部連結**<br>1. 僅接受 `https://` 開頭且通過 URL 解析的網址。<br>2. 渲染時僅使用原生 `<img src={url} loading="lazy" referrerPolicy="no-referrer" />` 搭配 `onError` 降級。<br>3. 若使用者貼上的是 Imgur 相簿／分享頁（如 `https://imgur.com/a/xxx` 而非 `https://i.imgur.com/xxx.jpg`），不嘗試爬蟲或注入第三方 `<script>` embed，直接在 UI 顯示「外部圖片連結（點擊在新分頁開啟）」並附帶提示。 | 杜絕 SSRF（後端不去抓圖床網頁）、杜絕 XSS（不注入第三方 embed script），同時滿足 `PRD.md`「無法載入時保留連結；不能假設 Imgur 分享頁就是直連圖片」。 |

---

## 4. Review 結論與 Merge 前檢核

本次 Review 的採納結果：

1. **A1 採用**具名來源外鍵、軟刪除；不與多型表雙寫；跨私人／家庭來源關聯永不洩露未授權目標的存在性。
2. **A2 採用** `created_at` + `local_date` + 可空 `record_date`；索引效果需測量。
3. **A3 採用**單專案根目錄整合 Vite / Hono / Workers / Drizzle；`src/shared` 僅共用型別、純工具與驗證，不混入伺服器密碼或資料庫存取。
4. **D1–D7 採納為 MVP 預設**，另補充：D2 以軟刪除保 ID；D3 個人空間只顯示本人日記，家庭空間初期不顯示私人日記 icon；D4 事件須保留時區語意且全天日期不經 UTC 換日；D5 函式庫授權／更新狀況與閏月／節日資料需實測，不直接保證正確；D6 禁止最後一位 admin 在無交接下退出或被移除；D7 僅 https，分享頁降級一般連結，不進行後端抓取或第三方 script 注入。
5. **尚未定案的後續範圍**：訊息實體刪除／保留期限、群組跨國時區的切換行為、節慶資料的年度維護、超出 MVP 的搜尋／通知／匯出。

**合併流程**：本 PR 可作為已 Review 的決策紀錄 Merge；實作前需將上述決策同步到 `docs/ARCHITECTURE.md`、`docs/UX.md`、`docs/ROADMAP.md` 與涉及的 Issues，避免舊版的 `record_links` 方案被視為正式 Schema。此 PR 不建立資料庫、不修改執行程式，也不宣稱已驗收功能。
