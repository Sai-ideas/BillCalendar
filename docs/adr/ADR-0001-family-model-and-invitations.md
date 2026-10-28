# ADR-0001: 家庭資料模型、角色權限與受控示範邀請機制

## 狀態
Accepted（已於 PR #18 審閱收斂，並由 Issue #3 規格明確採納）

## 作者識別與提案來源 (Attribution)
- **Idea origin**: Gemini / unspecified（源自 PR #18 審閱意見 D1 與 Issue #3 規格）
- **Decision**: accepted
- **Role**: author

---

## 背景與脈絡 (Context)
BillCalendar 定位為支援個人隨手記與多家庭協作的生活月曆系統。在進入月曆與事件功能前，必須確立家庭（Family）與成員（Member）的核心抽象與權限邊界。

依據 `docs/ROADMAP.md` 待決事項 D1 與 D6：
1. **無驗證郵件下的邀請流程**：本系統目前為受控示範應用，不依賴真實 SMTP 伺服器或外部郵件服務（Email 僅以 RFC 2606 保留之 `.test` 虛構網域模擬內部 `user_id`）。因此無法使用「寄發郵件點擊驗證連結」的傳統註冊機制。
2. **多家庭與權限角色邊界**：使用者可同時隸屬於多個家庭空間；家庭成員角色在 MVP 階段限定為 `admin` 與 `member`。
3. **資料安全防護**：家庭空間內的行程、待辦、記帳與聊天對非成員完全隔離；且家庭最後一位管理員（Last Admin）不得在未移交權限的情況下脫離家庭或被刪除，以防家庭空間孤兒化。

---

## 決策 (Decision)

### 1. 資料模型設計 (Schema)
在 Cloudflare D1（SQLite）中新增三張資料表：

#### (1) `families`
- `id` (TEXT, PK, UUID)
- `name` (TEXT, NOT NULL, 1–64 字元)
- `created_by` (TEXT, NOT NULL, REFERENCES `users(id)`)
- `created_at` (TEXT, NOT NULL, ISO 8601 UTC)
- `updated_at` (TEXT, NOT NULL, ISO 8601 UTC)

#### (2) `family_members`
- `id` (TEXT, PK, UUID)
- `family_id` (TEXT, NOT NULL, REFERENCES `families(id)` ON DELETE CASCADE)
- `user_id` (TEXT, NOT NULL, REFERENCES `users(id)` ON DELETE CASCADE)
- `role` (TEXT, NOT NULL, `'admin' | 'member'`)
- `joined_at` (TEXT, NOT NULL, ISO 8601 UTC)
- `updated_at` (TEXT, NOT NULL, ISO 8601 UTC)
- **限制條件**：
  - `UNIQUE(family_id, user_id)`：同一使用者在同一家庭僅能存在一筆成員紀錄，避免重複寫入。
  - 索引：`idx_family_members_user_id`（查詢使用者所屬家庭）、`idx_family_members_family_id`。

#### (3) `family_invitations`
- `id` (TEXT, PK, UUID)
- `family_id` (TEXT, NOT NULL, REFERENCES `families(id)` ON DELETE CASCADE)
- `invited_email` (TEXT, NOT NULL, 標準化小寫 Email)
- `invited_by` (TEXT, NOT NULL, REFERENCES `users(id)` ON DELETE CASCADE)
- `role` (TEXT, NOT NULL, DEFAULT `'member'`, `'admin' | 'member'`)
- `status` (TEXT, NOT NULL, DEFAULT `'pending'`, `'pending' | 'accepted' | 'rejected' | 'revoked'`)
- `expires_at` (TEXT, NULL, ISO 8601 UTC)
- `createdAt` (TEXT, NOT NULL, ISO 8601 UTC)
- `updatedAt` (TEXT, NOT NULL, ISO 8601 UTC)
- **限制條件**：
  - 索引：`idx_family_invitations_email_status`（供受邀者查詢待接受邀請）、`idx_family_invitations_family_id`。
  - 同一家庭對同一 Email 僅允許一筆狀態為 `pending` 的邀請，避免重複發送。

---

### 2. 角色與權限規範 (RBAC)

| 操作 | `admin` (管理員) | `member` (一般成員) | 非成員 / 已退出成員 |
| :--- | :---: | :---: | :---: |
| 查看家庭資訊與成員列表 | ✅ | ✅ | ❌ (403 Forbidden) |
| 修改家庭名稱 | ✅ | ❌ (403) | ❌ (403) |
| 發送新成員邀請 | ✅ (限 `.test` 網域) | ❌ (403) | ❌ (403) |
| 撤銷已發送的 pending 邀請 | ✅ | ❌ (403) | ❌ (403) |
| 移除其他成員 | ✅ (不得移除最後一位 admin) | ❌ (403) | ❌ (403) |
| 主動退出家庭 | ✅ (不得無交接退出最後一位 admin) | ✅ | ❌ |
| 共享家庭行程／待辦／記帳／聊天（後續階段） | ✅ | ✅ | ❌ (403) |

---

### 3. 受控示範邀請操作流程 (Workflow)

1. **發送邀請**：
   - 管理員在家庭設定中輸入受邀者 Email（必須符合 `.test` 虛構網域）。
   - 伺服端檢查：
     - 若受邀者已是該家庭成員，回應 `409 ALREADY_MEMBER`。
     - 若該 Email 已有狀態為 `pending` 的邀請，回應 `409 INVITATION_ALREADY_PENDING`。
   - 寫入 `family_invitations`，狀態為 `pending`。
2. **查詢待接受清單**：
   - 使用者切換／登入至該 Email 時，系統透過 `GET /api/invitations` 查詢所有 `invited_email == currentUser.emailNormalized AND status == 'pending'`。
   - UI 呈現醒目的「您有待處理的家庭邀請」提示卡片。
3. **接受邀請**：
   - 使用者點擊「接受」(`POST /api/invitations/:id/accept`)。
   - 伺服端以交易或原子操作寫入 `family_members`（角色為邀請指定角色，預設 `member`），並將邀請狀態更新為 `accepted`。
   - 若受邀者因重複請求已在家庭中，安全幂等處理，更新邀請為 `accepted`，不重複建立成員。
4. **拒絕邀請**：
   - 使用者點擊「拒絕」(`POST /api/invitations/:id/reject`)。
   - 伺服端將邀請狀態更新為 `rejected`，不建立成員紀錄。
5. **撤銷邀請**：
   - 管理員可於家庭管理介面檢視已送出且狀態為 `pending` 的邀請，並點擊「撤銷」(`POST /api/families/:id/invitations/:invId/revoke`)。
   - 伺服端將狀態更新為 `revoked`。
6. **最後一位管理員保護規則 (Last Admin Protection)**：
   - 成員主動退出 (`POST /api/families/:id/leave`) 或管理員移除他人 (`DELETE /api/families/:id/members/:userId`) 時，伺服端先計算該家庭現存 `role == 'admin'` 的總數。
   - 若受影響目標為 `admin` 且剩餘管理員數量為 1（即僅剩該管理員一人），拒絕執行並回傳 `400 LAST_ADMIN_CANNOT_LEAVE`，提示必須先將其他成員指派為管理員或交接，避免家庭無人可管理。

---

## 效益與後續影響 (Consequences)
1. **完全離線且無第三方 SMTP 依賴**：在開發與示範環境中，任意兩位測試者（如 Alice 與 Bob）可直觀驗證「邀請 ➔ 接受／拒絕 ➔ 成員空間共享 ➔ 權限退出失效」的完整狀態機。
2. **無縫銜接正式認證**：日後若引進 Google OIDC 或 Magic Link，只需將 Email 查找切換為真實驗證的帳號，整體 `family_members` 與 `family_invitations` 表結構與權限邏輯完全不需修改。
3. **資料一致性與防禦性**：以 SQLite unique index 及最後一位管理員檢查，徹底杜絕重複寫入與家庭孤兒化風險。
