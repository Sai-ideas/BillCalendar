# BillCalendar — 生活行事曆 Demo

版本：需求基準 V0.3（2026-10-27）。狀態：規劃／未實作。

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
- [V0.3 規格審閱與 MVP 架構收斂提案（待 Review）](docs/REVIEW_V0.3.md)

## 技術候選
React + TypeScript + Vite、Tailwind CSS、Cloudflare Workers + Hono、Cloudflare D1 + Drizzle ORM。初期聊天以輪詢為主；未決技術項目在 Roadmap 文件列出。尚未建立應用程式、CI 或正式部署。

## 儲存庫界線
本專案使用獨立 Repository；Issue 直接在此追蹤。
