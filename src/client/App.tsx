import { type FormEvent, useCallback, useEffect, useState } from 'react';
import {
  DATA_OWNERSHIP_SECURITY_NOTICE,
  DEFAULT_TIMEZONE,
  HealthResponseSchema,
  SYNTHETIC_IDENTITY_PRESETS,
  TEST_IDENTITY_SECURITY_NOTICE,
  TestIdentityStateResponseSchema,
  type AuthorizedSpaceOverview,
  type FamilyDetail,
  type FamilyInvitationSummary,
  type FamilySummary,
  createInitialCalendarNavigationState,
  type CalendarNavigationState,
  type HealthResponse,
  type TestIdentityStateResponse,
} from '../shared';
import { CalendarWorkspace } from './components/CalendarWorkspace';

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

  // Family state (Issue #3)
  const [families, setFamilies] = useState<FamilySummary[]>([]);
  const [selectedFamilyId, setSelectedFamilyId] = useState<string | null>(null);
  const [familyDetail, setFamilyDetail] = useState<FamilyDetail | null>(null);
  const [familyLoading, setFamilyLoading] = useState<boolean>(false);
  const [pendingInvitations, setPendingInvitations] = useState<FamilyInvitationSummary[]>([]);
  const [spaceOverview, setSpaceOverview] = useState<AuthorizedSpaceOverview | null>(null);

  // Calendar & Right Panel Tabs state (Issue #5)
  const [calendarNavState, setCalendarNavState] = useState<CalendarNavigationState>(() =>
    createInitialCalendarNavigationState(),
  );

  // Family form states
  const [newFamilyName, setNewFamilyName] = useState<string>('');
  const [inviteEmailInput, setInviteEmailInput] = useState<string>('');
  const [inviteRoleInput, setInviteRoleInput] = useState<'admin' | 'member'>('member');
  const [isEditingName, setIsEditingName] = useState<boolean>(false);
  const [renameInput, setRenameInput] = useState<string>('');

  const [familyMessage, setFamilyMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const baseUrl = import.meta.env.VITE_API_BASE_URL ?? '';

  const getAuthHeaders = (): Record<string, string> => {
    const storedSessionId = window.localStorage.getItem(SESSION_STORAGE_KEY);
    const headers: Record<string, string> = {};
    if (storedSessionId) {
      headers['X-Test-Session-Id'] = storedSessionId;
    }
    return headers;
  };

  const fetchIdentityState = useCallback(async () => {
    setIdentityLoading(true);
    try {
      const headers = getAuthHeaders();
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

  const fetchPendingInvitations = useCallback(async () => {
    const storedSessionId = window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (!storedSessionId) {
      setPendingInvitations([]);
      return;
    }
    try {
      const res = await fetch(`${baseUrl}/api/invitations`, {
        headers: getAuthHeaders(),
      });
      if (res.ok) {
        const data = (await res.json()) as FamilyInvitationSummary[];
        setPendingInvitations(data);
      } else {
        setPendingInvitations([]);
      }
    } catch {
      setPendingInvitations([]);
    }
  }, [baseUrl]);

  const fetchFamilies = useCallback(
    async (selectIdAfterFetch?: string) => {
      const storedSessionId = window.localStorage.getItem(SESSION_STORAGE_KEY);
      if (!storedSessionId) {
        setFamilies([]);
        setSelectedFamilyId(null);
        setFamilyDetail(null);
        return;
      }
      setFamilyLoading(true);
      try {
        const res = await fetch(`${baseUrl}/api/families`, {
          headers: getAuthHeaders(),
        });
        if (res.ok) {
          const data = (await res.json()) as FamilySummary[];
          setFamilies(data);
          const targetId = selectIdAfterFetch ?? selectedFamilyId ?? data[0]?.id ?? null;
          if (targetId && data.some((f) => f.id === targetId)) {
            setSelectedFamilyId(targetId);
          } else if (data.length > 0) {
            setSelectedFamilyId(data[0].id);
          } else {
            setSelectedFamilyId(null);
            setFamilyDetail(null);
          }
        } else {
          setFamilies([]);
          setSelectedFamilyId(null);
          setFamilyDetail(null);
        }
      } catch {
        setFamilies([]);
      } finally {
        setFamilyLoading(false);
      }
    },
    [baseUrl, selectedFamilyId],
  );

  const fetchFamilyDetail = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`${baseUrl}/api/families/${id}`, {
          headers: getAuthHeaders(),
        });
        if (res.ok) {
          const detail = (await res.json()) as FamilyDetail;
          setFamilyDetail(detail);
          setRenameInput(detail.name);
        } else {
          setFamilyDetail(null);
        }
      } catch {
        setFamilyDetail(null);
      }
    },
    [baseUrl],
  );

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

  const fetchSpaceOverview = useCallback(async () => {
    const storedSessionId = window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (!storedSessionId) {
      setSpaceOverview(null);
      return;
    }
    try {
      const res = await fetch(`${baseUrl}/api/spaces`, {
        headers: getAuthHeaders(),
      });
      if (res.ok) {
        const data = (await res.json()) as AuthorizedSpaceOverview;
        setSpaceOverview(data);
      } else {
        setSpaceOverview(null);
      }
    } catch {
      setSpaceOverview(null);
    }
  }, [baseUrl]);

  useEffect(() => {
    if (identityState?.currentUser) {
      void fetchFamilies();
      void fetchPendingInvitations();
      void fetchSpaceOverview();
    } else {
      setFamilies([]);
      setSelectedFamilyId(null);
      setFamilyDetail(null);
      setPendingInvitations([]);
      setSpaceOverview(null);
    }
  }, [identityState?.currentUser, fetchFamilies, fetchPendingInvitations, fetchSpaceOverview]);

  useEffect(() => {
    if (selectedFamilyId) {
      void fetchFamilyDetail(selectedFamilyId);
    } else {
      setFamilyDetail(null);
    }
  }, [selectedFamilyId, fetchFamilyDetail]);

  const handleSelectIdentity = async (email: string, displayName?: string) => {
    setSubmitting(true);
    setIdentityError(null);
    setFamilyMessage(null);
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...getAuthHeaders(),
      };

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
      setSelectedFamilyId(null);
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
    setFamilyMessage(null);
    try {
      const res = await fetch(`${baseUrl}/api/test-identity/logout`, {
        method: 'POST',
        headers: getAuthHeaders(),
      });

      const json: unknown = await res.json();
      const parsed = TestIdentityStateResponseSchema.parse(json);
      window.localStorage.removeItem(SESSION_STORAGE_KEY);
      setIdentityState(parsed);
      setFamilies([]);
      setSelectedFamilyId(null);
      setFamilyDetail(null);
      setPendingInvitations([]);
    } catch (err: unknown) {
      setIdentityError(err instanceof Error ? err.message : '清除測試身份失敗');
    } finally {
      setSubmitting(false);
    }
  };

  // Family handlers
  const handleCreateFamily = async (e: FormEvent) => {
    e.preventDefault();
    if (!newFamilyName.trim()) return;
    setFamilyMessage(null);
    try {
      const res = await fetch(`${baseUrl}/api/families`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        body: JSON.stringify({ name: newFamilyName.trim() }),
      });
      const data = (await res.json()) as { id?: string; message?: string };
      if (!res.ok) {
        throw new Error(data.message ?? '建立家庭失敗');
      }
      setNewFamilyName('');
      setFamilyMessage({ type: 'success', text: '家庭建立成功！您已成為管理員。' });
      await fetchFamilies(data.id);
    } catch (err: unknown) {
      setFamilyMessage({
        type: 'error',
        text: err instanceof Error ? err.message : '建立家庭失敗',
      });
    }
  };

  const handleRenameFamily = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedFamilyId || !renameInput.trim()) return;
    setFamilyMessage(null);
    try {
      const res = await fetch(`${baseUrl}/api/families/${selectedFamilyId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        body: JSON.stringify({ name: renameInput.trim() }),
      });
      const data = (await res.json()) as { message?: string };
      if (!res.ok) {
        throw new Error(data.message ?? '修改家庭名稱失敗');
      }
      setIsEditingName(false);
      setFamilyMessage({ type: 'success', text: '家庭名稱已更新！' });
      await fetchFamilies(selectedFamilyId);
      await fetchFamilyDetail(selectedFamilyId);
    } catch (err: unknown) {
      setFamilyMessage({
        type: 'error',
        text: err instanceof Error ? err.message : '修改名稱失敗',
      });
    }
  };

  const handleSendInvite = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedFamilyId || !inviteEmailInput.trim()) return;
    setFamilyMessage(null);
    try {
      const res = await fetch(`${baseUrl}/api/families/${selectedFamilyId}/invitations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        body: JSON.stringify({
          email: inviteEmailInput.trim(),
          role: inviteRoleInput,
        }),
      });
      const data = (await res.json()) as { message?: string };
      if (!res.ok) {
        throw new Error(data.message ?? '發送邀請失敗');
      }
      setInviteEmailInput('');
      setFamilyMessage({ type: 'success', text: '邀請已送出！受邀者切換登入後即可在站內接受。' });
      await fetchFamilyDetail(selectedFamilyId);
    } catch (err: unknown) {
      setFamilyMessage({
        type: 'error',
        text: err instanceof Error ? err.message : '發送邀請失敗',
      });
    }
  };

  const handleRevokeInvite = async (invitationId: string) => {
    if (!selectedFamilyId) return;
    setFamilyMessage(null);
    try {
      const res = await fetch(
        `${baseUrl}/api/families/${selectedFamilyId}/invitations/${invitationId}/revoke`,
        {
          method: 'POST',
          headers: getAuthHeaders(),
        },
      );
      const data = (await res.json()) as { message?: string };
      if (!res.ok) {
        throw new Error(data.message ?? '撤銷邀請失敗');
      }
      setFamilyMessage({ type: 'success', text: '邀請已撤銷' });
      await fetchFamilyDetail(selectedFamilyId);
    } catch (err: unknown) {
      setFamilyMessage({
        type: 'error',
        text: err instanceof Error ? err.message : '撤銷邀請失敗',
      });
    }
  };

  const handleRemoveMember = async (userId: string, displayName: string) => {
    if (!selectedFamilyId) return;
    if (!confirm(`確定要將 ${displayName} 從家庭中移除嗎？`)) return;
    setFamilyMessage(null);
    try {
      const res = await fetch(`${baseUrl}/api/families/${selectedFamilyId}/members/${userId}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      const data = (await res.json()) as { message?: string };
      if (!res.ok) {
        throw new Error(data.message ?? '移除成員失敗');
      }
      setFamilyMessage({ type: 'success', text: `已移除成員 ${displayName}` });
      await fetchFamilyDetail(selectedFamilyId);
      await fetchFamilies(selectedFamilyId);
    } catch (err: unknown) {
      setFamilyMessage({
        type: 'error',
        text: err instanceof Error ? err.message : '移除成員失敗',
      });
    }
  };

  const handleUpdateMemberRole = async (
    userId: string,
    newRole: 'admin' | 'member',
    displayName: string,
  ) => {
    if (!selectedFamilyId) return;
    setFamilyMessage(null);
    try {
      const res = await fetch(`${baseUrl}/api/families/${selectedFamilyId}/members/${userId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        body: JSON.stringify({ role: newRole }),
      });
      const data = (await res.json()) as { message?: string };
      if (!res.ok) {
        throw new Error(data.message ?? '變更成員角色失敗');
      }
      setFamilyMessage({
        type: 'success',
        text: `已成功將 ${displayName} 的角色變更為 ${newRole === 'admin' ? '管理員' : '一般成員'}`,
      });
      await fetchFamilyDetail(selectedFamilyId);
      await fetchFamilies(selectedFamilyId);
    } catch (err: unknown) {
      setFamilyMessage({
        type: 'error',
        text: err instanceof Error ? err.message : '變更成員角色失敗',
      });
    }
  };

  const handleLeaveFamily = async () => {
    if (!selectedFamilyId || !familyDetail) return;
    if (!confirm(`確定要退出「${familyDetail.name}」嗎？退出後您將無法再存取該家庭空間。`)) return;
    setFamilyMessage(null);
    try {
      const res = await fetch(`${baseUrl}/api/families/${selectedFamilyId}/leave`, {
        method: 'POST',
        headers: getAuthHeaders(),
      });
      const data = (await res.json()) as { message?: string };
      if (!res.ok) {
        throw new Error(data.message ?? '退出家庭失敗');
      }
      setFamilyMessage({ type: 'success', text: `已成功退出「${familyDetail.name}」` });
      setSelectedFamilyId(null);
      await fetchFamilies();
    } catch (err: unknown) {
      setFamilyMessage({
        type: 'error',
        text: err instanceof Error ? err.message : '退出家庭失敗',
      });
    }
  };

  const handleAcceptInvite = async (invitationId: string) => {
    setFamilyMessage(null);
    try {
      const res = await fetch(`${baseUrl}/api/invitations/${invitationId}/accept`, {
        method: 'POST',
        headers: getAuthHeaders(),
      });
      const data = (await res.json()) as { familyId?: string; message?: string };
      if (!res.ok) {
        throw new Error(data.message ?? '接受邀請失敗');
      }
      setFamilyMessage({ type: 'success', text: '已加入家庭！' });
      await fetchPendingInvitations();
      await fetchFamilies(data.familyId);
    } catch (err: unknown) {
      setFamilyMessage({
        type: 'error',
        text: err instanceof Error ? err.message : '接受邀請失敗',
      });
    }
  };

  const handleRejectInvite = async (invitationId: string) => {
    setFamilyMessage(null);
    try {
      const res = await fetch(`${baseUrl}/api/invitations/${invitationId}/reject`, {
        method: 'POST',
        headers: getAuthHeaders(),
      });
      const data = (await res.json()) as { message?: string };
      if (!res.ok) {
        throw new Error(data.message ?? '拒絕邀請失敗');
      }
      setFamilyMessage({ type: 'success', text: '已拒絕家庭邀請' });
      await fetchPendingInvitations();
    } catch (err: unknown) {
      setFamilyMessage({
        type: 'error',
        text: err instanceof Error ? err.message : '拒絕邀請失敗',
      });
    }
  };

  const currentUser = identityState?.currentUser ?? null;
  const isAdmin = familyDetail?.myRole === 'admin';

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
              高密度月曆與家庭協作示範應用（階段：P1 資料擁有權與權限中介層／家庭模型／測試身份模擬）
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

      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6">
        {/* Main Calendar Layout & Right-Hand Function Tabs (Issue #5) */}
        <CalendarWorkspace
          navState={calendarNavState}
          onChangeNavState={setCalendarNavState}
          families={families}
          onSelectFamilySpace={(fid) => setSelectedFamilyId(fid)}
        />
        {/* Global Action Message */}
        {familyMessage && (
          <div
            role="alert"
            className={`flex items-center justify-between rounded-lg border px-4 py-3 text-sm font-medium ${
              familyMessage.type === 'success'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                : 'border-red-200 bg-red-50 text-red-700'
            }`}
          >
            <span>{familyMessage.text}</span>
            <button
              type="button"
              onClick={() => setFamilyMessage(null)}
              className="text-xs underline hover:no-underline"
            >
              關閉
            </button>
          </div>
        )}

        {/* Pending Invitations Banner (Issue #3) */}
        {currentUser && pendingInvitations.length > 0 && (
          <section className="rounded-xl border border-indigo-200 bg-indigo-50/80 p-5 shadow-xs">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-2.5 w-2.5 rounded-full bg-indigo-600 animate-pulse" />
              <h2 className="text-sm font-bold text-indigo-950">
                待接受的家庭邀請（{pendingInvitations.length} 則）
              </h2>
            </div>
            <div className="mt-3 space-y-3">
              {pendingInvitations.map((inv) => (
                <div
                  key={inv.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-indigo-100 bg-white p-3 shadow-xs"
                >
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      「{inv.familyName}」邀請您加入
                    </p>
                    <p className="text-xs text-slate-600">
                      邀請人：{inv.invitedByDisplayName} ｜ 指派角色：
                      <span className="font-semibold text-slate-800">
                        {inv.role === 'admin' ? '管理員 (admin)' : '成員 (member)'}
                      </span>
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void handleAcceptInvite(inv.id)}
                      className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700"
                    >
                      接受加入
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleRejectInvite(inv.id)}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      拒絕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Family Model & Collaboration Section (Issue #3) */}
        {currentUser && (
          <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-150 pb-4">
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  家庭模型、成員與示範邀請（Issue #3）
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  支援單一使用者加入多個家庭空間、成員角色（admin / member）權限邊界、站內邀請與最後管理員退出防護。
                </p>
              </div>

              {/* Create new family form inline */}
              <form onSubmit={handleCreateFamily} className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="輸入新家庭名稱..."
                  value={newFamilyName}
                  onChange={(e) => setNewFamilyName(e.target.value)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-indigo-600 focus:outline-hidden"
                />
                <button
                  type="submit"
                  disabled={!newFamilyName.trim()}
                  className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  + 建立家庭
                </button>
              </form>
            </div>

            {/* Families Tabs / Switcher */}
            <div className="mt-5">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold tracking-wider text-slate-500 uppercase">
                  我的家庭空間（點選切換）
                </h3>
                {familyLoading && <span className="text-xs text-slate-400">更新中...</span>}
              </div>

              {families.length === 0 ? (
                <div className="mt-3 rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
                  您目前尚未加入任何家庭。請在上方建立新家庭，或由其他成員透過虛構 Email 發送邀請！
                </div>
              ) : (
                <div className="mt-2 flex flex-wrap gap-2">
                  {families.map((fam) => {
                    const isSelected = selectedFamilyId === fam.id;
                    return (
                      <button
                        key={fam.id}
                        type="button"
                        onClick={() => setSelectedFamilyId(fam.id)}
                        className={`flex items-center gap-2 rounded-lg border px-3.5 py-2 text-xs font-medium transition ${
                          isSelected
                            ? 'border-indigo-600 bg-indigo-50 text-indigo-900 ring-1 ring-indigo-600'
                            : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                        }`}
                      >
                        <span className="font-semibold">{fam.name}</span>
                        <span
                          className={`rounded-sm px-1.5 py-0.5 text-[10px] font-semibold ${
                            fam.myRole === 'admin'
                              ? 'bg-purple-100 text-purple-800'
                              : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {fam.myRole === 'admin' ? '管理員' : '成員'}
                        </span>
                        <span className="text-[11px] text-slate-400">({fam.memberCount} 人)</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Selected Family Detail Workspace */}
            {familyDetail && (
              <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50/60 p-5">
                <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
                  <div className="flex items-center gap-3">
                    {isEditingName && isAdmin ? (
                      <form onSubmit={handleRenameFamily} className="flex items-center gap-2">
                        <input
                          type="text"
                          value={renameInput}
                          onChange={(e) => setRenameInput(e.target.value)}
                          className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-sm font-semibold text-slate-900 focus:border-indigo-600 focus:outline-hidden"
                        />
                        <button
                          type="submit"
                          className="rounded-md bg-slate-900 px-2.5 py-1 text-xs font-semibold text-white hover:bg-slate-800"
                        >
                          儲存
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setIsEditingName(false);
                            setRenameInput(familyDetail.name);
                          }}
                          className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
                        >
                          取消
                        </button>
                      </form>
                    ) : (
                      <div className="flex items-center gap-2">
                        <h3 className="text-base font-bold text-slate-900">{familyDetail.name}</h3>
                        {isAdmin && (
                          <button
                            type="button"
                            onClick={() => setIsEditingName(true)}
                            className="text-xs text-slate-500 hover:text-indigo-600 underline"
                          >
                            修改名稱
                          </button>
                        )}
                      </div>
                    )}

                    <span
                      className={`rounded-sm px-2 py-0.5 text-xs font-semibold ${
                        familyDetail.myRole === 'admin'
                          ? 'bg-purple-100 text-purple-800'
                          : 'bg-slate-200 text-slate-800'
                      }`}
                    >
                      您的角色：{familyDetail.myRole === 'admin' ? '管理員 (admin)' : '一般成員 (member)'}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => void handleLeaveFamily()}
                    className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
                  >
                    退出該家庭
                  </button>
                </div>

                {/* Family Members List */}
                <div className="mt-5">
                  <h4 className="text-xs font-semibold tracking-wider text-slate-500 uppercase">
                    現有成員列表（{familyDetail.members.length} 人）
                  </h4>
                  <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {familyDetail.members.map((m) => {
                      const isMe = m.userId === currentUser.id;
                      return (
                        <div
                          key={m.id}
                          className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-3 shadow-2xs"
                        >
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold text-slate-900">
                                {m.displayName}
                              </span>
                              {isMe && (
                                <span className="rounded-sm bg-indigo-50 px-1.5 py-0.2 text-[10px] font-bold text-indigo-700">
                                  本人
                                </span>
                              )}
                            </div>
                            <p className="font-mono text-xs text-slate-500">{m.emailNormalized}</p>
                            <span
                              className={`mt-1 inline-block rounded-xs px-1.5 py-0.5 text-[10px] font-medium ${
                                m.role === 'admin'
                                  ? 'bg-purple-50 text-purple-700'
                                  : 'bg-slate-100 text-slate-600'
                              }`}
                            >
                              {m.role === 'admin' ? '管理員' : '一般成員'}
                            </span>
                          </div>

                          {isAdmin && !isMe && (
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() =>
                                  void handleUpdateMemberRole(
                                    m.userId,
                                    m.role === 'admin' ? 'member' : 'admin',
                                    m.displayName,
                                  )
                                }
                                className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                              >
                                {m.role === 'admin' ? '降為成員' : '升為管理員'}
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleRemoveMember(m.userId, m.displayName)}
                                className="rounded-md border border-slate-200 px-2 py-1 text-[11px] font-medium text-red-600 hover:border-red-300 hover:bg-red-50"
                              >
                                移除
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Admin-only Invitation Management */}
                {isAdmin ? (
                  <div className="mt-6 border-t border-slate-200 pt-5">
                    <h4 className="text-xs font-semibold tracking-wider text-slate-500 uppercase">
                      發送新成員邀請（限管理員）
                    </h4>
                    <form onSubmit={handleSendInvite} className="mt-3 space-y-3">
                      <div className="flex flex-wrap items-center gap-3">
                        <div className="flex-1 min-w-[240px]">
                          <input
                            type="email"
                            required
                            placeholder="輸入受邀者 Email（限 *.test，例如 bob.demo@billcalendar.test）"
                            value={inviteEmailInput}
                            onChange={(e) => setInviteEmailInput(e.target.value)}
                            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-indigo-600 focus:outline-hidden"
                          />
                        </div>
                        <select
                          value={inviteRoleInput}
                          onChange={(e) =>
                            setInviteRoleInput(e.target.value as 'admin' | 'member')
                          }
                          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-indigo-600 focus:outline-hidden"
                        >
                          <option value="member">指派角色：一般成員 (member)</option>
                          <option value="admin">指派角色：管理員 (admin)</option>
                        </select>
                        <button
                          type="submit"
                          disabled={!inviteEmailInput.trim()}
                          className="rounded-lg bg-slate-900 px-4 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                        >
                          發送邀請
                        </button>
                      </div>

                      {/* Quick preset invite buttons */}
                      <div className="flex flex-wrap items-center gap-2 pt-1 text-xs text-slate-500">
                        <span>快速帶入示範預設：</span>
                        {SYNTHETIC_IDENTITY_PRESETS.filter(
                          (p) => p.email !== currentUser.emailNormalized,
                        ).map((preset) => (
                          <button
                            key={preset.email}
                            type="button"
                            onClick={() => setInviteEmailInput(preset.email)}
                            className="rounded-md border border-slate-300 bg-white px-2 py-0.5 text-[11px] text-slate-700 hover:bg-slate-50"
                          >
                            + {preset.displayName} ({preset.email})
                          </button>
                        ))}
                      </div>
                    </form>

                    {/* Pending sent invitations */}
                    {familyDetail.pendingInvitations &&
                      familyDetail.pendingInvitations.length > 0 && (
                        <div className="mt-5">
                          <h5 className="text-xs font-semibold text-slate-600">
                            已發出且待接受的邀請（
                            {familyDetail.pendingInvitations.length} 筆）
                          </h5>
                          <div className="mt-2 space-y-2">
                            {familyDetail.pendingInvitations.map((inv) => (
                              <div
                                key={inv.id}
                                className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50/50 p-2.5 text-xs"
                              >
                                <div>
                                  <span className="font-semibold text-slate-900">
                                    {inv.invitedEmail}
                                  </span>
                                  <span className="ml-2 text-slate-500">
                                    （{inv.role === 'admin' ? '管理員' : '一般成員'}，邀請於{' '}
                                    {new Date(inv.createdAt).toLocaleTimeString()}）
                                  </span>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => void handleRevokeInvite(inv.id)}
                                  className="rounded-md border border-amber-300 bg-white px-2 py-1 text-[11px] font-medium text-amber-900 hover:bg-amber-100"
                                >
                                  撤銷邀請
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                  </div>
                ) : (
                  <div className="mt-6 border-t border-slate-200 pt-4 text-xs text-slate-500">
                    ℹ️ 一般成員僅能檢視家庭成員與退出家庭，成員管理與發送邀請權限僅限管理員。
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {/* Data Ownership & Authorization Middleware Section (Issue #4) */}
        {currentUser && spaceOverview && (
          <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-150 pb-4">
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  資料擁有權與權限中介層（Issue #4）
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  統一驗證個人資源（<code>user_id</code>）與家庭資源（<code>family_members</code> 成員資格），並對跨空間來源訊息（<code>source_message_id</code>）執行雙端獨立授權與隱私存在性隔離。
                </p>
              </div>
              <span className="rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-900">
                邏輯隔離驗證（非加密認證）
              </span>
            </div>

            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50/70 p-3 text-xs text-amber-900">
              {spaceOverview.securityNotice || DATA_OWNERSHIP_SECURITY_NOTICE}
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <h3 className="text-xs font-semibold tracking-wider text-slate-500 uppercase">
                  個人空間資源歸屬 (owner_user_id = 本人)
                </h3>
                <dl className="mt-2.5 space-y-1.5 font-mono text-xs text-slate-700">
                  <div>
                    <span className="text-slate-500">Calendar ID: </span>
                    <span>{spaceOverview.personalSpace.calendarId}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">Task List ID: </span>
                    <span>{spaceOverview.personalSpace.taskListId}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">Ledger ID: </span>
                    <span>{spaceOverview.personalSpace.ledgerId}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">Personal Chat (心情) ID: </span>
                    <span>{spaceOverview.personalSpace.chatRoomId}</span>
                  </div>
                </dl>
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <h3 className="text-xs font-semibold tracking-wider text-slate-500 uppercase">
                  已授權家庭空間容器 ({spaceOverview.familySpaces.length} 個家庭)
                </h3>
                {spaceOverview.familySpaces.length === 0 ? (
                  <p className="mt-2.5 text-xs text-slate-500">
                    目前無已加入的家庭空間；非成員越權存取家庭資源將一律回傳 403/404。
                  </p>
                ) : (
                  <div className="mt-2.5 space-y-2">
                    {spaceOverview.familySpaces.map((fs) => (
                      <div
                        key={fs.familyId}
                        className="rounded-md border border-slate-200 bg-white p-2.5 text-xs"
                      >
                        <div className="flex items-center justify-between font-semibold text-slate-900">
                          <span>{fs.familyName}</span>
                          <span className="rounded-xs bg-indigo-50 px-1.5 py-0.5 text-[10px] text-indigo-800">
                            {fs.role}
                          </span>
                        </div>
                        <p className="mt-1 font-mono text-[11px] text-slate-500">
                          ChatRoom: {fs.chatRoomId}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        {/* Synthetic Identity Picker Section (Issue #2) */}
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
                    輸入自訂虛構 Email 建立／切換身份（限 .test 測試網域）
                  </h3>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <div>
                      <label htmlFor="synthetic-email" className="block text-xs font-medium text-slate-700">
                        虛構 Email（限 *.test 網域，禁止真實信箱）
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
                        虛構顯示名稱（選填，請勿填真實姓名）
                      </label>
                      <input
                        id="synthetic-name"
                        type="text"
                        placeholder="Charlie (虛構代稱)"
                        value={displayNameInput}
                        onChange={(e) => setDisplayNameInput(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-indigo-600 focus:outline-hidden"
                      />
                    </div>
                  </div>
                  <p className="text-[11px] text-amber-800">
                    注意：系統僅允許 <code>.test</code> 保留網域；格式檢查無法自動辨識真實姓名，顯示名稱欄亦請勿輸入真實個資。
                  </p>
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

        {/* Project Scaffold & Health Status (Issue #1) */}
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
