import { useEffect, useState } from 'react';
import {
  DEFAULT_TIMEZONE,
  HealthResponseSchema,
  type HealthResponse,
} from '../shared';

export function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    let active = true;
    const baseUrl = import.meta.env.VITE_API_BASE_URL ?? '';

    fetch(`${baseUrl}/api/health`)
      .then(async (res) => {
        const json: unknown = await res.json();
        const parsed = HealthResponseSchema.safeParse(json);
        if (!parsed.success) {
          throw new Error('Invalid health API response format');
        }
        if (active) {
          setHealth(parsed.data);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (active) {
          setError(err instanceof Error ? err.message : '無法連線至後端 Health API');
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white px-6 py-4 shadow-xs">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900">
              BillCalendar — 生活行事曆 Demo
            </h1>
            <p className="text-xs text-amber-700">
              受控示範環境：後續僅使用合成 Email 模擬身份，請勿輸入真實個資或財務資料。
            </p>
          </div>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
            預設時區：{health?.timezone ?? DEFAULT_TIMEZONE}
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs">
          <h2 className="text-base font-semibold text-slate-900">
            專案骨架與系統狀態（Issue #1）
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            React + TypeScript + Vite 前端、Cloudflare Workers + Hono API 與 D1 / Drizzle 基礎架構。
          </p>

          <div className="mt-4 rounded-lg border border-slate-100 bg-slate-50 p-4 text-sm">
            {loading && <p className="text-slate-600">正在檢查 `/api/health` 狀態...</p>}
            {!loading && error && (
              <p className="font-medium text-red-600" role="alert">
                API 連線失敗：{error}
              </p>
            )}
            {!loading && health && (
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
