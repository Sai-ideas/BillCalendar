# BillCalendar — 生活行事曆 Demo

版本：需求基準 V0.3（2026-10-27）。狀態：Issue #1 專案骨架與 Issue #2 測試 Email 身份模擬已建立（後續功能模組按階段實作中）。

BillCalendar 是在 `Sai-ideas/BillCalendar` 獨立儲存庫開發的示範應用，參考 Jorte 的月曆呈現與 ienon 的家庭協作。核心理念為**資料模組獨立、日期視圖整合**：月曆導航、聊天快速記錄、行程／待辦／記帳／私人日記結構化管理。

## 已確定範圍
- 響應式 Web／PWA；桌面版左月曆、右功能分頁（摘要、心情、聊天、記帳、待辦、日記）。
- 西曆及農曆並列；日期格顯示行程、待辦，以及聊天、帳本、日記有紀錄的圖示。點擊日期或圖示開啟相應日期與分頁。
- 個人心情＝**個人聊天室**（僅命名差異），可作快速筆記及 emoji；每個家庭恰好一個全員可參與的聊天室。
- 從訊息建立事件或待辦並雙向導航回來源訊息；訊息可複製為**私人**日記草稿。
- 個人及家庭行事曆、待辦、記帳；日記永遠只有私人用途。
- 圖片僅由使用者提供外部 HTTPS URL（例如合法的 Imgur 嵌入／直接連結）；**不做檔案上傳、不用 R2、不存 BLOB、不做 WebP 壓縮**。
- 第一可測版可用輸入虛構 Email 選擇測試身份；不具備真正登入安全性，不得部署為公開可存真實資料的正式服務。

## 規劃文件
- [需求與驗收](docs/PRD.md)
- [技術架構與資料模型](docs/ARCHITECTURE.md)
- [介面與操作流程](docs/UX.md)
- [實作階段與未決事項](docs/ROADMAP.md)
- [V0.3 規格審閱與 MVP 架構收斂提案（已審閱）](docs/REVIEW_V0.3.md)

## 專案結構（Single-Repo Vite + Hono + Workers + D1）
```text
BillCalendar/
├── src/
│   ├── client/        # React + TypeScript + Tailwind CSS + Vite 前端
│   ├── server/        # Cloudflare Workers + Hono API routes + Drizzle D1 連線與 Schema
│   └── shared/        # 前後端共用純型別、Zod 驗證與常數（嚴禁匯入 DB 或伺服器秘密）
├── drizzle/           # 版本化 D1 SQL migrations
├── wrangler.toml      # Cloudflare Workers + D1 binding 設定（不使用 R2）
└── vite.config.ts     # Vite 建置與本機 /api 代理設定
```

## 環境變數、安全邊界與部署配置分離
本專案嚴格區分「本機受控測試環境」與「公開／正式部署配置」，**請勿將實際秘密或真實個資提交至版本控制或輸入系統**：

1. **測試／正式環境分離（`wrangler.toml`）**
   - **預設／公開正式配置（Top-level production）**：`APP_ENV = "production"`、`ALLOW_TEST_IDENTITY = "false"`，綁定獨立資料庫 `billcalendar-db-prod`。公開入口**預設禁用**未驗證的測試 Email 身份模擬（呼叫 `/api/test-identity/*` 一律回傳 `403 Forbidden`）。
   - **Staging 配置（`[env.staging]`）**：`APP_ENV = "staging"`、`ALLOW_TEST_IDENTITY = "false"`，綁定獨立資料庫 `billcalendar-db-staging`。
   - **本機開發／受控 Demo 配置（`[env.development]`）**：`APP_ENV = "development"`、`ALLOW_TEST_IDENTITY = "true"`，綁定本地資料庫 `billcalendar-db`。即使設定 `ALLOW_TEST_IDENTITY = "true"`，只要 `APP_ENV === "production"`，後端仍強制拒絕啟用測試身份模擬。

2. **Cloudflare Workers 本地環境變數（`.dev.vars`）**
   - 可複製 `.dev.vars.example` 為 `.dev.vars`：
     - `APP_ENV`：執行環境標識（本機為 `development`）。
     - `ALLOW_TEST_IDENTITY`：是否啟用虛構 Email 身份模擬（僅本機／受控測試設為 `true`，公開環境預設關閉）。
     - `DEFAULT_TIMEZONE`：預設日曆與訊息本地日期時區（預設 `Asia/Taipei`）。

3. **Vite 前端環境變數（`.env`）**
   - 可複製 `.env.example` 為 `.env`：
     - `VITE_API_BASE_URL`：API 基底路徑（預設留空，本機開發由 Vite Dev Server 將 `/api/*` 代理至 `http://127.0.0.1:8787`）。

## 本機開發與啟動方式

### 1. 安裝依賴
```bash
npm install
```

### 2. 套用本機 D1 Migration（從空庫初始化）
```bash
npm run db:migrate:local
```
> 若修改了 `src/server/db/schema.ts`，可執行 `npm run db:generate` 產生新的 Drizzle SQL migration。

### 3. 啟動本機開發環境
- **同時啟動前後端（推薦）**：
  ```bash
  npm run dev
  ```
  - 前端（Vite）：`http://localhost:5173`
  - 後端（Wrangler Workers `--env development` + Local D1）：`http://127.0.0.1:8787`
  - Health API：`http://127.0.0.1:8787/api/health`（或經前端代理 `http://localhost:5173/api/health`）
  - 測試身份模擬 API：
    - `GET /api/test-identity/state`
    - `POST /api/test-identity/select`
    - `POST /api/test-identity/logout`

- **分別啟動**：
  ```bash
  npm run dev:api     # 啟動 Workers API (port 8787, --env development)
  npm run dev:client  # 啟動 Vite 前端 (port 5173)
  ```

### 4. 型別檢查、建置與測試
```bash
npm run typecheck   # TypeScript 前後端型別檢查 (tsc -b)
npm run build       # 建置前端資產至 dist/client
npm test            # 執行 Vitest 自動化測試（含空庫 migration、Health API 與測試身份安全邊界驗證）
```

## 儲存庫界線
本專案使用獨立 Repository；Issue 直接在此追蹤。
