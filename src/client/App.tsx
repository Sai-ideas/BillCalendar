import { type FormEvent, useCallback, useEffect, useState } from 'react';
import {
  DEFAULT_TIMEZONE,
  HealthResponseSchema,
  SYNTHETIC_IDENTITY_PRESETS,
  TEST_IDENTITY_SECURITY_NOTICE,
  TestIdentityStateResponseSchema,
  type HealthResponse,
  type TestIdentityStateResponse,
} from '../shared';

const SESSION_STORAGE_KEY = 'bc_test_session_id';

export function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [healthLoading, setHealthLoading] = useState<boolean>(true);

  const [identityState, setIdentityState] = useState<TestIdentityStateResponse | null>(null);
  const [identityError, setIdentityError] = useState<string | null>(null);
  const [identityLoading, setIdentityLoading] = useState<boolean>(true);
  const [submitting, setSubmitting] = useState<boolean>(false);

  const [emailInput, setEmailInput] = useState<string>('');
  const [displayNameInput, setDisplayNameInput] = useState<string>('');

  const baseUrl = import.meta.env.VITE_API_BASE_URL ?? '';

  const fetchIdentityState = useCallback(async () => {
    setIdentityLoading(true);
    try {
      const storedSessionId = window.localStorage.getItem(SESSION_STORAGE_KEY);
      const headers: Record<string, string> = {};
      if (storedSessionId) {
        headers['X-Test-Session-Id'] = storedSessionId;
      }

      const res = await fetch(`${baseUrl}/api/test-identity/state`, { headers });
      const json: unknown = await res.json();
      const parsed = TestIdentityStateResponseSchema.safeParse(json);
      if (!parsed.success) {
        throw new Error('Invalid test-identity state response format');
      }

      setIdentityState(parsed.data);
      setIdentityError(null);
      if (!parsed.data.sessionId) {
        window.localStorage.removeItem(SESSION_STORAGE_KEY);
      }
    } catch (err: unknown) {
      setIdentityError(err instanceof Error ? err.message : '無法讀取測試身份狀態');
    } finally {
      setIdentityLoading(false);
    }
  }, [baseUrl]);

  useEffect(() => {
    let active = true;

    fetch(`${baseUrl}/api/health`)
      .then(async (res) => {
        const json: unknown = await res.json();
        const parsed = HealthResponseSchema.safeParse(json);
        if (!parsed.success) {
          throw new Error('Invalid health API response format');
        }
        if (active) {
          setHealth(parsed.data);
          setHealthError(null);
        }
      })
      .catch((err: unknown) => {
        if (active) {
          setHealthError(err instanceof Error ? err.message : '無法連線至後端 Health API');
        }
      })
      .finally(() => {
        if (active) {
          setHealthLoading(false);
        }
      });

    void fetchIdentityState();

    return () => {
      active = false;
    };
  }, [baseUrl, fetchIdentityState]);

  const handleSelectIdentity = async (email: string, displayName?: string) => {
    setSubmitting(true);
    setIdentityError(null);
    try {
      const storedSessionId = window.localStorage.getItem(SESSION_STORAGE_KEY);
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (storedSessionId) {
        headers['X-Test-Session-Id'] = storedSessionId;
      }

      const res = await fetch(`${baseUrl}/api/test-identity/select`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ email, displayName }),
      });

      const json: unknown = await res.json();
      if (!res.ok) {
        const errMsg =
          typeof json === 'object' && json !== null && 'message' in json
            ? String((json as { message: unknown }).message)
            : '切換測試身份失敗';
        throw new Error(errMsg);
      }

      const parsed = TestIdentityStateResponseSchema.parse(json);
      if (parsed.sessionId) {
        window.localStorage.setItem(SESSION_STORAGE_KEY, parsed.sessionId);
      }
      setIdentityState(parsed);
      setEmailInput('');
      setDisplayNameInput('');
    } catch (err: unknown) {
      setIdentityError(err instanceof Error ? err.message : '切換測試身份失敗');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCustomSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!emailInput.trim()) return;
    void handleSelectIdentity(emailInput, displayNameInput || undefined);
  };

  const handleLogout = async () => {
    setSubmitting(true);
    setIdentityError(null);
    try {
      const storedSessionId = window.localStorage.getItem(SESSION_STORAGE_KEY);
      const headers: Record<string, string> = {};
      if (storedSessionId) {
        headers['X-Test-Session-Id'] = storedSessionId;
      }

      const res = await fetch(`${baseUrl}/api/test-identity/logout`, {
        method: 'POST',
        headers,
      });

      const json: unknown = await res.json();
      const parsed = TestIdentityStateResponseSchema.parse(json);
      window.localStorage.removeItem(SESSION_STORAGE_KEY);
      setIdentityState(parsed);
    } catch (err: unknown) {
      setIdentityError(err instanceof Error ? err.message : '清除測試身份失敗');
    } finally {
      setSubmitting(false);
    }
  };

  const currentUser = identityState?.currentUser ?? null;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div
        role="region"
        aria-label="測試模式安全提示"
        className="border-b border-amber-300 bg-amber-50 px-6 py-2.5 text-xs font-medium text-amber-900"
      >
        <div className="mx-auto flex max-w-5xl items-center gap-2">
          <span className="inline-flex shrink-0 items-center rounded-sm bg-amber-200 px-1.5 py-0.5 text-[11px] font-bold text-amber-950">
            測試模式（非安全驗證）
          </span>
          <span>{identityState?.securityNotice ?? TEST_IDENTITY_SECURITY_NOTICE}</span>
        </div>
      </div>

      <header className="border-b border-slate-200 bg-white px-6 py-4 shadow-xs">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900">
              BillCalendar — 生活行事曆 Demo
            </h1>
            <p className="text-xs text-slate-500">
              高密度月曆與家庭協作示範應用（目前階段：P1 測試身份模擬與系統骨架）
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
              預設時區：{health?.timezone ?? DEFAULT_TIMEZONE}
            </span>
            {currentUser ? (
              <div className="flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs">
                <span className="font-semibold text-indigo-950">{currentUser.displayName}</span>
                <span className="text-indigo-700">({currentUser.emailNormalized})</span>
              </div>
            ) : (
              <span className="rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-xs text-slate-600">
                尚未選擇測試身份
              </span>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 px-6 py-8">
        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                合成 Email 身份選擇器（Issue #2）
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                以標準化虛構 Email（自動 trim 與轉小寫）對應穩定內部 <code>user_id</code>。此功能僅用於模擬多使用者／跨家庭情境，不提供真實密碼或身份認證。
              </p>
            </div>
            {currentUser && (
              <button
                type="button"
                disabled={submitting}
                onClick={() => void handleLogout()}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                結束目前模擬身份
              </button>
            )}
          </div>

          {identityLoading && (
            <p className="mt-4 text-sm text-slate-600">正在載入測試身份狀態...</p>
          )}

          {identityError && (
            <div
              role="alert"
              className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700"
            >
              {identityError}
            </div>
          )}

          {!identityLoading && identityState && !identityState.enabled && (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              目前部署環境已禁用未驗證的測試 Email 身份模擬（公開／正式環境預設關閉）。
            </div>
          )}

          {!identityLoading && identityState?.enabled && (
            <div className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-2">
              <div className="space-y-4">
                <div>
                  <h3 className="text-xs font-semibold tracking-wider text-slate-500 uppercase">
                    快速切換預設合成帳號
                  </h3>
                  <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {SYNTHETIC_IDENTITY_PRESETS.map((preset) => {
                      const isActive = currentUser?.emailNormalized === preset.email;
                      return (
                        <button
                          key={preset.email}
                          type="button"
                          disabled={submitting}
                          onClick={() => void handleSelectIdentity(preset.email, preset.displayName)}
                          className={`flex flex-col items-start rounded-lg border p-3 text-left transition ${
                            isActive
                              ? 'border-indigo-600 bg-indigo-50/70 ring-1 ring-indigo-600'
                              : 'border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-white'
                          } disabled:opacity-50`}
                        >
                          <div className="flex w-full items-center justify-between">
                            <span className="text-sm font-semibold text-slate-900">
                              {preset.displayName}
                            </span>
                            {isActive && (
                              <span className="rounded-sm bg-indigo-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                                使用中
                              </span>
                            )}
                          </div>
                          <span className="mt-1 font-mono text-xs text-slate-600">
                            {preset.email}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {identityState.availableUsers.length > 0 && (
                  <div>
                    <h3 className="text-xs font-semibold tracking-wider text-slate-500 uppercase">
                      已建立的合成使用者（D1 users 表）
                    </h3>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {identityState.availableUsers.map((u) => {
                        const isActive = currentUser?.id === u.id;
                        return (
                          <button
                            key={u.id}
                            type="button"
                            disabled={submitting}
                            onClick={() => void handleSelectIdentity(u.emailNormalized)}
                            className={`rounded-md border px-2.5 py-1 text-xs font-medium transition ${
                              isActive
                                ? 'border-indigo-600 bg-indigo-600 text-white'
                                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                            } disabled:opacity-50`}
                          >
                            {u.displayName} ({u.emailNormalized})
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                <form onSubmit={handleCustomSubmit} className="space-y-3 pt-2">
                  <h3 className="text-xs font-semibold tracking-wider text-slate-500 uppercase">
                    輸入自訂虛構 Email 建立／切換身份
                  </h3>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <div>
                      <label htmlFor="synthetic-email" className="block text-xs font-medium text-slate-700">
                        虛構 Email（自動轉小寫與去空白）
                      </label>
                      <input
                        id="synthetic-email"
                        type="email"
                        required
                        placeholder="charlie.demo@billcalendar.test"
                        value={emailInput}
                        onChange={(e) => setEmailInput(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-indigo-600 focus:outline-hidden"
                      />
                    </div>
                    <div>
                      <label htmlFor="synthetic-name" className="block text-xs font-medium text-slate-700">
                        顯示名稱（選填）
                      </label>
                      <input
                        id="synthetic-name"
                        type="text"
                        placeholder="Charlie (選填)"
                        value={displayNameInput}
                        onChange={(e) => setDisplayNameInput(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-indigo-600 focus:outline-hidden"
                      />
                    </div>
                  </div>
                  <button
                    type="submit"
                    disabled={submitting || !emailInput.trim()}
                    className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                  >
                    以虛構 Email 建立／切換身份
                  </button>
                </form>
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <h3 className="text-xs font-semibold tracking-wider text-slate-500 uppercase">
                  目前模擬身份詳情（Internal Identity）
                </h3>
                {currentUser ? (
                  <dl className="mt-3 space-y-2.5 text-sm">
                    <div>
                      <dt className="text-xs text-slate-500">內部主鍵 (users.id)</dt>
                      <dd className="font-mono text-xs font-semibold text-slate-900">
                        {currentUser.id}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-500">標準化 Email (email_normalized UNIQUE)</dt>
                      <dd className="font-mono text-xs font-medium text-slate-900">
                        {currentUser.emailNormalized}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-500">顯示名稱 (display_name)</dt>
                      <dd className="font-medium text-slate-900">{currentUser.displayName}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-500">預設時區 (default_timezone)</dt>
                      <dd className="font-medium text-slate-900">{currentUser.defaultTimezone}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-500">測試 Session ID (test_sessions.id)</dt>
                      <dd className="font-mono text-xs text-slate-600">
                        {identityState.sessionId}
                      </dd>
                    </div>
                  </dl>
                ) : (
                  <p className="mt-3 text-sm text-slate-600">
                    尚未選擇身份。請點選左側「Alice (合成帳號 A)」或「Bob (合成帳號 B)」快速切換，或輸入任意虛構 Email。
                  </p>
                )}
              </div>
            </div>
          )}
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs">
          <h2 className="text-base font-semibold text-slate-900">
            專案骨架與系統狀態（Issue #1）
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            React + TypeScript + Vite 前端、Cloudflare Workers + Hono API 與 D1 / Drizzle 基礎架構。
          </p>

          <div className="mt-4 rounded-lg border border-slate-100 bg-slate-50 p-4 text-sm">
            {healthLoading && <p className="text-slate-600">正在檢查 `/api/health` 狀態...</p>}
            {!healthLoading && healthError && (
              <p className="font-medium text-red-600" role="alert">
                API 連線失敗：{healthError}
              </p>
            )}
            {!healthLoading && health && (
              <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-slate-500">API 狀態</dt>
                  <dd className="font-medium text-slate-900">{health.status}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">執行環境</dt>
                  <dd className="font-medium text-slate-900">{health.environment}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">D1 資料庫連線</dt>
                  <dd className="font-medium text-slate-900">
                    {health.database.connected ? '已連線' : '未連線'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">D1 Migration 狀態</dt>
                  <dd className="font-medium text-slate-900">
                    {health.database.migrated ? '已套用' : '未套用'}
                  </dd>
                </div>
              </dl>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
