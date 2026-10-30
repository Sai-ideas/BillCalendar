import { z } from 'zod';
import { DEFAULT_TIMEZONE } from './health';

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
}

export interface CalendarNavigationState {
  todayDate: string; // YYYY-MM-DD in target timezone
  selectedDate: string; // YYYY-MM-DD, independent of todayDate
  displayedMonth: YearMonth;
  activeTab: RightPanelTab;
  selectedSpace: SelectedSpace;
  mobileView: MobileViewMode;
}

function pad2(num: number): string {
  return String(num).padStart(2, '0');
}

export function formatLocalDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${pad2(month)}-${pad2(day)}`;
}

export function parseLocalDate(dateStr: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
  if (!match) {
    throw new Error(`Invalid local date string: ${dateStr}`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const daysInTargetMonth = getDaysInMonth(year, month);
  if (month < 1 || month > 12 || day < 1 || day > daysInTargetMonth) {
    throw new Error(`Out-of-range local date string: ${dateStr}`);
  }
  return { year, month, day };
}

export function getDaysInMonth(year: number, month: number): number {
  if (month < 1 || month > 12) {
    throw new Error(`Invalid month: ${month}`);
  }
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
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
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
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
    // Fallback to Asia/Taipei UTC+8 arithmetic if invalid timezone string is supplied
  }
  const taipeiMillis = now.getTime() + 8 * 60 * 60 * 1000;
  const d = new Date(taipeiMillis);
  return formatLocalDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
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
 * Explicitly separates `todayDate` and `selectedDate`.
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
  };
}

/**
 * Pure reducer transitions for calendar layout & right-hand tabs (Issue #5):
 * - Clicking blank area of a date cell selects that date, opens 'summary', and on mobile opens panel if requested.
 * - Switching tabs NEVER alters `selectedDate` or `todayDate`.
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
  };
}

export function switchRightPanelTab(
  state: CalendarNavigationState,
  nextTab: RightPanelTab,
): CalendarNavigationState {
  return {
    ...state,
    activeTab: nextTab,
    // selectedDate and todayDate are intentionally untouched
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
