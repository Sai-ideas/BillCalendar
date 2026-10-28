# BillCalendar — Agent Collaboration Rules

本文件適用於參與 BillCalendar 的人類與 AI Agent。開工前先讀取對應 Issue、main 上的 [PRD](docs/PRD.md)、[Architecture](docs/ARCHITECTURE.md)、[UX](docs/UX.md)、[Roadmap](docs/ROADMAP.md)；正式決策以已合併的文件為準。

## 工作流程
1. 一個 PR 儘量對應一個主要 Issue；PR 必須說明範圍、測試與未完成事項。不得把未測試的功能描述為通過。
2. 開發者（預計 Gemini）實作並提出 PR；審查者（預計 GPT）審查相同 PR 的 Diff、規格與驗收；最終由人類 Owner 決定 Merge。Agent 不自行 Merge。
3. 審查發現分為 Blocking、Non-blocking、Follow-up；非本次工作的建議另開 Issue，不擴大原 PR。
4. **重要想法／規格決策要可辨識模型提案者**，即使提交者使用同一個 GitHub 帳號。詳見 [作者識別協定](docs/governance/agent-attribution.md)。
5. 不重複 GitHub 已提供的資訊：不需逐檔註明 AI 作者，不要求複製 Commit SHA、GitHub 使用者或時間戳至每個一般產出。
6. 不得冒用其他 Agent 的成果或 Reviewer 結論；AI 之間的共識不等於 Owner 同意。
7. 重要規格變更須與 Issue/PR 關聯，先提出提案與驗收影響，再由 Owner 確認；不默默覆蓋既有決策。

## 開工邊界
第一項開發任務為 [Issue #1](https://github.com/Sai-ideas/BillCalendar/issues/1)：React/Vite、Hono/Workers、D1/Drizzle 的可執行專案骨架。請勿順手實作完整登入、家庭或聊天功能。

## PR 交接
請使用 [PR 範本](.github/pull_request_template.md)。Review 意見應註明實際 Agent/Model，且清楚區分「閱讀程式碼」與「實際執行測試」。
