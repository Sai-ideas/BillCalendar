# 技術架構與初步資料模型（V0.3）

本文件為 **PR #18 Review 後的 MVP 架構規格**，尚未實作；具體 SQL Schema 在開發 Issue 中驗證。

## 組件
- Client: React / TypeScript / Vite / Tailwind；響應式月曆及 PWA。
- API: Cloudflare Workers + Hono，統一檢查使用者、家庭成員與資料擁有權。
- Persistence: Cloudflare D1（SQLite）+ Drizzle migrations；僅文字、數值、URL、關聯，**不存圖片 BLOB**。
- 第一版訊息可使用低頻定期輪詢，將來必要時再評估 Durable Objects / WebSocket。
- 測試身份：輸入合成 Email -> 對應內部 user_id；並非可信認證，不可暴露為可存真實資料的公開服務。

## 邏輯資料表（名稱暫定）
| 表 | 核心欄位／限制 |
| --- | --- |
| users | id PK, email_normalized UNIQUE, display_name |
| test_sessions | id, user_id, expires_at；僅示範用 |
| families | id, name, created_by |
| family_members | family_id, user_id, role, UNIQUE(family_id,user_id) |
| family_invitations | family_id, invited_email, expires_at, status（測試邀請機制待定） |
| calendars | id, owner_user_id NULL, family_id NULL；恰有一種 owner |
| events | id, calendar_id, title, starts_at, ends_at, all_day, timezone, source_message_id NULL FK -> messages(id) |
| task_lists | id, owner_user_id NULL, family_id NULL |
| tasks | id, list_id, title, due_date NULL, completed_at NULL, source_message_id NULL FK -> messages(id) |
| ledgers | id, owner_user_id NULL, family_id NULL, currency |
| transactions | id, ledger_id, amount_minor, category_id, occurred_on, direction |
| diaries | id, user_id NOT NULL, entry_date, title, body |
| chat_rooms | id, kind(personal/family), user_id NULL, family_id NULL；每 user 一個 personal、每 family 一個 family |
| messages | id, room_id, sender_user_id, body, created_at UTC, local_date TEXT NOT NULL, record_date TEXT NULL, deleted_at NULL |
| image_links | id, attached_type, attached_id, https_url, created_by |

所有資料表另需 timestamps、索引、外鍵、資料校驗及刪除策略。MVP 不使用 `record_links` 儲存聊天衍生事件／待辦關聯，避免雙寫；同一訊息可建立多筆目標，每筆目標最多有一個 `source_message_id`。`image_links` 的多型掛載由應用層校驗與清理。訊息原則採 `deleted_at` 軟刪保留 ID，未來實體刪除時可採外鍵 `ON DELETE SET NULL`；保留期限仍待決策。

## 權限規則
1. 私人 `diaries`、個人聊天、個人待辦／行程／帳本：僅 owner 可讀。
2. 家庭資料：需確認 user 為 family_members 的有效成員；角色決定可寫範圍。
3. 群組訊息建立私人事件／待辦／日記不會繼承家庭共享權限。
4. 從訊息查看衍生事件／待辦、或反向引用來源訊息時，都要分別檢查**來源與目標權限**；家庭訊息衍生私人資料時，不得向其他家庭成員透露該私人資料的**存在性**。若已退出家庭、訊息遭刪除，回傳不可存取／已移除狀態。
5. 在所有 API 嚴格驗證身份，包含月曆摘要與圖片 URL，防止私人存在性資訊外洩。
6. Email 測試身份**不能提供安全隔離保證**；前述權限測試只驗證應用邏輯，不構成正式認證測試。

## 關鍵流程
- `GET /api/calendar/month?year=YYYY&month=MM`：取有權存取空間在該月的事件及各類「是否有紀錄」摘要。
- `GET /api/days/YYYY-MM-DD/summary`：所選日期的個人／家庭摘要（依範圍過濾）。
- 聊天訊息分頁／日期定位：先依 room 與日期取得游標，再抓取附近頁面；不得下載全聊天室。
- 建立事件／待辦時傳來源 message id，於同一資料建立動作寫入 `source_message_id`，並驗證該訊息的閱讀權限。
- 閱讀事件關聯訊息時驗證 event 與 message 雙端權限。
- 使用 `Asia/Taipei` 作第一版預設日曆時區；UTC 保存瞬間、LocalDate 保存全天事件與日記日期。

## 安全／部署欄位
- Workers 綁定 D1；明確分離 dev/staging/prod 資料庫，不在 git 中提交秘密。
- 合成帳號與資料，限制外部進入；正式上線前換成受驗證登入（例如 Google OIDC 或 magic link）。
- URL 僅允許 https，禁止 HTML 注入；對外部圖床加 CSP、referrer policy 與失效處理。
- SQL 參數化、輸入長度限制、速率限制、版本化 migration、基本備份／恢復演練。

## PR #18 MVP 決策補充
- 專案採單一 Vite + Hono + Workers + Drizzle 配置：`src/client`、`src/server`、`src/shared`（shared 僅純型別、驗證、共用工具）。
- `messages.local_date` 是發送當下、依聊天室時區（預設 Asia/Taipei）換算的日曆日期；`record_date` 是可選補記日期，不能互相覆寫。
- 查詢建議索引：`CREATE INDEX idx_messages_room_date_created ON messages(room_id, local_date, created_at, id);`。訊息完整時間軸依 `created_at, id` 排序；依日期定位先找當日訊息再載入相鄰上下文；以 EXPLAIN QUERY PLAN 實測。
- 全天事件、待辦截止日、日記日及記帳日採 YYYY-MM-DD 純日期，不以 UTC 強制換日；具時間事件儲存 UTC 時間與來源時區資訊。
- 家庭邀請為站內 pending/accepted/rejected；admin/member 雙角色，最後一名 admin 不得在未交接下退出或被移除。
- 外部圖片僅安全 HTTPS URL，直連 img 預覽、分享頁以一般連結降級，無伺服器抓取、第三方 script 或上傳。
- [Review 決策詳情](REVIEW_V0.3.md)。
