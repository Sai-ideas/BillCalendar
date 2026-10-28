# Agent Attribution & Idea Provenance

**狀態：** Proposed，待此 Governance PR 經 Owner Merge 後生效。

## 目的與非目的
辨識 **哪個 AI Agent / 模型提出想法、做出修改或執行 Review**，尤其是 GitHub 共用帳號無法反映的作者資訊。GitHub 原生紀錄已可追蹤提交者、時間、Commits 與 Diff，因此不重複要求寫入上述資料。不以文字署名當作身份驗證或模型能力證明。

## 最低必要資訊
AI 起草的 PR、AI 參與的重要規格決策或正式 Review，記錄：
- **Agent**：如 Gemini、GPT、Codex、Claude；其他實際名稱亦可。
- **Model**：已知才填確切版本；未知填 `unspecified`，不可推測。
- **Role**：`author`、`reviewer`、`editor` 或 `handoff`。

Issue 內若有具體新想法，使用簡短的「Idea origin」段落或 Issue Comment 標明提案者。一般純工程任務 Issue 不強制標作者；不因後續別的 Agent 接手而改掉原始提案者。

### 重要設計想法的來源（必要）
任何會影響需求、UX 或資料模型的重要建議，應在**首次提出且保留的 Issue Comment、ADR 或 PR 提案段落**標註：
```text
Idea origin: Gemini / unspecified
Decision: proposed
```
例如「月曆依 selectedSpace 切換聊天圖示」可以回溯其提案者；之後 GPT 進行修正，追加「Reviewed/modified by: GPT / GPT-6」，**不覆寫原始來源**。若無可靠紀錄可辨識原提案者，寫 `unknown`，不得事後猜測。人工明確確認才標 `approved-by-owner`；合併本身不代表每個需求想法都獲得另外的產品批准。

### PR 交接與審查
開發 PR 以範本填 Agent/Model/Role、Issue、範圍、測試證據、限制與交接事項。
審查者在一份整體 Review 中標 Agent/Model/Role 與**Reviewed head SHA**（指明審過的程式碼版本）；SHA 可以直接引用 GitHub 的 Commit URL，不必每個 Comment 重貼。新 Commit 出現時，審查結論僅適用原 SHA，需按變更範圍再檢查。
- `Blocking`：必須修復。
- `Non-blocking`：建議改善但不阻擋合併。
- `Follow-up`：非本次交付，另開 Issue。

### 不額外要求
- 不強制每個程式碼檔案、每次 Commit 或每則短回覆帶 Agent 區塊。
- 不要求手動填 Date、GitHub 帳號、Commit Author、Commit ID（除非 Review 需綁定 head SHA）。
- 不要求 Agent 為既有歷史補作無來源根據的署名。

### 人類決策及交接
- Agent 不得以 AI 共識冒充 Owner 批准；如人類在 Issue/PR 明確決定，附連結即可。
- 新 Agent 接手時保留已寫下的 Idea origin 與 Review 紀錄，使用 Handoff 段落說明差異、待決事項及下一步。
- 正式基準以最新已合併規格／ADR 為準；新提案在未合併前是 Proposed，應提供連結而非直接宣稱規格已改。
- 這是可搜尋的**聲明型**作者標記，不是加密認證；模型、使用者與 GitHub 共用帳號需誠實填寫。
