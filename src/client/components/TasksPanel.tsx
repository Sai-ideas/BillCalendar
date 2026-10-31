import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { LocalDateStringSchema, type TaskDetail } from '../../shared';

export interface TaskMutationInput {
  title?: string;
  dueDate?: string | null;
  completed?: boolean;
}

export interface TasksPanelProps {
  /** Tasks already isolated to the active `selectedSpace` and current user. */
  tasks: TaskDetail[];
  selectedDate: string;
  spaceLabel: string;
  loading?: boolean;
  error?: string | null;
  onCreate: (input: { title: string; dueDate: string | null }) => Promise<void>;
  onUpdate: (taskId: string, input: TaskMutationInput) => Promise<void>;
  onDelete: (taskId: string) => Promise<void>;
  onJumpToSource: (task: TaskDetail) => void;
}

type FormMode = 'create' | 'edit' | null;

function validateTaskForm(
  titleRaw: string,
  dueDateRaw: string,
): { ok: true; title: string; dueDate: string | null } | { ok: false; message: string } {
  const title = titleRaw.trim();
  if (!title) return { ok: false, message: '待辦標題不可為空' };
  if (title.length > 200) return { ok: false, message: '待辦標題不可超過 200 字元' };
  const dueRaw = dueDateRaw.trim();
  if (!dueRaw) return { ok: true, title, dueDate: null };
  const parsed = LocalDateStringSchema.safeParse(dueRaw);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? '截止日期格式無效' };
  }
  return { ok: true, title, dueDate: parsed.data };
}

function SourceStatusBlock({
  task,
  onJump,
}: {
  task: TaskDetail;
  onJump: (task: TaskDetail) => void;
}) {
  if (task.sourceStatus === 'none') return null;
  return (
    <div
      data-testid={`task-source-${task.id}`}
      data-source-status={task.sourceStatus}
      className="mt-1.5 rounded-md border border-slate-200 bg-slate-50 p-2 text-[11px]"
    >
      {task.sourceStatus === 'accessible' && task.sourceMessage && (
        <div className="space-y-1">
          <p className="text-slate-800">
            💬 來源訊息：「{task.sourceMessage.body}」
            <span className="ml-1 font-mono text-[10px] text-slate-500">
              ({task.sourceMessage.localDate})
            </span>
          </p>
          <button
            type="button"
            data-testid={`task-jump-source-${task.id}`}
            onClick={() => onJump(task)}
            className="rounded-md bg-indigo-600 px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-indigo-700"
          >
            查看來源聊天 ➔
          </button>
        </div>
      )}
      {task.sourceStatus === 'deleted' && (
        <p className="font-medium text-amber-800">⚠️ 原訊息已移除（待辦仍保留）</p>
      )}
      {task.sourceStatus === 'inaccessible' && (
        <p className="font-medium text-rose-700">
          🔒 無權限存取來源訊息（您可能非該聊天空間成員或已退出）
        </p>
      )}
    </div>
  );
}

export function TasksPanel({
  tasks,
  selectedDate,
  spaceLabel,
  loading = false,
  error = null,
  onCreate,
  onUpdate,
  onDelete,
  onJumpToSource,
}: TasksPanelProps) {
  const [formMode, setFormMode] = useState<FormMode>(null);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set());
  const [rowError, setRowError] = useState<string | null>(null);

  // Close the edit form if its task vanished (space/identity switch, remote delete).
  useEffect(() => {
    if (formMode === 'edit' && editingTaskId && !tasks.some((t) => t.id === editingTaskId)) {
      setFormMode(null);
      setEditingTaskId(null);
      setFormError(null);
    }
  }, [formMode, editingTaskId, tasks]);

  const groups = useMemo(() => {
    const sortTasks = (list: TaskDetail[]) =>
      [...list].sort((a, b) => {
        const aDone = a.completedAt ? 1 : 0;
        const bDone = b.completedAt ? 1 : 0;
        if (aDone !== bDone) return aDone - bDone;
        const due = (a.dueDate ?? '9999-99-99').localeCompare(b.dueDate ?? '9999-99-99');
        if (due !== 0) return due;
        return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
      });
    return {
      today: sortTasks(tasks.filter((t) => t.dueDate === selectedDate)),
      undated: sortTasks(tasks.filter((t) => t.dueDate === null)),
      other: sortTasks(tasks.filter((t) => t.dueDate !== null && t.dueDate !== selectedDate)),
    };
  }, [tasks, selectedDate]);

  const openCreate = () => {
    setFormMode('create');
    setEditingTaskId(null);
    setTitle('');
    setDueDate('');
    setFormError(null);
  };

  const openEdit = (task: TaskDetail) => {
    setFormMode('edit');
    setEditingTaskId(task.id);
    setTitle(task.title);
    setDueDate(task.dueDate ?? '');
    setFormError(null);
  };

  const closeForm = () => {
    setFormMode(null);
    setEditingTaskId(null);
    setFormError(null);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const result = validateTaskForm(title, dueDate);
    if (!result.ok) {
      setFormError(result.message);
      return;
    }
    setSubmitting(true);
    try {
      if (formMode === 'create') {
        await onCreate({ title: result.title, dueDate: result.dueDate });
      } else if (formMode === 'edit' && editingTaskId) {
        await onUpdate(editingTaskId, { title: result.title, dueDate: result.dueDate });
      }
      closeForm();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : '儲存待辦失敗');
    } finally {
      setSubmitting(false);
    }
  };

  const runRowAction = async (taskId: string, action: () => Promise<void>) => {
    setRowError(null);
    setPendingIds((prev) => new Set(prev).add(taskId));
    try {
      await action();
    } catch (err: unknown) {
      setRowError(err instanceof Error ? err.message : '待辦操作失敗');
    } finally {
      setPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(taskId);
        return next;
      });
    }
  };

  const renderTask = (task: TaskDetail) => {
    const done = Boolean(task.completedAt);
    const pending = pendingIds.has(task.id);
    return (
      <li
        key={task.id}
        data-testid={`task-item-${task.id}`}
        data-completed={done ? 'true' : 'false'}
        data-due-date={task.dueDate ?? ''}
        className="rounded-lg border border-slate-200 bg-white p-2.5"
      >
        <div className="flex items-start gap-2">
          <input
            type="checkbox"
            data-testid={`task-toggle-${task.id}`}
            aria-label={`${done ? '取消完成' : '完成'}待辦：${task.title}`}
            checked={done}
            disabled={pending}
            onChange={() =>
              void runRowAction(task.id, () => onUpdate(task.id, { completed: !done }))
            }
            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600"
          />
          <div className="min-w-0 flex-1">
            <p
              data-testid={`task-title-${task.id}`}
              className={`font-semibold ${done ? 'text-slate-400 line-through' : 'text-slate-900'}`}
            >
              {task.title}
            </p>
            <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
              <span data-testid={`task-due-${task.id}`} className="font-mono">
                {task.dueDate ? `截止 ${task.dueDate}` : '無截止日'}
              </span>
              {done && (
                <span
                  data-testid={`task-completed-at-${task.id}`}
                  className="rounded-xs bg-emerald-100 px-1.5 py-0.5 font-semibold text-emerald-800"
                >
                  已完成
                </span>
              )}
              {task.scope === 'family' && (
                <span className="rounded-xs bg-teal-100 px-1.5 py-0.5 font-semibold text-teal-800">
                  家庭
                </span>
              )}
            </p>
            <SourceStatusBlock task={task} onJump={onJumpToSource} />
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              data-testid={`task-edit-${task.id}`}
              disabled={pending}
              onClick={() => openEdit(task)}
              className="rounded-md border border-indigo-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-50"
            >
              編輯
            </button>
            <button
              type="button"
              data-testid={`task-delete-${task.id}`}
              disabled={pending}
              onClick={() => void runRowAction(task.id, () => onDelete(task.id))}
              className="rounded-md border border-rose-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-rose-600 hover:bg-rose-50"
            >
              刪除
            </button>
          </div>
        </div>
      </li>
    );
  };

  const renderGroup = (testId: string, heading: string, list: TaskDetail[], emptyText: string) => (
    <section data-testid={testId} className="space-y-1.5">
      <h5 className="text-[11px] font-bold text-slate-700">
        {heading}（{list.length} 筆）
      </h5>
      {list.length === 0 ? (
        <p className="text-[11px] text-slate-500">{emptyText}</p>
      ) : (
        <ul className="space-y-1.5">{list.map(renderTask)}</ul>
      )}
    </section>
  );

  return (
    <div
      data-testid="tasks-panel"
      className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs text-slate-700 space-y-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold text-slate-900">
          ✅ 待辦事項（選取日：{selectedDate} ｜ {spaceLabel}）
        </p>
        <button
          type="button"
          data-testid="task-open-create-btn"
          onClick={openCreate}
          className="rounded-md bg-indigo-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-indigo-700"
        >
          + 新增待辦
        </button>
      </div>

      {loading && <p className="text-[11px] text-slate-400">載入中...</p>}
      {error && (
        <div
          role="alert"
          data-testid="tasks-api-error"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 font-medium text-red-700"
        >
          {error}
        </div>
      )}
      {rowError && (
        <div
          role="alert"
          data-testid="task-row-error"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 font-medium text-red-700"
        >
          {rowError}
        </div>
      )}

      {formMode !== null && (
        <form
          data-testid="task-crud-form"
          onSubmit={(e) => void handleSubmit(e)}
          className="space-y-2.5 rounded-xl border border-indigo-200 bg-white p-3"
        >
          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
            <h4 className="font-bold text-slate-900">
              {formMode === 'create' ? `➕ 新增待辦（${spaceLabel}）` : `✏️ 編輯待辦（${spaceLabel}）`}
            </h4>
            <button
              type="button"
              data-testid="task-form-cancel-btn"
              onClick={closeForm}
              className="text-slate-500 hover:text-slate-800"
            >
              取消
            </button>
          </div>
          {formError && (
            <div
              role="alert"
              data-testid="task-form-error"
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 font-medium text-red-700"
            >
              {formError}
            </div>
          )}
          <div>
            <label htmlFor="task-form-title" className="block font-semibold text-slate-700">
              待辦標題 *
            </label>
            <input
              id="task-form-title"
              type="text"
              data-testid="task-form-title-input"
              placeholder="例如：繳電話費、買牛奶..."
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-indigo-600 focus:outline-hidden"
            />
          </div>
          <div>
            <label htmlFor="task-form-due-date" className="block font-semibold text-slate-700">
              截止日期（選填，YYYY-MM-DD；留空＝無截止日）
            </label>
            <div className="mt-1 flex items-center gap-2">
              <input
                id="task-form-due-date"
                type="text"
                data-testid="task-form-due-date-input"
                placeholder="2026-10-30"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900 focus:border-indigo-600 focus:outline-hidden"
              />
              <button
                type="button"
                data-testid="task-form-use-selected-date-btn"
                onClick={() => setDueDate(selectedDate)}
                className="shrink-0 rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
              >
                用選取日
              </button>
              <button
                type="button"
                data-testid="task-form-clear-date-btn"
                onClick={() => setDueDate('')}
                className="shrink-0 rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
              >
                清除
              </button>
            </div>
          </div>
          <div className="flex items-center justify-end gap-2">
            <button
              type="submit"
              data-testid="task-form-submit-btn"
              disabled={submitting}
              className="rounded-lg bg-indigo-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {formMode === 'create' ? '儲存新待辦' : '儲存變更'}
            </button>
          </div>
        </form>
      )}

      {renderGroup(
        'tasks-group-selected-date',
        `${selectedDate} 到期`,
        groups.today,
        '選取日沒有到期的待辦。',
      )}
      {renderGroup('tasks-group-undated', '無截止日', groups.undated, '沒有無截止日的待辦。')}
      {renderGroup('tasks-group-other', '其他截止日', groups.other, '沒有其他截止日的待辦。')}
    </div>
  );
}
