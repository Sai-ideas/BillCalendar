import { useEffect, useState, type FormEvent } from 'react';
import {
  DEFAULT_TIMEZONE,
  LocalDateStringSchema,
  formatChatDateDivider,
  isValidLocalDateString,
  sortMessagesStably,
  type CreateEventRequest,
  type CreateTaskRequest,
  type DerivedEventSummary,
  type DerivedTaskSummary,
  type EventDetail,
  type MessageWithAuthorizedDerived,
  type TaskDetail,
} from '../../shared';

export interface ChatPanelProps {
  roomId: string;
  roomKind: 'personal' | 'family';
  roomLabel: string;
  familyDisplayName?: string;
  selectedDate: string;
  highlightedMessageId?: string | null;
  currentUserId?: string | null;
  currentUserRole?: 'admin' | 'member' | null;
  messages: MessageWithAuthorizedDerived[];
  loading?: boolean;
  error?: string | null;
  hasMoreBefore?: boolean;
  hasMoreAfter?: boolean;
  loadingEarlier?: boolean;
  loadingLater?: boolean;
  targetMessageFound?: boolean | null;
  onLoadEarlier?: () => Promise<void>;
  onLoadLater?: () => Promise<void>;
  onSendMessage: (payload: { body: string; recordDate?: string | null }) => Promise<void>;
  onDeleteMessage: (messageId: string) => Promise<void>;
  /** Issue #11: Callback to create an event derived from a message */
  onCreateEventFromMessage?: (
    message: MessageWithAuthorizedDerived,
    payload: CreateEventRequest,
  ) => Promise<EventDetail | void>;
  /** Issue #11: Callback to create a task derived from a message */
  onCreateTaskFromMessage?: (
    message: MessageWithAuthorizedDerived,
    payload: CreateTaskRequest,
  ) => Promise<TaskDetail | void>;
  /** Issue #11: Callback to navigate to a derived task */
  onNavigateToDerivedTask?: (task: DerivedTaskSummary) => void;
  /** Issue #11: Callback to navigate to a derived event */
  onNavigateToDerivedEvent?: (event: DerivedEventSummary) => void;
}

const COMMON_EMOJIS = ['😊', '❤️', '🎉', '👍', '☕', '💡', '🎂', '🛒', '🌧️', '🌟', '🍜', '🚀'];

function formatTime(isoString: string): string {
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleTimeString('zh-TW', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } catch {
    return '';
  }
}

interface ConvertFormState {
  message: MessageWithAuthorizedDerived;
  type: 'event' | 'task';
  title: string;
  scope: 'personal' | 'family';
  dueDate: string;
  allDay: boolean;
  startsAt: string;
  endsAt: string;
}

export function ChatPanel({
  roomId,
  roomKind,
  familyDisplayName = '',
  selectedDate,
  highlightedMessageId = null,
  currentUserId = null,
  currentUserRole = null,
  messages,
  loading = false,
  error = null,
  hasMoreBefore = false,
  hasMoreAfter = false,
  loadingEarlier = false,
  loadingLater = false,
  targetMessageFound = null,
  onLoadEarlier,
  onLoadLater,
  onSendMessage,
  onDeleteMessage,
  onCreateEventFromMessage,
  onCreateTaskFromMessage,
  onNavigateToDerivedTask,
  onNavigateToDerivedEvent,
}: ChatPanelProps) {
  const [draftText, setDraftText] = useState('');
  const [draftRecordDate, setDraftRecordDate] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [dismissedFallbackAlert, setDismissedFallbackAlert] = useState(false);

  // Issue #11: Convert Message to Event / Task modal state
  const [convertState, setConvertState] = useState<ConvertFormState | null>(null);
  const [convertSubmitting, setConvertSubmitting] = useState(false);
  const [convertError, setConvertError] = useState<string | null>(null);

  useEffect(() => {
    setDismissedFallbackAlert(false);
  }, [roomId, selectedDate, highlightedMessageId, targetMessageFound]);

  // Non-blocking 1 & Follow-up: Reset unsent draft text, record date and form errors ONLY when room context changes (not on date clicks)
  useEffect(() => {
    setDraftText('');
    setDraftRecordDate('');
    setFormError(null);
    setConvertState(null);
  }, [roomId, roomKind, familyDisplayName]);

  // Issue #28: Smooth scroll into view when highlightedMessageId is present and message exists
  useEffect(() => {
    if (highlightedMessageId) {
      const timer = setTimeout(() => {
        const el = document.querySelector(`[data-testid="chat-message-${highlightedMessageId}"]`);
        if (el) {
          el.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
        }
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [highlightedMessageId, messages]);

  const sortedMessages = sortMessagesStably(messages);
  const hasSelectedDateMessages = sortedMessages.some((m) => m.localDate === selectedDate);
  const isSourceMissingOrDeleted =
    !dismissedFallbackAlert &&
    (targetMessageFound === false ||
      (Boolean(highlightedMessageId) &&
        !loading &&
        sortedMessages.length > 0 &&
        !sortedMessages.some((m) => m.id === highlightedMessageId)));

  const handleAddEmoji = (emoji: string) => {
    setDraftText((prev) => prev + emoji);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const body = draftText.trim();
    if (!body) {
      setFormError('請輸入訊息內容');
      return;
    }

    let recordDate: string | null = null;
    if (draftRecordDate.trim()) {
      const parsed = LocalDateStringSchema.safeParse(draftRecordDate.trim());
      if (!parsed.success) {
        setFormError('補記日期格式無效 (需為 YYYY-MM-DD)');
        return;
      }
      recordDate = parsed.data;
    }

    setSubmitting(true);
    try {
      await onSendMessage({ body, recordDate });
      setDraftText('');
      setDraftRecordDate('');
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : '發送訊息失敗');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (messageId: string) => {
    setFormError(null);
    setDeletingId(messageId);
    try {
      await onDeleteMessage(messageId);
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : '刪除訊息失敗');
    } finally {
      setDeletingId(null);
    }
  };

  // Issue #11: Open convert dialog pre-filled with message body, date, and scope
  const handleOpenConvert = (msg: MessageWithAuthorizedDerived, type: 'event' | 'task') => {
    const defaultDate = msg.recordDate || msg.localDate || selectedDate;
    setConvertError(null);
    setConvertState({
      message: msg,
      type,
      title: msg.body,
      scope: roomKind === 'family' ? 'family' : 'personal',
      dueDate: defaultDate,
      allDay: true,
      startsAt: defaultDate,
      endsAt: defaultDate,
    });
  };

  const handleCloseConvert = () => {
    setConvertState(null);
    setConvertError(null);
    setConvertSubmitting(false);
  };

  // Issue #11: Submit convert form to create derived Event or Task
  const handleConvertSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!convertState) return;
    setConvertError(null);

    const title = convertState.title.trim();
    if (!title) {
      setConvertError(convertState.type === 'event' ? '行程標題不可為空' : '待辦標題不可為空');
      return;
    }
    if (title.length > 200) {
      setConvertError('標題不可超過 200 字元');
      return;
    }

    setConvertSubmitting(true);
    try {
      if (convertState.type === 'task') {
        const dueRaw = convertState.dueDate.trim();
        let dueDate: string | null = null;
        if (dueRaw) {
          const parsed = LocalDateStringSchema.safeParse(dueRaw);
          if (!parsed.success) {
            setConvertError('截止日期格式無效 (需為 YYYY-MM-DD)');
            setConvertSubmitting(false);
            return;
          }
          dueDate = parsed.data;
        }

        const payload: CreateTaskRequest = {
          scope: convertState.scope,
          familyId:
            convertState.scope === 'family'
              ? (convertState.message.familyId ?? roomId)
              : undefined,
          title,
          dueDate,
          sourceMessageId: convertState.message.id,
        };

        if (onCreateTaskFromMessage) {
          await onCreateTaskFromMessage(convertState.message, payload);
        }
      } else {
        // Event
        if (convertState.allDay) {
          const starts = convertState.startsAt.trim();
          const ends = convertState.endsAt.trim();
          if (!isValidLocalDateString(starts)) {
            setConvertError('全天事件開始日期必須為 YYYY-MM-DD');
            setConvertSubmitting(false);
            return;
          }
          if (!isValidLocalDateString(ends)) {
            setConvertError('全天事件結束日期必須為 YYYY-MM-DD');
            setConvertSubmitting(false);
            return;
          }
          if (ends < starts) {
            setConvertError('全天事件結束日期不可早於開始日期');
            setConvertSubmitting(false);
            return;
          }

          const payload: CreateEventRequest = {
            scope: convertState.scope,
            familyId:
              convertState.scope === 'family'
                ? (convertState.message.familyId ?? roomId)
                : undefined,
            title,
            allDay: true,
            startsAt: starts,
            endsAt: ends,
            timezone: DEFAULT_TIMEZONE,
            sourceMessageId: convertState.message.id,
          };

          if (onCreateEventFromMessage) {
            await onCreateEventFromMessage(convertState.message, payload);
          }
        } else {
          // Non-all-day event
          const starts = convertState.startsAt.trim();
          const ends = convertState.endsAt.trim();
          if (!starts || !ends) {
            setConvertError('請輸入開始與結束時間');
            setConvertSubmitting(false);
            return;
          }

          const payload: CreateEventRequest = {
            scope: convertState.scope,
            familyId:
              convertState.scope === 'family'
                ? (convertState.message.familyId ?? roomId)
                : undefined,
            title,
            allDay: false,
            startsAt: starts,
            endsAt: ends,
            timezone: DEFAULT_TIMEZONE,
            sourceMessageId: convertState.message.id,
          };

          if (onCreateEventFromMessage) {
            await onCreateEventFromMessage(convertState.message, payload);
          }
        }
      }

      handleCloseConvert();
    } catch (err: unknown) {
      setConvertError(err instanceof Error ? err.message : '建立衍生項目失敗');
    } finally {
      setConvertSubmitting(false);
    }
  };

  let lastLocalDate: string | null = null;

  return (
    <div className="flex flex-col h-full space-y-3 text-xs">
      {/* Context banner */}
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-slate-700 space-y-1.5 shrink-0">
        <p className="font-semibold text-slate-900">
          {roomKind === 'personal'
            ? `💬 個人心情聊天室（定位日期：${selectedDate}）`
            : `🏠 家庭聊天室（定位日期：${selectedDate}）`}
        </p>
        {highlightedMessageId && (
          <div
            data-testid="chat-panel-source-message-locator"
            data-source-message-id={highlightedMessageId}
            className="rounded-md border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-[11px] font-medium text-indigo-900"
          >
            📍 已定位至來源訊息：<code>{highlightedMessageId}</code>（{selectedDate}）
          </div>
        )}
        {roomKind === 'personal' ? (
          <p className="text-slate-600">
            「心情」即個人專屬聊天室（<code>kind = 'personal'</code>
            ），支援文字、emoji、快速筆記與外部 HTTPS 圖片連結，並支援時間軸按日期定位與前後連續捲動分頁。
          </p>
        ) : (
          <p className="text-slate-600">
            目前顯示「{familyDisplayName}」的唯一家庭聊天室，定位於{' '}
            <code>{selectedDate}</code> 並保留前後訊息上下文。
          </p>
        )}
      </div>

      {/* Global Error Banner */}
      {error && (
        <div
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 p-2.5 text-xs text-red-700"
        >
          {error}
        </div>
      )}

      {/* Issue #28: Graceful degradation alert for deleted or missing source messages */}
      {isSourceMissingOrDeleted && (
        <div
          role="alert"
          data-testid="chat-source-missing-alert"
          className="rounded-md border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900 flex items-start gap-2"
        >
          <span className="text-sm">⚠️</span>
          <div>
            <p className="font-medium">來源訊息已遭移除、不存在或無存取權限</p>
            <p className="text-[11px] text-amber-800 mt-0.5">
              已為您安全切換至接近日期（<code>{selectedDate}</code>）的時間軸瀏覽。
            </p>
          </div>
          <button
            type="button"
            data-testid="chat-source-missing-dismiss-btn"
            onClick={() => setDismissedFallbackAlert(true)}
            className="ml-auto text-xs text-amber-800 hover:text-amber-950 underline shrink-0 cursor-pointer"
          >
            關閉
          </button>
        </div>
      )}

      {/* Message List */}
      <div
        data-testid="chat-messages-container"
        className="flex-1 overflow-y-auto min-h-[220px] max-h-[380px] space-y-2.5 rounded-lg border border-slate-200 bg-white p-3 shadow-inner"
      >
        {/* Load Earlier (Before) Button */}
        {hasMoreBefore && onLoadEarlier && (
          <div className="text-center py-1">
            <button
              type="button"
              data-testid="chat-load-earlier-button"
              disabled={loadingEarlier || loading}
              onClick={() => void onLoadEarlier()}
              className="rounded border border-slate-300 bg-white px-3 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors shadow-2xs"
            >
              {loadingEarlier ? '載入更早訊息中...' : '↑ 載入更早訊息'}
            </button>
          </div>
        )}

        {loading && sortedMessages.length === 0 && (
          <p data-testid="chat-loading" className="text-center py-8 text-slate-400">
            載入訊息中...
          </p>
        )}

        {!loading && sortedMessages.length === 0 && (
          <div data-testid="chat-empty-state" className="text-center py-8 text-slate-400">
            目前尚無訊息。在下方輸入文字或 emoji 開始記錄！
          </div>
        )}

        {/* Issue #10: Friendly empty state banner if selected date has no messages but timeline has messages */}
        {!loading && sortedMessages.length > 0 && !hasSelectedDateMessages && (
          <div
            data-testid="chat-selected-date-empty-notice"
            className="rounded-md border border-amber-200 bg-amber-50/90 p-2.5 text-center text-xs text-amber-800 my-1"
          >
            📅 {selectedDate} 尚無
            {roomKind === 'personal'
              ? '心情筆記，在今日記下一筆吧'
              : '家庭聊天訊息，在此留下紀錄吧'}
          </div>
        )}

        {sortedMessages.map((msg) => {
          const isMe = currentUserId ? msg.senderUserId === currentUserId : false;
          const isHighlighted = highlightedMessageId === msg.id;
          const canDelete =
            roomKind === 'personal' || isMe || currentUserRole === 'admin';
          const isDeleting = deletingId === msg.id;

          const senderName = isMe
            ? '我'
            : msg.senderDisplayName || msg.senderUserId;

          // Issue #10: Date divider between different local dates
          const showDateDivider = msg.localDate !== lastLocalDate;
          if (showDateDivider) {
            lastLocalDate = msg.localDate;
          }

          return (
            <div key={msg.id} className="space-y-2">
              {showDateDivider && (
                <div
                  data-testid="chat-date-divider"
                  data-date={msg.localDate}
                  className="flex items-center my-3"
                >
                  <div className="flex-grow border-t border-slate-200" />
                  <span className="mx-2 rounded-full bg-slate-100 border border-slate-200 px-2.5 py-0.5 text-[10px] font-medium text-slate-500">
                    {formatChatDateDivider(msg.localDate)}
                  </span>
                  <div className="flex-grow border-t border-slate-200" />
                </div>
              )}

              <div
                data-testid={`chat-message-${msg.id}`}
                data-highlighted={isHighlighted ? 'true' : 'false'}
                className={`rounded-lg border p-2.5 transition-all ${
                  isHighlighted
                    ? 'border-indigo-400 bg-indigo-50/80 ring-2 ring-indigo-400 shadow-sm'
                    : isMe
                      ? 'border-indigo-100 bg-indigo-50/30'
                      : 'border-slate-200 bg-slate-50/60'
                }`}
              >
                {/* Header: Sender & Actions */}
                <div className="flex items-center justify-between gap-2 border-b border-slate-150 pb-1 text-[11px]">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`font-semibold ${
                        isMe ? 'text-indigo-700' : 'text-slate-800'
                      }`}
                    >
                      {senderName}
                    </span>
                    {currentUserRole === 'admin' && !isMe && roomKind === 'family' && (
                      <span className="rounded bg-amber-100 px-1 py-0.2 text-[9px] font-medium text-amber-800">
                        群組管理員視角
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[10px] text-slate-400">
                      {msg.localDate} {formatTime(msg.createdAt)}
                    </span>
                    {canDelete && (
                      <button
                        type="button"
                        data-testid={`delete-message-${msg.id}`}
                        disabled={isDeleting}
                        onClick={() => void handleDelete(msg.id)}
                        className="text-[11px] font-medium text-rose-600 hover:text-rose-800 hover:underline disabled:opacity-50"
                        title={
                          currentUserRole === 'admin' && !isMe
                            ? '以管理員權限刪除此群組訊息'
                            : '刪除此訊息'
                        }
                      >
                        {isDeleting ? '刪除中...' : '刪除'}
                      </button>
                    )}
                  </div>
                </div>

                {/* Body: Preserves emojis and linebreaks */}
                <div className="mt-1.5 text-xs text-slate-800 whitespace-pre-wrap break-words">
                  {msg.body}
                </div>

                {/* Issue #11: Actions toolbar - Convert to Event / Task */}
                <div className="mt-2 flex flex-wrap items-center gap-1.5 pt-1.5 border-t border-slate-150/60">
                  <span className="text-[10px] text-slate-400 font-medium">轉為紀錄：</span>
                  <button
                    type="button"
                    data-testid={`chat-convert-event-button-${msg.id}`}
                    onClick={() => handleOpenConvert(msg, 'event')}
                    className="rounded border border-indigo-200 bg-indigo-50/70 hover:bg-indigo-100 px-2 py-0.5 text-[10px] font-semibold text-indigo-700 transition-colors cursor-pointer"
                    title="將此訊息轉為日曆行程 (原訊息不修改)"
                  >
                    + 行程
                  </button>
                  <button
                    type="button"
                    data-testid={`chat-convert-task-button-${msg.id}`}
                    onClick={() => handleOpenConvert(msg, 'task')}
                    className="rounded border border-emerald-200 bg-emerald-50/70 hover:bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 transition-colors cursor-pointer"
                    title="將此訊息轉為待辦事項 (原訊息不修改)"
                  >
                    + 待辦
                  </button>
                </div>

                {/* Badges: recordDate and clickable derived tasks/events */}
                <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px]">
                  {msg.recordDate && (
                    <span
                      data-testid={`chat-record-date-badge-${msg.id}`}
                      className="inline-flex items-center gap-1 rounded bg-amber-50 border border-amber-200 px-1.5 py-0.5 font-medium text-amber-800"
                    >
                      📅 補記日：{msg.recordDate}
                    </span>
                  )}
                  {msg.derivedTasks?.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      data-testid={`chat-derived-task-${t.id}`}
                      onClick={() => onNavigateToDerivedTask?.(t)}
                      className="inline-flex items-center gap-1 rounded bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 text-emerald-800 font-medium hover:bg-emerald-100 hover:border-emerald-300 transition-colors cursor-pointer"
                      title={`點擊查看衍生待辦：${t.title}`}
                    >
                      ✓ 待辦：{t.title}
                    </button>
                  ))}
                  {msg.derivedEvents?.map((ev) => (
                    <button
                      key={ev.id}
                      type="button"
                      data-testid={`chat-derived-event-${ev.id}`}
                      onClick={() => onNavigateToDerivedEvent?.(ev)}
                      className="inline-flex items-center gap-1 rounded bg-blue-50 border border-blue-200 px-1.5 py-0.5 text-blue-800 font-medium hover:bg-blue-100 hover:border-blue-300 transition-colors cursor-pointer"
                      title={`點擊查看衍生行程：${ev.title}`}
                    >
                      📅 行程：{ev.title}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          );
        })}

        {/* Load Later (After) Button */}
        {hasMoreAfter && onLoadLater && (
          <div className="text-center py-1">
            <button
              type="button"
              data-testid="chat-load-later-button"
              disabled={loadingLater || loading}
              onClick={() => void onLoadLater()}
              className="rounded border border-slate-300 bg-white px-3 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors shadow-2xs"
            >
              {loadingLater ? '載入更新訊息中...' : '↓ 載入更新訊息'}
            </button>
          </div>
        )}
      </div>

      {/* Message Input & Send Form */}
      <form
        data-testid="chat-send-form"
        onSubmit={(e) => void handleSubmit(e)}
        className="rounded-lg border border-slate-200 bg-slate-50/50 p-2.5 space-y-2 shrink-0"
      >
        {/* Quick Emoji Bar */}
        <div className="flex flex-wrap items-center gap-1 pb-1">
          <span className="text-[11px] font-medium text-slate-500 mr-1">常用表情:</span>
          {COMMON_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              data-testid={`emoji-btn-${emoji}`}
              onClick={() => handleAddEmoji(emoji)}
              className="rounded p-1 text-sm hover:bg-slate-200 transition-colors cursor-pointer"
              title={`加入 ${emoji}`}
            >
              {emoji}
            </button>
          ))}
        </div>

        {/* Text Input */}
        <div>
          <textarea
            data-testid="chat-message-input"
            rows={2}
            value={draftText}
            onChange={(e) => setDraftText(e.target.value)}
            placeholder={
              roomKind === 'personal'
                ? '記錄今日心情、隨手筆記 (支援 emoji)...'
                : '發送家庭聊天訊息 (支援 emoji)...'
            }
            className="w-full rounded-md border border-slate-300 bg-white p-2 text-xs text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-none"
          />
        </div>

        {/* Optional Record Date + Submit */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-200">
          <div className="flex items-center gap-1.5">
            <label
              htmlFor="chat-record-date"
              className="text-[11px] text-slate-600 font-medium whitespace-nowrap"
            >
              補記生活日期（選填）:
            </label>
            <input
              id="chat-record-date"
              type="date"
              data-testid="chat-record-date-input"
              value={draftRecordDate}
              onChange={(e) => setDraftRecordDate(e.target.value)}
              className="rounded border border-slate-300 bg-white px-2 py-0.5 text-xs text-slate-700 focus:border-indigo-500 focus:outline-none"
            />
            <span className="text-[10px] text-slate-400 hidden sm:inline">
              (不覆寫發送日)
            </span>
          </div>

          <button
            type="submit"
            data-testid="chat-send-button"
            disabled={submitting || !draftText.trim()}
            className="rounded-md bg-indigo-600 px-3.5 py-1 text-xs font-semibold text-white shadow-xs hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            {submitting ? '發送中...' : '送出'}
          </button>
        </div>

        {/* Error message */}
        {formError && (
          <div data-testid="chat-form-error" className="text-rose-600 text-[11px] font-medium">
            {formError}
          </div>
        )}
      </form>

      {/* Issue #11: Modal Dialog for converting message to Event / Task */}
      {convertState && (
        <div
          role="dialog"
          aria-modal="true"
          data-testid="chat-convert-modal"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4"
        >
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-2">
              <h3
                data-testid="convert-modal-title"
                className="text-sm font-bold text-slate-900"
              >
                {convertState.type === 'event' ? '📅 訊息轉為行程' : '✓ 訊息轉為待辦'}
              </h3>
              <button
                type="button"
                data-testid="convert-modal-close-btn"
                onClick={handleCloseConvert}
                className="text-slate-400 hover:text-slate-600 text-base font-semibold leading-none cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Immutability & provenance notice */}
            <div className="rounded-md border border-indigo-100 bg-indigo-50/60 p-2.5 text-[11px] text-indigo-900 space-y-1">
              <p className="font-medium">
                💬 來源訊息：
                <span className="font-normal text-indigo-800 line-clamp-2">
                  「{convertState.message.body}」
                </span>
              </p>
              <p className="text-[10px] text-indigo-700">
                ℹ️ 建立後原訊息本文完整保留不變；同一則訊息允許重複衍生多筆行程或待辦。
              </p>
            </div>

            <form
              data-testid="convert-modal-form"
              onSubmit={(e) => void handleConvertSubmit(e)}
              className="space-y-3 text-xs"
            >
              {/* Title Input */}
              <div className="space-y-1">
                <label
                  htmlFor="convert-title-input"
                  className="block font-semibold text-slate-700"
                >
                  {convertState.type === 'event' ? '行程標題' : '待辦標題'}{' '}
                  <span className="text-rose-500">*</span>
                </label>
                <input
                  id="convert-title-input"
                  data-testid="convert-title-input"
                  type="text"
                  maxLength={200}
                  value={convertState.title}
                  onChange={(e) =>
                    setConvertState((prev) => (prev ? { ...prev, title: e.target.value } : null))
                  }
                  placeholder="請輸入標題..."
                  className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              {/* Target Space Selection */}
              <div className="space-y-1">
                <label
                  htmlFor="convert-scope-select"
                  className="block font-semibold text-slate-700"
                >
                  建立空間範圍
                </label>
                {roomKind === 'family' ? (
                  <select
                    id="convert-scope-select"
                    data-testid="convert-scope-select"
                    value={convertState.scope}
                    onChange={(e) =>
                      setConvertState((prev) =>
                        prev
                          ? { ...prev, scope: e.target.value as 'personal' | 'family' }
                          : null,
                      )
                    }
                    className="w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-800 focus:border-indigo-500 focus:outline-none"
                  >
                    <option value="family">
                      🏠 家庭空間（{familyDisplayName || '此家庭'}）
                    </option>
                    <option value="personal">🔒 個人私人空間（僅自己可見）</option>
                  </select>
                ) : (
                  <div className="rounded border border-slate-200 bg-slate-50 px-3 py-1.5 text-slate-600">
                    🔒 個人私人空間（personal）
                  </div>
                )}
              </div>

              {/* Task Fields */}
              {convertState.type === 'task' && (
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label
                      htmlFor="convert-due-date-input"
                      className="block font-semibold text-slate-700"
                    >
                      截止日期（選填）
                    </label>
                    {convertState.dueDate && (
                      <button
                        type="button"
                        data-testid="convert-clear-due-date-btn"
                        onClick={() =>
                          setConvertState((prev) => (prev ? { ...prev, dueDate: '' } : null))
                        }
                        className="text-[10px] text-slate-500 hover:text-slate-800 underline cursor-pointer"
                      >
                        清除日期
                      </button>
                    )}
                  </div>
                  <input
                    id="convert-due-date-input"
                    data-testid="convert-due-date-input"
                    type="date"
                    value={convertState.dueDate}
                    onChange={(e) =>
                      setConvertState((prev) => (prev ? { ...prev, dueDate: e.target.value } : null))
                    }
                    className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-800 focus:border-indigo-500 focus:outline-none"
                  />
                </div>
              )}

              {/* Event Fields */}
              {convertState.type === 'event' && (
                <div className="space-y-2.5">
                  <div className="flex items-center gap-2">
                    <input
                      id="convert-allday-input"
                      data-testid="convert-allday-input"
                      type="checkbox"
                      checked={convertState.allDay}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        const defaultDate =
                          convertState.message.recordDate ||
                          convertState.message.localDate ||
                          selectedDate;
                        setConvertState((prev) =>
                          prev
                            ? {
                                ...prev,
                                allDay: checked,
                                startsAt: checked ? defaultDate : `${defaultDate}T09:00`,
                                endsAt: checked ? defaultDate : `${defaultDate}T10:00`,
                              }
                            : null,
                        );
                      }}
                      className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <label
                      htmlFor="convert-allday-input"
                      className="text-xs font-semibold text-slate-700 cursor-pointer"
                    >
                      全天行程（不經時區換日）
                    </label>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label
                        htmlFor="convert-starts-at-input"
                        className="block text-[11px] font-semibold text-slate-700"
                      >
                        開始時間 / 日期 <span className="text-rose-500">*</span>
                      </label>
                      <input
                        id="convert-starts-at-input"
                        data-testid="convert-starts-at-input"
                        type={convertState.allDay ? 'date' : 'datetime-local'}
                        value={convertState.startsAt}
                        onChange={(e) =>
                          setConvertState((prev) =>
                            prev ? { ...prev, startsAt: e.target.value } : null,
                          )
                        }
                        className="w-full rounded-md border border-slate-300 px-2.5 py-1 text-xs text-slate-800 focus:border-indigo-500 focus:outline-none"
                      />
                    </div>
                    <div className="space-y-1">
                      <label
                        htmlFor="convert-ends-at-input"
                        className="block text-[11px] font-semibold text-slate-700"
                      >
                        結束時間 / 日期 <span className="text-rose-500">*</span>
                      </label>
                      <input
                        id="convert-ends-at-input"
                        data-testid="convert-ends-at-input"
                        type={convertState.allDay ? 'date' : 'datetime-local'}
                        value={convertState.endsAt}
                        onChange={(e) =>
                          setConvertState((prev) =>
                            prev ? { ...prev, endsAt: e.target.value } : null,
                          )
                        }
                        className="w-full rounded-md border border-slate-300 px-2.5 py-1 text-xs text-slate-800 focus:border-indigo-500 focus:outline-none"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Error Alert */}
              {convertError && (
                <div
                  role="alert"
                  data-testid="convert-error"
                  className="rounded-md border border-rose-200 bg-rose-50 p-2 text-[11px] font-medium text-rose-700"
                >
                  {convertError}
                </div>
              )}

              {/* Footer Buttons */}
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  data-testid="convert-cancel-button"
                  disabled={convertSubmitting}
                  onClick={handleCloseConvert}
                  className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors"
                >
                  取消
                </button>
                <button
                  type="submit"
                  data-testid="convert-submit-button"
                  disabled={convertSubmitting || !convertState.title.trim()}
                  className="rounded-md bg-indigo-600 px-4 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                >
                  {convertSubmitting ? '建立中...' : '確認建立'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
