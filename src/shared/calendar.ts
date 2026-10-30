import { z } from 'zod';
import { DEFAULT_TIMEZONE } from './health';
import { getLunarDateInfo, type LunarDateInfo } from './lunar';

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

export function shiftYearMonth(ym: YearMonth, deltaMonths: number): YearMonth {
  const zeroBasedMonth = ym.year * 12 + (ym.month - 1) + deltaMonths;
  const nextYear = Math.floor(zeroBasedMonth / 12);
  const nextMonth = (((zeroBasedMonth % 12) + 12) % 12) + 1;
  return { year: nextYear, month: nextMonth };
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
  return {
    todayDate: initialTodayDate,
    selectedDate: initialTodayDate,
    displayedMonth: { year, month },
    activeTab: 'summary',
    selectedSpace: { kind: 'personal' },
    mobileView: 'calendar',
    diaryAutoSwitchedToPersonal: false,
  };
}

/**
 * Pure reducer transitions for calendar layout, right-hand tabs & space synchronization (Issue #5 & #6):
 * - Clicking blank area of a date cell selects that date, opens 'summary', and on mobile opens panel if requested.
 * - Switching tabs NEVER alters `selectedDate` or `todayDate`.
 * - Selecting 'diary' (`personalOnly: true`) while in a family space automatically routes `selectedSpace` back to `{ kind: 'personal' }` and flags `diaryAutoSwitchedToPersonal: true`.
 * - Switching to a family space while on the 'diary' tab transitions `activeTab` to `'summary'` so personal diary is never left open in family context.
 * - Navigating months updates `displayedMonth` and clamps `selectedDate` to the same day-of-month in target month without resetting to `todayDate`.
 */
export function selectCalendarDateBlank(
  state: CalendarNavigationState,
  targetDateStr: string,
  options?: { openMobilePanel?: boolean },
): CalendarNavigationState {
  const { year, month } = parseLocalDate(targetDateStr);
  return {
    ...state,
    selectedDate: targetDateStr,
    displayedMonth: { year, month },
    activeTab: 'summary',
    mobileView: options?.openMobilePanel ? 'panel' : state.mobileView,
    diaryAutoSwitchedToPersonal: false,
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
  };
}

/**
 * Resets `selectedSpace` to `{ kind: 'personal' }` when switching test identities or logging out
 * (PR #25 Follow-up #1: prevents stale cross-identity family space state).
 */
export function resetCalendarSelectedSpaceToPersonal(
  state: CalendarNavigationState,
): CalendarNavigationState {
  if (state.selectedSpace.kind === 'personal' && !state.diaryAutoSwitchedToPersonal) {
    return state;
  }
  return {
    ...state,
    selectedSpace: { kind: 'personal' },
    diaryAutoSwitchedToPersonal: false,
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
  const nextMonth = shiftYearMonth(state.displayedMonth, deltaMonths);
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
  return {
    ...state,
    selectedDate: targetDateStr,
    displayedMonth: { year, month },
  };
}
