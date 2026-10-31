import { useState, type FormEvent } from 'react';
import {
  LocalDateStringSchema,
  sortMessagesStably,
  type MessageWithAuthorizedDerived,
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
  onSendMessage: (payload: { body: string; recordDate?: string | null }) => Promise<void>;
  onDeleteMessage: (messageId: string) => Promise<void>;
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

export function ChatPanel({
  roomKind,
  familyDisplayName = '',
  selectedDate,
  highlightedMessageId = null,
  currentUserId = null,
  currentUserRole = null,
  messages,
  loading = false,
  error = null,
  onSendMessage,
  onDeleteMessage,
}: ChatPanelProps) {
  const [draftText, setDraftText] = useState('');
  const [draftRecordDate, setDraftRecordDate] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const sortedMessages = sortMessagesStably(messages);

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
            ），支援文字、emoji、快速筆記與外部 HTTPS 圖片連結，並將在
            Issue #9 / #10 接入時間軸定位與上下文捲動。
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

      {/* Message List */}
      <div
        data-testid="chat-messages-container"
        className="flex-1 overflow-y-auto min-h-[220px] max-h-[380px] space-y-2.5 rounded-lg border border-slate-200 bg-white p-3 shadow-inner"
      >
        {loading && messages.length === 0 && (
          <p data-testid="chat-loading" className="text-center py-8 text-slate-400">
            載入訊息中...
          </p>
        )}

        {!loading && messages.length === 0 && (
          <div data-testid="chat-empty-state" className="text-center py-8 text-slate-400">
            目前尚無訊息。在下方輸入文字或 emoji 開始記錄！
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

          return (
            <div
              key={msg.id}
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

              {/* Badges: recordDate and derived tasks/events */}
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
                  <span
                    key={t.id}
                    className="inline-flex items-center gap-1 rounded bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 text-emerald-800 font-medium"
                  >
                    ✓ 待辦：{t.title}
                  </span>
                ))}
                {msg.derivedEvents?.map((ev) => (
                  <span
                    key={ev.id}
                    className="inline-flex items-center gap-1 rounded bg-blue-50 border border-blue-200 px-1.5 py-0.5 text-blue-800 font-medium"
                  >
                    📅 行程：{ev.title}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
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
    </div>
  );
}
