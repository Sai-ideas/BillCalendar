# V0.3 規格審閱與 MVP 架構收斂提案（供 Agent / 開發者 Review）

- **狀態**：Proposed（待 Review，尚未合併為最終定案）
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

### 提案 A1：簡化訊息衍生紀錄的關聯模型（具名外鍵 vs. 多型 `record_links`）

- **現況（`docs/ARCHITECTURE.md`）**：
  - 定義了多型關聯表 `record_links(id, source_type, source_id, target_type, target_id, relation_type, created_by)`。
- **問題分析**：
  - 在 SQLite（Cloudflare D1）中，多型關聯無法使用原生 Foreign Key 約束（如 `ON DELETE SET NULL`）。
  - MVP 階段所有的關聯場景只有單一固定方向：**由一則 `message` 衍生出 `event`、`task`（雙向回溯）或複製為 `diary` 草稿**。
- **建議方案（二擇一供 Review）**：
  - **方案 A1-a（推薦，混合或具名外鍵）**：在 `events` 與 `tasks` 表直接保留 `source_message_id TEXT NULL REFERENCES messages(id) ON DELETE SET NULL`（或者保留 `record_links` 但在 `events`/`tasks` 同步記錄 `source_message_id`）。
    - **優點**：查詢事件／待辦時可單表得知是否有來源訊息；查某則訊息衍生了哪些紀錄時只需簡單索引；訊息若未來支援刪除，SQLite 可自動 `SET NULL` 或由應用層顯式標記 `source_deleted`。
  - **方案 A1-b（維持原案）**：完全使用 `record_links`，但於應用層嚴格限制 `source_type = 'message'` 且 `target_type IN ('event', 'task')`，並建立複合索引 `idx_record_links_source(source_type, source_id)` 與 `idx_record_links_target(target_type, target_id)`。

---

### 提案 A2：`messages` 表新增預算好的日曆日期欄位 `local_date` 與複合索引

- **現況（`docs/ARCHITECTURE.md`）**：
  - `messages` 欄位為 `(id, room_id, sender_user_id, body, created_at, record_date NULL)`。
  - 同時系統要求：`GET /api/calendar/month?year=YYYY&month=MM` 需回傳當月每天「是否有聊天紀錄」的摘要 icon，且點擊日期需快速定位到該聊天室當天的第一則訊息游標。
- **問題分析**：
  - 若 `created_at` 以 UTC 儲存，而月曆以 `Asia/Taipei`（或空間預設時區）呈現，在 D1 SQLite 查詢整月每天是否有訊息時，若動態對 `created_at` 做時區偏移字串切割，將無法有效命中索引並增加 D1 列掃描成本。
- **建議方案**：
  - 將 `record_date NULL` 明確定義為 **`local_date TEXT NOT NULL`**（格式 `YYYY-MM-DD`，於寫入訊息時依該聊天室／使用者時區預設 `Asia/Taipei` 計算寫入；若使用者指定補記日期則為指定日）。
  - 建立複合索引：`CREATE INDEX idx_messages_room_date_created ON messages(room_id, local_date, created_at, id);`。
  - **效益**：
    1. 月曆摘要查詢：`SELECT DISTINCT local_date FROM messages WHERE room_id = ? AND local_date BETWEEN '2026-10-01' AND '2026-10-31'` 可 100% Index-Only Scan。
    2. 日期定位游標：直接以 `WHERE room_id = ? AND local_date >= ? ORDER BY local_date ASC, created_at ASC LIMIT 1` 取得該日第一筆訊息 ID，再載入前後上下文。

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

## 4. 給 Reviewer Agent 的檢核問題（Review Checklist）

請另一個 Agent 在審閱本提案時協助確認以下問題：

1. **[Schema - A1]** 是否同意在 `events` / `tasks` 直接加上 `source_message_id`（或維持純 `record_links` 表）？
2. **[Schema - A2]** 是否同意在 `messages` 將日期欄位定名為 `local_date TEXT NOT NULL`（`YYYY-MM-DD`）並建立 `(room_id, local_date, created_at)` 索引以支援月曆存在性摘要與日期跳轉？
3. **[Project Layout - A3]** 是否同意採用單一倉庫根目錄整合 Vite + Hono + Cloudflare Workers + Drizzle 的目錄結構？
4. **[Open Decisions - D1~D7]** 上述 7 項針對 `ROADMAP.md` 未決事項的 MVP 預設方案是否有任何與原始規劃意圖衝突之處？

> 確認後，即可直接合併本分支（或於 PR 留言修正意見），並依據階段 1 啟動專案初始化與資料庫 Migration 建立。
