import { z } from 'zod';
import { DEFAULT_TIMEZONE } from './health';
import {
  SUPPORTED_SOLAR_YEAR_MAX,
  SUPPORTED_SOLAR_YEAR_MIN,
  getLunarDateInfo,
  type LunarDateInfo,
} from './lunar';

export const MIN_CALENDAR_YEAR = SUPPORTED_SOLAR_YEAR_MIN;
export const MAX_CALENDAR_YEAR = SUPPORTED_SOLAR_YEAR_MAX;
export const MAX_VISIBLE_EVENTS_PER_CELL = 2 as const;

export const RightPanelTabSchema = z.enum([
  'summary',
  'mood',
  'chat',
  'ledger',
  'tasks',
  'diary',
]);
export type RightPanelTab = z.infer<typeof RightPanelTabSchema>;

export const MobileViewModeSchema = z.enum(['calendar', 'panel']);
export type MobileViewMode = z.infer<typeof MobileViewModeSchema>;

export const SelectedSpaceSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('personal'),
  }),
  z.object({
    kind: z.literal('family'),
    familyId: z.string().min(1),
  }),
]);
export type SelectedSpace = z.infer<typeof SelectedSpaceSchema>;

export interface RightPanelTabDefinition {
  id: RightPanelTab;
  label: string;
  shortDescription: string;
  personalOnly?: boolean;
}

export const RIGHT_PANEL_TABS: readonly RightPanelTabDefinition[] = [
  {
    id: 'summary',
    label: '摘要',
    shortDescription: '當日行程、待辦、收支與已授權紀錄總覽及各模組入口',
  },
  {
    id: 'mood',
    label: '心情',
    shortDescription: '個人聊天室（隨手記、emoji、外部圖片連結）',
  },
  {
    id: 'chat',
    label: '聊天',
    shortDescription: '目前家庭空間的唯一共享聊天室',
  },
  {
    id: 'ledger',
    label: '記帳',
    shortDescription: '個人或家庭帳本收支紀錄與月度統計',
  },
  {
    id: 'tasks',
    label: '待辦',
    shortDescription: '個人或家庭待辦清單與完成狀態',
  },
  {
    id: 'diary',
    label: '日記',
    shortDescription: '嚴格私人的單日多篇日記（永不對家庭共享）',
    personalOnly: true,
  },
] as const;

export const WEEKDAY_LABELS_ZH: readonly string[] = [
  '日',
  '一',
  '二',
  '三',
  '四',
  '五',
  '六',
] as const;

export interface YearMonth {
  year: number;
  month: number; // 1..12
}

export interface CalendarGridCell {
  dateStr: string; // YYYY-MM-DD
  year: number;
  month: number; // 1..12
  day: number; // 1..31
  dayOfWeek: number; // 0 (Sun) .. 6 (Sat)
  isCurrentMonth: boolean;
  isToday: boolean;
  isSelected: boolean;
  isWeekend: boolean;
  lunar: LunarDateInfo;
}

export interface CalendarNavigationState {
  todayDate: string; // YYYY-MM-DD in target timezone
  selectedDate: string; // YYYY-MM-DD, independent of todayDate
  displayedMonth: YearMonth;
  activeTab: RightPanelTab;
  selectedSpace: SelectedSpace;
  mobileView: MobileViewMode;
  diaryAutoSwitchedToPersonal?: boolean;
  selectedEventId?: string | null;
  highlightedSourceMessageId?: string | null;
}

export type EventSpanPosition = 'single' | 'start' | 'middle' | 'end';

export interface CalendarEventLike {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  timezone?: string | null;
}

export interface CalendarEventBarItem<T extends CalendarEventLike = CalendarEventLike> {
  event: T;
  dateStr: string;
  spanPosition: EventSpanPosition;
  spanDayIndex: number;
  spanTotalDays: number;
  isMultiDay: boolean;
  timeLabel: string;
}

export type DstDisambiguationPolicy = 'earlier' | 'later' | 'reject';

export interface StaleRequestTicket {
  readonly requestId: number;
  readonly signal: AbortSignal;
}

export interface StaleRequestGuard {
  /** Starts a new async operation, aborting any previous in-flight request. */
  begin(): StaleRequestTicket;
  /** Invalidates any in-flight request (e.g. on identity switch or logout) and aborts its signal. */
  invalidate(): number;
  /** Returns true only if `requestId` is still the latest active request and has not been invalidated/aborted. */
  isCurrent(requestId: number): boolean;
}

/**
 * Coordinates async requests across identity/space switches (PR #27 Blocking 1 fix).
 * Ensures that switching identity or space immediately aborts any in-flight fetch and
 * prevents out-of-order stale responses from overwriting the current identity/space state.
 */
export function createStaleRequestGuard(): StaleRequestGuard {
  let currentRequestId = 0;
  let activeController: AbortController | null = null;

  return {
    begin(): StaleRequestTicket {
      if (activeController) {
        activeController.abort();
      }
      currentRequestId += 1;
      const controller = new AbortController();
      activeController = controller;
      return {
        requestId: currentRequestId,
        signal: controller.signal,
      };
    },
    invalidate(): number {
      if (activeController) {
        activeController.abort();
        activeController = null;
      }
      currentRequestId += 1;
      return currentRequestId;
    },
    isCurrent(requestId: number): boolean {
      return (
        requestId === currentRequestId &&
        activeController !== null &&
        !activeController.signal.aborted
      );
    },
  };
}

function pad2(num: number): string {
  return String(num).padStart(2, '0');
}

export function formatLocalDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${pad2(month)}-${pad2(day)}`;
}

export function getDaysInMonth(year: number, month: number): number {
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error(`Invalid month: ${month}`);
  }
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function parseLocalDate(dateStr: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
  if (!match) {
    throw new Error(`Invalid local date string: ${dateStr}`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) {
    throw new Error(`Out-of-range month in local date string: ${dateStr}`);
  }
  const daysInTargetMonth = getDaysInMonth(year, month);
  if (day < 1 || day > daysInTargetMonth) {
    throw new Error(`Out-of-range local date string: ${dateStr}`);
  }
  return { year, month, day };
}

export function isValidLocalDateString(dateStr: string): boolean {
  try {
    parseLocalDate(dateStr);
    return true;
  } catch {
    return false;
  }
}

export function isValidIanaTimezone(timeZone: string): boolean {
  const trimmed = timeZone.trim();
  if (!trimmed) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: trimmed });
    return true;
  } catch {
    return false;
  }
}

export function normalizeTimezone(timeZone?: string | null): string {
  if (!timeZone) return DEFAULT_TIMEZONE;
  const trimmed = timeZone.trim();
  return isValidIanaTimezone(trimmed) ? trimmed : DEFAULT_TIMEZONE;
}

export function isValidUtcIsoTimestamp(timestamp: string): boolean {
  const trimmed = timestamp.trim();
  // Require full ISO 8601 date-time with 'T' and timezone designator ('Z' or ±HH:MM)
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/.test(trimmed)) {
    return false;
  }
  const ms = Date.parse(trimmed);
  return !Number.isNaN(ms);
}

export function normalizeToUtcIsoTimestamp(timestamp: string | Date): string {
  if (timestamp instanceof Date) {
    if (Number.isNaN(timestamp.getTime())) {
      throw new Error('Invalid Date instance');
    }
    return timestamp.toISOString();
  }
  if (!isValidUtcIsoTimestamp(timestamp)) {
    throw new Error(`Invalid ISO 8601 timestamp: ${timestamp}`);
  }
  return new Date(timestamp.trim()).toISOString();
}

export function formatYearMonthLabel(ym: YearMonth): string {
  return `${ym.year} 年 ${pad2(ym.month)} 月`;
}

/**
 * Computes YYYY-MM-DD in the given IANA timezone (defaults to Asia/Taipei)
 * without relying on host system local time offset.
 */
export function getTodayLocalDate(
  now: Date = new Date(),
  timeZone: string = DEFAULT_TIMEZONE,
): string {
  const targetTz = normalizeTimezone(timeZone);
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: targetTz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const parts = formatter.formatToParts(now);
    const year = parts.find((p) => p.type === 'year')?.value;
    const month = parts.find((p) => p.type === 'month')?.value;
    const day = parts.find((p) => p.type === 'day')?.value;
    if (year && month && day) {
      return `${year}-${month}-${day}`;
    }
  } catch {
    // Fallback to Asia/Taipei UTC+8 arithmetic if Intl formatting fails
  }
  const taipeiMillis = now.getTime() + 8 * 60 * 60 * 1000;
  const d = new Date(taipeiMillis);
  return formatLocalDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/**
 * Converts a UTC ISO 8601 timestamp string or Date into a local calendar date `YYYY-MM-DD`
 * in the specified IANA timezone (defaults to `Asia/Taipei`).
 */
export function formatInstantToLocalDate(
  instant: string | Date,
  timeZone: string = DEFAULT_TIMEZONE,
): string {
  const dateObj =
    instant instanceof Date ? instant : new Date(normalizeToUtcIsoTimestamp(instant));
  if (Number.isNaN(dateObj.getTime())) {
    throw new Error(`Invalid instant: ${String(instant)}`);
  }
  return getTodayLocalDate(dateObj, timeZone);
}

/**
 * Formats a UTC ISO 8601 timestamp string or Date into `HH:mm` (24-hour) in the specified IANA timezone.
 */
export function formatInstantToLocalTimeLabel(
  instant: string | Date,
  timeZone: string = DEFAULT_TIMEZONE,
): string {
  const dateObj =
    instant instanceof Date ? instant : new Date(normalizeToUtcIsoTimestamp(instant));
  if (Number.isNaN(dateObj.getTime())) {
    throw new Error(`Invalid instant: ${String(instant)}`);
  }
  const targetTz = normalizeTimezone(timeZone);
  try {
    const formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: targetTz,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    const parts = formatter.formatToParts(dateObj);
    const hour = parts.find((p) => p.type === 'hour')?.value;
    const minute = parts.find((p) => p.type === 'minute')?.value;
    if (hour && minute) {
      return `${hour}:${minute}`;
    }
  } catch {
    // Fallback to Asia/Taipei UTC+8
  }
  const taipeiMillis = dateObj.getTime() + 8 * 60 * 60 * 1000;
  const d = new Date(taipeiMillis);
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

/**
 * Formats a UTC ISO 8601 timestamp string or Date into `YYYY-MM-DDTHH:mm` in the specified IANA timezone
 * for populating datetime-local inputs or displaying local wall-clock time.
 */
export function formatInstantToLocalDateTimeInput(
  instant: string | Date,
  timeZone: string = DEFAULT_TIMEZONE,
): string {
  const localDate = formatInstantToLocalDate(instant, timeZone);
  const localTime = formatInstantToLocalTimeLabel(instant, timeZone);
  return `${localDate}T${localTime}`;
}

/**
 * Converts either a full ISO 8601 timestamp (with `Z` or `±HH:MM`) OR a local wall-clock
 * datetime string (`YYYY-MM-DDTHH:mm` / `YYYY-MM-DDTHH:mm:ss`) interpreted in `timeZone`
 * into a canonical UTC ISO 8601 string (`...Z`).
 *
 * Handles Daylight Saving Time (DST) transitions explicitly (PR #27 Non-blocking #2):
 * - Nonexistent spring-forward wall times (e.g. `2026-03-08T02:30` in `America/New_York`) are strictly rejected.
 * - Repeated fall-back wall times (e.g. `2026-11-01T01:30` in `America/New_York`) are disambiguated
 *   deterministically according to `options?.disambiguation` (defaults to `'earlier'` per RFC 5545 / Temporal).
 */
export function convertLocalDateTimeInTimezoneToUtcIso(
  dateTimeOrIso: string,
  timeZone: string = DEFAULT_TIMEZONE,
  options?: { disambiguation?: DstDisambiguationPolicy },
): string {
  const trimmed = dateTimeOrIso.trim();
  if (isValidUtcIsoTimestamp(trimmed)) {
    return normalizeToUtcIsoTimestamp(trimmed);
  }
  if (!isValidIanaTimezone(timeZone)) {
    throw new Error(`Invalid IANA timezone: ${timeZone}`);
  }
  const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(trimmed);
  if (!match) {
    throw new Error(`Invalid datetime format: ${dateTimeOrIso}`);
  }
  const { year, month, day } = parseLocalDate(match[1]);
  const hour = Number(match[2]);
  const minute = Number(match[3]);
  const second = match[4] !== undefined ? Number(match[4]) : 0;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) {
    throw new Error(`Out-of-range time component in datetime: ${dateTimeOrIso}`);
  }

  const targetUtcWallMs = Date.UTC(year, month - 1, day, hour, minute, second);
  const disambiguation: DstDisambiguationPolicy = options?.disambiguation ?? 'earlier';

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timeZone.trim(),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });

  const getObservedWallMs = (utcMs: number): number => {
    const parts = formatter.formatToParts(new Date(utcMs));
    const pYear = Number(parts.find((p) => p.type === 'year')?.value ?? year);
    const pMonth = Number(parts.find((p) => p.type === 'month')?.value ?? month);
    const pDay = Number(parts.find((p) => p.type === 'day')?.value ?? day);
    const pHour = Number(parts.find((p) => p.type === 'hour')?.value ?? hour);
    const pMinute = Number(parts.find((p) => p.type === 'minute')?.value ?? minute);
    const pSecond = Number(parts.find((p) => p.type === 'second')?.value ?? second);
    return Date.UTC(pYear, pMonth - 1, pDay, pHour, pMinute, pSecond);
  };

  const getOffsetAtUtcMs = (utcMs: number): number => getObservedWallMs(utcMs) - utcMs;

  // Probe offsets before and after any potential DST transition around targetUtcWallMs
  // (all IANA timezone offsets lie within [-14h, +14h])
  const baseGuessUtcMs = targetUtcWallMs - getOffsetAtUtcMs(targetUtcWallMs);
  const offsetBefore = getOffsetAtUtcMs(baseGuessUtcMs - 6 * 3600_000);
  const offsetAfter = getOffsetAtUtcMs(baseGuessUtcMs + 6 * 3600_000);

  const rawCandidates = [
    targetUtcWallMs - offsetBefore,
    targetUtcWallMs - offsetAfter,
  ];
  const uniqueCandidates = Array.from(new Set(rawCandidates)).sort((a, b) => a - b);
  const validUtcCandidates = uniqueCandidates.filter(
    (candMs) => getObservedWallMs(candMs) === targetUtcWallMs,
  );

  if (validUtcCandidates.length === 0) {
    throw new Error(
      `指定的本地時間 (${trimmed}) 在時區 ${timeZone.trim()} 因日光節約時間 (DST) 跳轉而不存在`,
    );
  }

  if (validUtcCandidates.length > 1) {
    if (disambiguation === 'reject') {
      throw new Error(
        `指定的本地時間 (${trimmed}) 在時區 ${timeZone.trim()} 因日光節約時間 (DST) 回撥而重複出現兩次`,
      );
    }
    const chosenMs =
      disambiguation === 'later'
        ? validUtcCandidates[validUtcCandidates.length - 1]!
        : validUtcCandidates[0]!;
    return new Date(chosenMs).toISOString();
  }

  return new Date(validUtcCandidates[0]!).toISOString();
}

/**
 * Steps a pure local date `YYYY-MM-DD` by `deltaDays` (positive or negative)
 * using calendar-day arithmetic without host timezone drift.
 */
export function addDaysToLocalDate(dateStr: string, deltaDays: number): string {
  const { year, month, day } = parseLocalDate(dateStr);
  const utcMs = Date.UTC(year, month - 1, day) + deltaDays * 86_400_000;
  const d = new Date(utcMs);
  return formatLocalDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/**
 * Lists all pure local dates (`YYYY-MM-DD`) inclusively between `startDateStr` and `endDateStr`.
 * Never applies UTC timezone offset shifts.
 */
export function listInclusiveLocalDates(
  startDateStr: string,
  endDateStr: string,
): string[] {
  const start = parseLocalDate(startDateStr);
  const end = parseLocalDate(endDateStr);
  const startUtcMs = Date.UTC(start.year, start.month - 1, start.day);
  const endUtcMs = Date.UTC(end.year, end.month - 1, end.day);
  if (endUtcMs < startUtcMs) {
    throw new Error(`endDateStr (${endDateStr}) must not be earlier than startDateStr (${startDateStr})`);
  }
  const totalDays = Math.round((endUtcMs - startUtcMs) / 86_400_000) + 1;
  const dates: string[] = [];
  for (let i = 0; i < totalDays; i++) {
    const d = new Date(startUtcMs + i * 86_400_000);
    dates.push(formatLocalDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()));
  }
  return dates;
}

/**
 * Resolves which calendar grid date cells (`YYYY-MM-DD`) an event occupies according to D4 rules:
 * 1. If `allDay === true`: `startsAt` and `endsAt` are pure `YYYY-MM-DD` local dates and MUST NOT
 *    be shifted by UTC or timezone offsets.
 * 2. If `allDay === false`: `startsAt` and `endsAt` are UTC ISO 8601 timestamps and are converted
 *    into local calendar dates using `displayTimezone ?? event.timezone ?? DEFAULT_TIMEZONE` (`Asia/Taipei`).
 */
export function resolveEventCalendarDates(
  event: {
    startsAt: string;
    endsAt: string;
    allDay: boolean;
    timezone?: string | null;
  },
  displayTimezone?: string,
): string[] {
  if (event.allDay) {
    const startPure = event.startsAt.trim().slice(0, 10);
    const endPure = event.endsAt.trim().slice(0, 10);
    return listInclusiveLocalDates(startPure, endPure);
  }
  const effectiveTimezone = normalizeTimezone(
    displayTimezone ?? event.timezone ?? DEFAULT_TIMEZONE,
  );
  const startMs = Date.parse(normalizeToUtcIsoTimestamp(event.startsAt));
  const endMs = Date.parse(normalizeToUtcIsoTimestamp(event.endsAt));
  if (endMs < startMs) {
    throw new Error('Event endsAt must not be earlier than startsAt');
  }
  const startLocalDate = formatInstantToLocalDate(event.startsAt, effectiveTimezone);
  const endLocalDate = formatInstantToLocalDate(event.endsAt, effectiveTimezone);
  return listInclusiveLocalDates(startLocalDate, endLocalDate);
}

/**
 * Maps a list of events onto calendar date cells (`YYYY-MM-DD`) using `resolveEventCalendarDates`
 * (Issue #7 Requirement #2: supports single-day, multi-day, cross-timezone, and all-day events).
 */
export function buildCalendarEventsByDateMap<T extends CalendarEventLike>(
  events: readonly T[],
  displayTimezone?: string,
): Record<string, CalendarEventBarItem<T>[]> {
  const byDate: Record<string, CalendarEventBarItem<T>[]> = {};

  for (const ev of events) {
    let occupiedDates: string[];
    try {
      const effectiveTz = displayTimezone ?? ev.timezone ?? DEFAULT_TIMEZONE;
      occupiedDates = resolveEventCalendarDates(ev, effectiveTz);
    } catch {
      continue;
    }

    const spanTotalDays = occupiedDates.length;
    const isMultiDay = spanTotalDays > 1;
    const effectiveTz = normalizeTimezone(displayTimezone ?? ev.timezone ?? DEFAULT_TIMEZONE);

    for (let idx = 0; idx < spanTotalDays; idx++) {
      const dateStr = occupiedDates[idx]!;
      const spanDayIndex = idx + 1;
      const spanPosition: EventSpanPosition = !isMultiDay
        ? 'single'
        : idx === 0
          ? 'start'
          : idx === spanTotalDays - 1
            ? 'end'
            : 'middle';

      let timeLabel: string;
      if (ev.allDay) {
        timeLabel = isMultiDay ? `全天 (${spanDayIndex}/${spanTotalDays})` : '全天';
      } else {
        const startTimeStr = formatInstantToLocalTimeLabel(ev.startsAt, effectiveTz);
        const endTimeStr = formatInstantToLocalTimeLabel(ev.endsAt, effectiveTz);
        if (!isMultiDay) {
          timeLabel = startTimeStr;
        } else if (spanPosition === 'start') {
          timeLabel = `${startTimeStr} 起 (${spanDayIndex}/${spanTotalDays})`;
        } else if (spanPosition === 'end') {
          timeLabel = `至 ${endTimeStr} (${spanDayIndex}/${spanTotalDays})`;
        } else {
          timeLabel = `跨日 (${spanDayIndex}/${spanTotalDays})`;
        }
      }

      if (!byDate[dateStr]) {
        byDate[dateStr] = [];
      }
      byDate[dateStr]!.push({
        event: ev,
        dateStr,
        spanPosition,
        spanDayIndex,
        spanTotalDays,
        isMultiDay,
        timeLabel,
      });
    }
  }

  for (const dateStr of Object.keys(byDate)) {
    byDate[dateStr]!.sort((a, b) => {
      if (a.event.allDay !== b.event.allDay) {
        return a.event.allDay ? -1 : 1;
      }
      if (a.isMultiDay !== b.isMultiDay) {
        return a.isMultiDay ? -1 : 1;
      }
      const startCmp = a.event.startsAt.localeCompare(b.event.startsAt);
      if (startCmp !== 0) return startCmp;
      return a.event.id.localeCompare(b.event.id);
    });
  }

  return byDate;
}

/**
 * Computes visible event bars and overflow metadata for a single calendar cell
 * (UX.md & Issue #7 Requirement #2: 月曆格過多事件時的收合呈現).
 */
export function getCellEventsDisplaySlice<T extends CalendarEventLike>(
  cellEvents: readonly CalendarEventBarItem<T>[],
  options?: { maxVisible?: number; isExpanded?: boolean },
): {
  visibleEvents: readonly CalendarEventBarItem<T>[];
  totalCount: number;
  hiddenCount: number;
  hasOverflow: boolean;
  isExpanded: boolean;
} {
  const maxVisible = options?.maxVisible ?? MAX_VISIBLE_EVENTS_PER_CELL;
  const isExpanded = Boolean(options?.isExpanded);
  const totalCount = cellEvents.length;
  const hasOverflow = totalCount > maxVisible;
  const hiddenCount = hasOverflow ? totalCount - maxVisible : 0;
  const visibleEvents =
    isExpanded || !hasOverflow ? cellEvents : cellEvents.slice(0, maxVisible);

  return {
    visibleEvents,
    totalCount,
    hiddenCount,
    hasOverflow,
    isExpanded,
  };
}

export function shiftYearMonth(ym: YearMonth, deltaMonths: number): YearMonth {
  const zeroBasedMonth = ym.year * 12 + (ym.month - 1) + deltaMonths;
  const nextYear = Math.floor(zeroBasedMonth / 12);
  const nextMonth = (((zeroBasedMonth % 12) + 12) % 12) + 1;
  return { year: nextYear, month: nextMonth };
}

/**
 * Clamps a `YearMonth` into the supported calendar navigation range (`1900-01` .. `2100-12`)
 * (PR #26 Follow-up #2).
 */
export function clampYearMonthToSupportedRange(ym: YearMonth): YearMonth {
  if (ym.year < MIN_CALENDAR_YEAR) {
    return { year: MIN_CALENDAR_YEAR, month: 1 };
  }
  if (ym.year > MAX_CALENDAR_YEAR) {
    return { year: MAX_CALENDAR_YEAR, month: 12 };
  }
  const clampedMonth = Math.min(12, Math.max(1, ym.month));
  return { year: ym.year, month: clampedMonth };
}

export function canNavigateCalendarMonth(ym: YearMonth, deltaMonths: number): boolean {
  const target = shiftYearMonth(ym, deltaMonths);
  return target.year >= MIN_CALENDAR_YEAR && target.year <= MAX_CALENDAR_YEAR;
}

/**
 * When navigating to a new month (UX.md: "切月時應合理保留／更新選取日"),
 * preserves the selected day-of-month clamped to the target month's max days
 * (e.g., Jan 31 -> Feb 28/29), keeping `selectedDate` distinct from `today`.
 */
export function deriveSelectedDateForMonth(
  currentSelectedDate: string,
  targetMonth: YearMonth,
): string {
  const { day } = parseLocalDate(currentSelectedDate);
  const maxDay = getDaysInMonth(targetMonth.year, targetMonth.month);
  const clampedDay = Math.min(day, maxDay);
  return formatLocalDate(targetMonth.year, targetMonth.month, clampedDay);
}

/**
 * Builds a complete 6-week (42-cell) Sunday-first calendar grid for `displayedMonth`.
 * Explicitly separates `todayDate` and `selectedDate`, and attaches `lunar: LunarDateInfo`
 * (including lunar month/day, leap month `閏月`, 24 solar terms, and festivals/holidays) to each cell.
 */
export function buildMonthCalendarGrid(
  displayedMonth: YearMonth,
  selectedDate: string,
  todayDate: string,
): CalendarGridCell[] {
  const { year, month } = displayedMonth;
  const firstDayUtc = new Date(Date.UTC(year, month - 1, 1));
  const leadingOffset = firstDayUtc.getUTCDay(); // 0 (Sun) .. 6 (Sat)
  const daysInCurrent = getDaysInMonth(year, month);

  const prevMonth = shiftYearMonth(displayedMonth, -1);
  const daysInPrev = getDaysInMonth(prevMonth.year, prevMonth.month);
  const nextMonth = shiftYearMonth(displayedMonth, 1);

  const cells: CalendarGridCell[] = [];
  const totalCells = 42; // 6 rows x 7 columns for stable Jorte-style high-density layout

  for (let i = 0; i < totalCells; i++) {
    const dayOfWeek = i % 7;
    let cellYear = year;
    let cellMonth = month;
    let cellDay = 1;
    let isCurrentMonth = true;

    if (i < leadingOffset) {
      isCurrentMonth = false;
      cellYear = prevMonth.year;
      cellMonth = prevMonth.month;
      cellDay = daysInPrev - leadingOffset + 1 + i;
    } else if (i >= leadingOffset + daysInCurrent) {
      isCurrentMonth = false;
      cellYear = nextMonth.year;
      cellMonth = nextMonth.month;
      cellDay = i - (leadingOffset + daysInCurrent) + 1;
    } else {
      cellDay = i - leadingOffset + 1;
    }

    const dateStr = formatLocalDate(cellYear, cellMonth, cellDay);
    cells.push({
      dateStr,
      year: cellYear,
      month: cellMonth,
      day: cellDay,
      dayOfWeek,
      isCurrentMonth,
      isToday: dateStr === todayDate,
      isSelected: dateStr === selectedDate,
      isWeekend: dayOfWeek === 0 || dayOfWeek === 6,
      lunar: getLunarDateInfo(dateStr),
    });
  }

  return cells;
}

export function createInitialCalendarNavigationState(
  initialTodayDate: string = getTodayLocalDate(),
): CalendarNavigationState {
  const { year, month } = parseLocalDate(initialTodayDate);
  const clampedYm = clampYearMonthToSupportedRange({ year, month });
  const effectiveSelectedDate =
    clampedYm.year === year && clampedYm.month === month
      ? initialTodayDate
      : deriveSelectedDateForMonth(initialTodayDate, clampedYm);
  return {
    todayDate: initialTodayDate,
    selectedDate: effectiveSelectedDate,
    displayedMonth: clampedYm,
    activeTab: 'summary',
    selectedSpace: { kind: 'personal' },
    mobileView: 'calendar',
    diaryAutoSwitchedToPersonal: false,
    selectedEventId: null,
    highlightedSourceMessageId: null,
  };
}

/**
 * Pure reducer transitions for calendar layout, right-hand tabs & space synchronization (Issue #5, #6 & #7):
 * - Clicking blank area of a date cell selects that date, clears `selectedEventId`, opens 'summary', and on mobile opens panel if requested.
 * - Clicking an event bar inside a date cell selects that event (`selectedEventId`), updates `selectedDate` to the clicked cell date, and opens its Event Detail view.
 * - Switching tabs NEVER alters `selectedDate` or `todayDate`.
 * - Selecting 'diary' (`personalOnly: true`) while in a family space automatically routes `selectedSpace` back to `{ kind: 'personal' }` and flags `diaryAutoSwitchedToPersonal: true`.
 * - Switching to a family space while on the 'diary' tab transitions `activeTab` to `'summary'` so personal diary is never left open in family context.
 * - Navigating months updates `displayedMonth` (clamped within 1900–2100) and clamps `selectedDate` to the same day-of-month in target month without resetting to `todayDate`.
 */
export function selectCalendarDateBlank(
  state: CalendarNavigationState,
  targetDateStr: string,
  options?: { openMobilePanel?: boolean },
): CalendarNavigationState {
  const { year, month } = parseLocalDate(targetDateStr);
  const clampedYm = clampYearMonthToSupportedRange({ year, month });
  const effectiveDateStr =
    clampedYm.year === year && clampedYm.month === month
      ? targetDateStr
      : deriveSelectedDateForMonth(targetDateStr, clampedYm);
  return {
    ...state,
    selectedDate: effectiveDateStr,
    displayedMonth: clampedYm,
    activeTab: 'summary',
    mobileView: options?.openMobilePanel ? 'panel' : state.mobileView,
    diaryAutoSwitchedToPersonal: false,
    selectedEventId: null,
    highlightedSourceMessageId: null,
  };
}

/**
 * Triggered when clicking an event bar inside a calendar date cell (UX.md: "點日期格事件：開該事件詳情").
 * Distinct from clicking the cell's blank area (`selectCalendarDateBlank`), this sets `selectedEventId`
 * so the Right Panel directly displays that event's detail inspector.
 */
export function selectCalendarEventFromCell(
  state: CalendarNavigationState,
  eventId: string,
  cellDateStr: string,
  options?: { openMobilePanel?: boolean },
): CalendarNavigationState {
  const { year, month } = parseLocalDate(cellDateStr);
  const clampedYm = clampYearMonthToSupportedRange({ year, month });
  const effectiveDateStr =
    clampedYm.year === year && clampedYm.month === month
      ? cellDateStr
      : deriveSelectedDateForMonth(cellDateStr, clampedYm);
  return {
    ...state,
    selectedDate: effectiveDateStr,
    displayedMonth: clampedYm,
    activeTab: 'summary',
    mobileView: options?.openMobilePanel ? 'panel' : state.mobileView,
    diaryAutoSwitchedToPersonal: false,
    selectedEventId: eventId,
    highlightedSourceMessageId: null,
  };
}

export function clearSelectedCalendarEvent(
  state: CalendarNavigationState,
): CalendarNavigationState {
  if (!state.selectedEventId) return state;
  return {
    ...state,
    selectedEventId: null,
  };
}

/**
 * Synchronizes `selectedSpace`, `selectedDate`, `displayedMonth`, `activeTab`, and `highlightedSourceMessageId`
 * when navigating from an event's "查看來源聊天" action back to its source message (PR #27 Blocking 2 fix).
 * - If the source message belongs to a family chat room (`roomKind === 'family'`), switches `selectedSpace`
 *   to `{ kind: 'family', familyId }` and opens the `'chat'` tab (even if the event itself was personal).
 * - If the source message belongs to a personal mood room (`roomKind === 'personal'`), switches `selectedSpace`
 *   to `{ kind: 'personal' }` and opens the `'mood'` tab.
 * - If `sourceStatus !== 'accessible'` or `sourceMessage` is null (deleted or inaccessible), returns `state` unchanged.
 */
export function navigateCalendarToEventSourceMessage(
  state: CalendarNavigationState,
  source: {
    sourceStatus: 'none' | 'accessible' | 'deleted' | 'inaccessible';
    sourceMessage: {
      id: string;
      roomId: string;
      roomKind: 'personal' | 'family';
      familyId: string | null;
      localDate: string;
    } | null;
  },
  authorizedFamilyIds?: readonly string[],
): CalendarNavigationState {
  if (source.sourceStatus !== 'accessible' || !source.sourceMessage) {
    return state;
  }

  const msg = source.sourceMessage;
  let targetSpace: SelectedSpace;
  let targetTab: RightPanelTab;

  if (msg.roomKind === 'personal') {
    targetSpace = { kind: 'personal' };
    targetTab = 'mood';
  } else if (msg.roomKind === 'family' && msg.familyId) {
    if (authorizedFamilyIds && !authorizedFamilyIds.includes(msg.familyId)) {
      return state;
    }
    targetSpace = { kind: 'family', familyId: msg.familyId };
    targetTab = 'chat';
  } else {
    return state;
  }

  const jumped = jumpCalendarToDate(state, msg.localDate);
  return {
    ...jumped,
    selectedSpace: targetSpace,
    activeTab: targetTab,
    selectedEventId: null,
    highlightedSourceMessageId: msg.id,
    diaryAutoSwitchedToPersonal: false,
    mobileView: 'panel',
  };
}

export function switchRightPanelTab(
  state: CalendarNavigationState,
  nextTab: RightPanelTab,
): CalendarNavigationState {
  const tabMeta = RIGHT_PANEL_TABS.find((t) => t.id === nextTab);
  const requiresPersonalSpace = Boolean(tabMeta?.personalOnly);
  const autoSwitched = requiresPersonalSpace && state.selectedSpace.kind === 'family';

  return {
    ...state,
    activeTab: nextTab,
    selectedSpace: autoSwitched ? { kind: 'personal' } : state.selectedSpace,
    diaryAutoSwitchedToPersonal: autoSwitched,
    selectedEventId: autoSwitched ? null : state.selectedEventId,
    highlightedSourceMessageId: null,
    // selectedDate and todayDate are intentionally untouched
  };
}

export function selectCalendarSpace(
  state: CalendarNavigationState,
  nextSpace: SelectedSpace,
): CalendarNavigationState {
  const currentTabMeta = RIGHT_PANEL_TABS.find((t) => t.id === state.activeTab);
  const shouldLeavePersonalOnlyTab =
    nextSpace.kind === 'family' && Boolean(currentTabMeta?.personalOnly);

  return {
    ...state,
    selectedSpace: nextSpace,
    activeTab: shouldLeavePersonalOnlyTab ? 'summary' : state.activeTab,
    diaryAutoSwitchedToPersonal: false,
    selectedEventId: null,
    highlightedSourceMessageId: null,
  };
}

/**
 * Resets `selectedSpace` to `{ kind: 'personal' }` when switching test identities or logging out
 * (PR #25 Follow-up #1: prevents stale cross-identity family space state).
 */
export function resetCalendarSelectedSpaceToPersonal(
  state: CalendarNavigationState,
): CalendarNavigationState {
  if (
    state.selectedSpace.kind === 'personal' &&
    !state.diaryAutoSwitchedToPersonal &&
    !state.selectedEventId &&
    !state.highlightedSourceMessageId
  ) {
    return state;
  }
  return {
    ...state,
    selectedSpace: { kind: 'personal' },
    diaryAutoSwitchedToPersonal: false,
    selectedEventId: null,
    highlightedSourceMessageId: null,
  };
}

/**
 * Validates `state.selectedSpace` against the current user's authorized `familyIds`.
 * If the selected family is no longer in `authorizedFamilyIds` (e.g., after leaving a family or switching identity),
 * automatically resets `selectedSpace` to `{ kind: 'personal' }`.
 */
export function reconcileCalendarSelectedSpace(
  state: CalendarNavigationState,
  authorizedFamilyIds: readonly string[],
): CalendarNavigationState {
  if (state.selectedSpace.kind === 'family') {
    if (!authorizedFamilyIds.includes(state.selectedSpace.familyId)) {
      return {
        ...state,
        selectedSpace: { kind: 'personal' },
        diaryAutoSwitchedToPersonal: false,
        selectedEventId: null,
        highlightedSourceMessageId: null,
      };
    }
  }
  return state;
}

/**
 * Refreshes `state.todayDate` on midnight rollover or window focus/visibilitychange
 * without overwriting `state.selectedDate` (PR #25 Follow-up #2).
 */
export function refreshCalendarTodayDate(
  state: CalendarNavigationState,
  latestTodayDate: string = getTodayLocalDate(),
): CalendarNavigationState {
  parseLocalDate(latestTodayDate);
  if (state.todayDate === latestTodayDate) {
    return state;
  }
  return {
    ...state,
    todayDate: latestTodayDate,
    // selectedDate and displayedMonth remain independent of todayDate
  };
}

export function navigateCalendarMonth(
  state: CalendarNavigationState,
  deltaMonths: number,
): CalendarNavigationState {
  const rawNextMonth = shiftYearMonth(state.displayedMonth, deltaMonths);
  const nextMonth = clampYearMonthToSupportedRange(rawNextMonth);
  if (
    nextMonth.year === state.displayedMonth.year &&
    nextMonth.month === state.displayedMonth.month
  ) {
    return state;
  }
  const nextSelectedDate = deriveSelectedDateForMonth(state.selectedDate, nextMonth);
  return {
    ...state,
    displayedMonth: nextMonth,
    selectedDate: nextSelectedDate,
  };
}

export function jumpCalendarToDate(
  state: CalendarNavigationState,
  targetDateStr: string,
): CalendarNavigationState {
  const { year, month } = parseLocalDate(targetDateStr);
  const clampedYm = clampYearMonthToSupportedRange({ year, month });
  const effectiveDateStr =
    clampedYm.year === year && clampedYm.month === month
      ? targetDateStr
      : deriveSelectedDateForMonth(targetDateStr, clampedYm);
  return {
    ...state,
    selectedDate: effectiveDateStr,
    displayedMonth: clampedYm,
  };
}

/**
 * Minimal shape of a task for calendar due-date mapping (Issue #8).
 */
export interface CalendarTaskLike {
  id: string;
  title: string;
  dueDate: string | null;
  completedAt: string | null;
  createdAt?: string;
}

/**
 * Groups tasks onto calendar date cells by their pure `due_date` (`YYYY-MM-DD`, Review D4).
 * Tasks with `dueDate = null` (or an invalid date string) never appear in a date cell.
 * `dueDate` is used as-is: no UTC / timezone shifting is applied. Within a cell, incomplete
 * tasks sort before completed ones, then by `createdAt` and `id`.
 */
export function buildTasksByDueDateMap<T extends CalendarTaskLike>(
  tasks: readonly T[],
): Record<string, T[]> {
  const byDate: Record<string, T[]> = {};
  for (const task of tasks) {
    if (!task.dueDate || !isValidLocalDateString(task.dueDate)) continue;
    (byDate[task.dueDate] ??= []).push(task);
  }
  for (const key of Object.keys(byDate)) {
    byDate[key]!.sort((a, b) => {
      const aDone = a.completedAt ? 1 : 0;
      const bDone = b.completedAt ? 1 : 0;
      if (aDone !== bDone) return aDone - bDone;
      const created = (a.createdAt ?? '').localeCompare(b.createdAt ?? '');
      if (created !== 0) return created;
      return a.id.localeCompare(b.id);
    });
  }
  return byDate;
}

/**
 * Selects `dateStr` and opens the right-hand 'tasks' tab (clicking a task chip in a date cell).
 * Space is unchanged; `selectedEventId` is cleared.
 */
export function openCalendarTasksForDate(
  state: CalendarNavigationState,
  dateStr: string,
  options?: { openMobilePanel?: boolean },
): CalendarNavigationState {
  const selected = selectCalendarDateBlank(state, dateStr, options);
  return switchRightPanelTab(selected, 'tasks');
}