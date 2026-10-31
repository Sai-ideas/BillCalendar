// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ALL_24_SOLAR_TERMS_ZH_TW,
  CreateEventRequestSchema,
  LUNAR_AND_HOLIDAY_PROVENANCE,
  LocalDateStringSchema,
  MAX_CALENDAR_YEAR,
  MIN_CALENDAR_YEAR,
  RIGHT_PANEL_TABS,
  buildCalendarEventsByDateMap,
  buildMonthCalendarGrid,
  canNavigateCalendarMonth,
  convertLocalDateTimeInTimezoneToUtcIso,
  createInitialCalendarNavigationState,
  createStaleRequestGuard,
  deriveSelectedDateForMonth,
  formatInstantToLocalDate,
  getLunarDateInfo,
  getTodayLocalDate,
  isSolarYearInLunarSupportedRange,
  navigateCalendarMonth,
  navigateCalendarToEventSourceMessage,
  reconcileCalendarSelectedSpace,
  refreshCalendarTodayDate,
  resetCalendarSelectedSpaceToPersonal,
  resolveEventCalendarDates,
  selectCalendarDateBlank,
  selectCalendarEventFromCell,
  selectCalendarSpace,
  switchRightPanelTab,
  type CalendarNavigationState,
  type EventDetail,
  type FamilySummary,
} from '../shared';
import { CalendarWorkspace } from './components/CalendarWorkspace';

afterEach(() => {
  cleanup();
});

const MOCK_FAMILIES: FamilySummary[] = [
  {
    id: 'fam_01',
    name: '陳家生活空間',
    createdBy: 'usr_alice',
    myRole: 'admin',
    memberCount: 2,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  },
];

function StatefulCalendarHarness({
  initialToday = '2026-10-30',
  families = MOCK_FAMILIES,
  getNow,
  initialEvents = [],
}: {
  initialToday?: string;
  families?: FamilySummary[];
  getNow?: () => Date;
  initialEvents?: EventDetail[];
}) {
  const [navState, setNavState] = useState<CalendarNavigationState>(() =>
    createInitialCalendarNavigationState(initialToday),
  );
  return (
    <CalendarWorkspace
      navState={navState}
      onChangeNavState={setNavState}
      families={families}
      getNow={getNow}
      initialEvents={initialEvents}
    />
  );
}

describe('Issue #5 Calendar Layout, Right-Hand Tabs & Date State', () => {
  describe('Pure state & grid rules (src/shared/calendar.ts)', () => {
    it('builds a 42-cell month grid where selectedDate and todayDate are tracked independently', () => {
      const cells = buildMonthCalendarGrid(
        { year: 2026, month: 10 },
        '2026-10-15',
        '2026-10-30',
      );
      expect(cells).toHaveLength(42);

      const selectedCells = cells.filter((c) => c.isSelected);
      const todayCells = cells.filter((c) => c.isToday);
      expect(selectedCells).toHaveLength(1);
      expect(todayCells).toHaveLength(1);
      expect(selectedCells[0]?.dateStr).toBe('2026-10-15');
      expect(selectedCells[0]?.isToday).toBe(false);
      expect(todayCells[0]?.dateStr).toBe('2026-10-30');
      expect(todayCells[0]?.isSelected).toBe(false);
    });

    it('clamps selected day-of-month when navigating across months with fewer days (e.g., Jan 31 -> Feb 28)', () => {
      expect(deriveSelectedDateForMonth('2026-01-31', { year: 2026, month: 2 })).toBe(
        '2026-02-28',
      );
      // Leap year 2028 Feb -> 29
      expect(deriveSelectedDateForMonth('2028-01-31', { year: 2028, month: 2 })).toBe(
        '2028-02-29',
      );
    });

    it('preserves selectedDate when switching right-hand tabs and resets to summary when clicking a blank date cell', () => {
      let state = createInitialCalendarNavigationState('2026-10-30');
      state = selectCalendarDateBlank(state, '2026-10-12');
      expect(state.selectedDate).toBe('2026-10-12');
      expect(state.todayDate).toBe('2026-10-30');
      expect(state.activeTab).toBe('summary');

      for (const tab of RIGHT_PANEL_TABS) {
        state = switchRightPanelTab(state, tab.id);
        expect(state.activeTab).toBe(tab.id);
        expect(state.selectedDate).toBe('2026-10-12');
        expect(state.todayDate).toBe('2026-10-30');
      }

      // Clicking another blank date cell while on 'diary' tab selects the new date and opens 'summary'
      state = selectCalendarDateBlank(state, '2026-10-21');
      expect(state.selectedDate).toBe('2026-10-21');
      expect(state.activeTab).toBe('summary');
    });

    it('updates displayedMonth and selectedDate when navigating months without overwriting todayDate', () => {
      let state = createInitialCalendarNavigationState('2026-10-30');
      state = selectCalendarDateBlank(state, '2026-10-31');
      state = navigateCalendarMonth(state, 1); // -> Nov 2026 (30 days)
      expect(state.displayedMonth).toEqual({ year: 2026, month: 11 });
      expect(state.selectedDate).toBe('2026-11-30');
      expect(state.todayDate).toBe('2026-10-30');
    });

    it('calculates Asia/Taipei local date accurately across UTC midnight boundaries', () => {
      // 2026-10-29T18:30:00Z is 2026-10-30T02:30:00+08:00 in Asia/Taipei
      const utcInstant = new Date('2026-10-29T18:30:00.000Z');
      expect(getTodayLocalDate(utcInstant, 'Asia/Taipei')).toBe('2026-10-30');
    });
  });

  describe('Interactive UI behavior (CalendarWorkspace.tsx)', () => {
    it('supports month navigation, date selection, and keeps selectedDate separate from today', () => {
      render(<StatefulCalendarHarness initialToday="2026-10-30" />);

      expect(screen.getByTestId('calendar-current-month-label').textContent).toBe(
        '2026 年 10 月',
      );
      expect(screen.getByTestId('status-today-date').textContent).toBe('2026-10-30');
      expect(screen.getByTestId('status-selected-date').textContent).toBe('2026-10-30');

      // Select another date in October
      fireEvent.click(screen.getByTestId('calendar-cell-2026-10-14'));
      expect(screen.getByTestId('status-selected-date').textContent).toBe('2026-10-14');
      expect(screen.getByTestId('status-today-date').textContent).toBe('2026-10-30');
      expect(screen.getByTestId('right-panel-heading').textContent).toContain(
        '2026-10-14 — 摘要',
      );

      // Navigate to previous month (September 2026)
      fireEvent.click(screen.getByTestId('calendar-prev-month'));
      expect(screen.getByTestId('calendar-current-month-label').textContent).toBe(
        '2026 年 09 月',
      );
      expect(screen.getByTestId('status-selected-date').textContent).toBe('2026-09-14');
      expect(screen.getByTestId('status-today-date').textContent).toBe('2026-10-30');

      // Navigate to next month twice (-> November 2026)
      fireEvent.click(screen.getByTestId('calendar-next-month'));
      fireEvent.click(screen.getByTestId('calendar-next-month'));
      expect(screen.getByTestId('calendar-current-month-label').textContent).toBe(
        '2026 年 11 月',
      );
      expect(screen.getByTestId('status-selected-date').textContent).toBe('2026-11-14');
    });

    it('renders all 6 right-hand tabs (摘要/心情/聊天/記帳/待辦/日記) and switching tabs never alters selectedDate', () => {
      render(<StatefulCalendarHarness initialToday="2026-10-30" />);

      // Choose a specific non-today date first
      fireEvent.click(screen.getByTestId('calendar-cell-2026-10-08'));
      expect(screen.getByTestId('status-selected-date').textContent).toBe('2026-10-08');

      const tabExpectations: Array<{ id: string; label: string }> = [
        { id: 'summary', label: '摘要' },
        { id: 'mood', label: '心情' },
        { id: 'chat', label: '聊天' },
        { id: 'ledger', label: '記帳' },
        { id: 'tasks', label: '待辦' },
        { id: 'diary', label: '日記' },
      ];

      for (const tab of tabExpectations) {
        const tabBtn = screen.getByTestId(`right-tab-${tab.id}`);
        expect(tabBtn.textContent).toContain(tab.label);
        fireEvent.click(tabBtn);

        expect(tabBtn.getAttribute('aria-selected')).toBe('true');
        expect(screen.getByTestId('status-selected-date').textContent).toBe('2026-10-08');
        expect(screen.getByTestId('status-today-date').textContent).toBe('2026-10-30');
        expect(screen.getByTestId('right-panel-heading').textContent).toBe(
          `2026-10-08 — ${tab.label}`,
        );
        expect(screen.getByTestId(`right-tabpanel-${tab.id}`)).toBeTruthy();
      }

      // Clicking a blank date cell while on 'diary' tab switches right panel back to 'summary' for the clicked date
      fireEvent.click(screen.getByTestId('calendar-cell-2026-10-19'));
      expect(screen.getByTestId('status-selected-date').textContent).toBe('2026-10-19');
      expect(screen.getByTestId('right-tab-summary').getAttribute('aria-selected')).toBe(
        'true',
      );
      expect(screen.getByTestId('right-panel-heading').textContent).toBe(
        '2026-10-19 — 摘要',
      );
    });

    it('supports desktop and mobile alternative layout switching while preserving selectedDate and selectedSpace', () => {
      render(<StatefulCalendarHarness initialToday="2026-10-30" />);

      // Select 2026-10-22
      fireEvent.click(screen.getByTestId('calendar-cell-2026-10-22'));
      expect(screen.getByTestId('status-selected-date').textContent).toBe('2026-10-22');

      // Mobile view defaults to 'calendar' (left pane visible, right pane hidden on mobile via hidden lg:flex)
      const leftPane = screen.getByTestId('calendar-left-pane');
      const rightPane = screen.getByTestId('calendar-right-pane');
      expect(leftPane.className).toContain('block');
      expect(rightPane.className).toContain('hidden lg:flex');

      // Click mobile quick action button to open selected date summary in mobile panel view
      fireEvent.click(screen.getByTestId('mobile-open-selected-summary'));
      expect(leftPane.className).toContain('hidden lg:block');
      expect(rightPane.className).not.toContain('hidden lg:flex');
      expect(screen.getByTestId('status-selected-date').textContent).toBe('2026-10-22');

      // Switch space to Family while viewing panel
      fireEvent.click(screen.getByTestId('space-switch-family-fam_01'));
      expect(screen.getByTestId('status-selected-space').textContent).toBe(
        '家庭：陳家生活空間',
      );

      // Use mobile back-to-calendar button and verify selectedDate is still 2026-10-22
      const backBtn = within(rightPane).getByTestId('mobile-back-to-calendar');
      fireEvent.click(backBtn);
      expect(leftPane.className).toContain('block');
      expect(screen.getByTestId('status-selected-date').textContent).toBe('2026-10-22');
    });
  });
});

describe('Issue #6 Lunar Display, 24 Solar Terms, Holidays & Date/Timezone Rules', () => {
  it('verifies Solar-to-Lunar correspondence across Lunar New Year, 29/30-day New Year Eve (除夕), and Leap Months (閏月)', () => {
    // 1. 2024 Lunar New Year's Eve on a 30-day 12th lunar month (癸卯年臘月三十 -> 除夕)
    const eve2024 = getLunarDateInfo('2024-02-09');
    expect(eve2024.lunarYear).toBe(2023);
    expect(eve2024.lunarMonth).toBe(12);
    expect(eve2024.lunarDay).toBe(30);
    expect(eve2024.lunarMonthDayCount).toBe(30);
    expect(eve2024.lunarMonthLabel).toBe('臘月');
    expect(eve2024.lunarDayLabel).toBe('三十');
    expect(eve2024.traditionalFestival).toBe('除夕');
    expect(eve2024.cellDisplayText).toBe('除夕');

    const cny2024 = getLunarDateInfo('2024-02-10');
    expect(cny2024.lunarYear).toBe(2024);
    expect(cny2024.ganZhiYear).toBe('甲辰');
    expect(cny2024.zodiac).toBe('龍');
    expect(cny2024.lunarMonthLabel).toBe('正月');
    expect(cny2024.lunarDayLabel).toBe('初一');
    expect(cny2024.traditionalFestival).toBe('春節');

    // 2. 2025 & 2026 Lunar New Year's Eve on a 29-day 12th lunar month (臘月廿九 -> 除夕)
    const eve2025 = getLunarDateInfo('2025-01-28');
    expect(eve2025.lunarMonth).toBe(12);
    expect(eve2025.lunarDay).toBe(29);
    expect(eve2025.lunarMonthDayCount).toBe(29);
    expect(eve2025.traditionalFestival).toBe('除夕');
    expect(eve2025.cellDisplayText).toBe('除夕');

    const eve2026 = getLunarDateInfo('2026-02-16');
    expect(eve2026.lunarMonth).toBe(12);
    expect(eve2026.lunarDay).toBe(29);
    expect(eve2026.lunarMonthDayCount).toBe(29);
    expect(eve2026.traditionalFestival).toBe('除夕');

    const cny2026 = getLunarDateInfo('2026-02-17');
    expect(cny2026.ganZhiYear).toBe('丙午');
    expect(cny2026.zodiac).toBe('馬');
    expect(cny2026.lunarMonthLabel).toBe('正月');
    expect(cny2026.lunarDayLabel).toBe('初一');
    expect(cny2026.traditionalFestival).toBe('春節');
    expect(cny2026.cellDisplayText).toBe('春節');

    // 3. 2025 Lunar Leap 6th Month (乙巳年閏六月: 2025-07-25 ~ 2025-08-22)
    const beforeLeap2025 = getLunarDateInfo('2025-07-24');
    expect(beforeLeap2025.isLeapMonth).toBe(false);
    expect(beforeLeap2025.lunarMonth).toBe(6);
    expect(beforeLeap2025.lunarDay).toBe(30);
    expect(beforeLeap2025.lunarMonthLabel).toBe('六月');

    const leapStart2025 = getLunarDateInfo('2025-07-25');
    expect(leapStart2025.isLeapMonth).toBe(true);
    expect(leapStart2025.lunarMonth).toBe(6);
    expect(leapStart2025.lunarDay).toBe(1);
    expect(leapStart2025.leapMonthOfYear).toBe(6);
    expect(leapStart2025.lunarMonthLabel).toBe('閏六月');
    expect(leapStart2025.lunarDayLabel).toBe('初一');
    expect(leapStart2025.cellDisplayText).toBe('閏六月');
    expect(leapStart2025.cellHighlightKind).toBe('lunar_first_day');

    const leapEnd2025 = getLunarDateInfo('2025-08-22');
    expect(leapEnd2025.isLeapMonth).toBe(true);
    expect(leapEnd2025.lunarMonth).toBe(6);
    expect(leapEnd2025.lunarDay).toBe(29);
    expect(leapEnd2025.lunarMonthLabel).toBe('閏六月');
    expect(leapEnd2025.lunarDayLabel).toBe('廿九');

    const afterLeap2025 = getLunarDateInfo('2025-08-23');
    expect(afterLeap2025.isLeapMonth).toBe(false);
    expect(afterLeap2025.lunarMonth).toBe(7);
    expect(afterLeap2025.lunarDay).toBe(1);
    expect(afterLeap2025.lunarMonthLabel).toBe('七月');
    expect(afterLeap2025.solarTerm).toBe('處暑');

    // 4. Leap month does NOT duplicate traditional festivals (e.g. 2028 戊申年 has 閏五月)
    const regularDragonBoat2028 = getLunarDateInfo('2028-05-28'); // 五月初五
    expect(regularDragonBoat2028.isLeapMonth).toBe(false);
    expect(regularDragonBoat2028.lunarMonth).toBe(5);
    expect(regularDragonBoat2028.lunarDay).toBe(5);
    expect(regularDragonBoat2028.traditionalFestival).toBe('端午節');

    const leapFifthDay2028 = getLunarDateInfo('2028-06-27'); // 閏五月初五
    expect(leapFifthDay2028.isLeapMonth).toBe(true);
    expect(leapFifthDay2028.lunarMonth).toBe(5);
    expect(leapFifthDay2028.lunarDay).toBe(5);
    expect(leapFifthDay2028.lunarMonthLabel).toBe('閏五月');
    expect(leapFifthDay2028.traditionalFestival).toBeNull();
    expect(leapFifthDay2028.cellDisplayText).toBe('初五');
  });

  it('recognizes all 24 Solar Terms in Traditional Chinese and Taiwan reference holidays without claiming recurring scheduling', () => {
    const foundSolarTerms = new Set<string>();
    for (let month = 1; month <= 12; month++) {
      for (let day = 1; day <= 31; day++) {
        const dateStr = `2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        if (!LocalDateStringSchema.safeParse(dateStr).success) continue;
        const info = getLunarDateInfo(dateStr);
        if (info.solarTerm) {
          foundSolarTerms.add(info.solarTerm);
        }
      }
    }

    expect(foundSolarTerms.size).toBe(24);
    for (const term of ALL_24_SOLAR_TERMS_ZH_TW) {
      expect(foundSolarTerms.has(term)).toBe(true);
    }

    // Specific 2026 solar terms & holidays check
    expect(getLunarDateInfo('2026-03-05').solarTerm).toBe('驚蟄');
    expect(getLunarDateInfo('2026-04-20').solarTerm).toBe('穀雨');
    expect(getLunarDateInfo('2026-05-21').solarTerm).toBe('小滿');
    expect(getLunarDateInfo('2026-06-05').solarTerm).toBe('芒種');
    expect(getLunarDateInfo('2026-08-23').solarTerm).toBe('處暑');
    expect(getLunarDateInfo('2026-09-25').traditionalFestival).toBe('中秋節');
    expect(getLunarDateInfo('2026-10-10').officialHoliday).toBe('國慶日');

    // Provenance & non-goal boundary check
    expect(LUNAR_AND_HOLIDAY_PROVENANCE.lunarEngine.packageName).toBe('lunar-javascript');
    expect(LUNAR_AND_HOLIDAY_PROVENANCE.lunarEngine.license).toBe('MIT');
    expect(LUNAR_AND_HOLIDAY_PROVENANCE.mvpScopeBoundary.supportsLunarRecurringSchedule).toBe(
      false,
    );
  });

  it('enforces UTC timestamp / pure YYYY-MM-DD local date / Asia/Taipei timezone boundary rules (D4)', () => {
    // 1. Cross-midnight & cross-month boundary in Asia/Taipei (UTC+8)
    expect(formatInstantToLocalDate('2026-10-31T15:59:59.000Z', 'Asia/Taipei')).toBe(
      '2026-10-31',
    );
    expect(formatInstantToLocalDate('2026-10-31T16:00:00.000Z', 'Asia/Taipei')).toBe(
      '2026-11-01',
    );

    // 2. Cross-year boundary in Asia/Taipei (UTC+8)
    expect(formatInstantToLocalDate('2026-12-31T15:59:59.000Z', 'Asia/Taipei')).toBe(
      '2026-12-31',
    );
    expect(formatInstantToLocalDate('2026-12-31T16:00:00.000Z', 'Asia/Taipei')).toBe(
      '2027-01-01',
    );

    // 3. All-day events (allDay = true) use pure YYYY-MM-DD strings without ANY UTC/timezone offset shift
    const allDayDatesInTaipei = resolveEventCalendarDates(
      {
        startsAt: '2026-10-31',
        endsAt: '2026-11-02',
        allDay: true,
        timezone: 'Asia/Taipei',
      },
      'Asia/Taipei',
    );
    const allDayDatesInNewYork = resolveEventCalendarDates(
      {
        startsAt: '2026-10-31',
        endsAt: '2026-11-02',
        allDay: true,
        timezone: 'Asia/Taipei',
      },
      'America/New_York',
    );
    expect(allDayDatesInTaipei).toEqual(['2026-10-31', '2026-11-01', '2026-11-02']);
    expect(allDayDatesInNewYork).toEqual(['2026-10-31', '2026-11-01', '2026-11-02']);

    // 4. Timed events (allDay = false) convert UTC instants into target timezone (Asia/Taipei default)
    // 2026-10-31T15:30:00Z (23:30 Taipei) -> 2026-10-31T17:30:00Z (01:30 Nov 1 Taipei)
    const timedCrossMidnight = {
      startsAt: '2026-10-31T15:30:00.000Z',
      endsAt: '2026-10-31T17:30:00.000Z',
      allDay: false,
      timezone: 'Asia/Taipei',
    };
    expect(resolveEventCalendarDates(timedCrossMidnight, 'Asia/Taipei')).toEqual([
      '2026-10-31',
      '2026-11-01',
    ]);
    expect(resolveEventCalendarDates(timedCrossMidnight, 'UTC')).toEqual(['2026-10-31']);

    // 5. Schema validation rejects out-of-range calendar dates (e.g. 2026-02-29) and enforces allDay vs UTC timestamp format
    expect(LocalDateStringSchema.safeParse('2026-02-29').success).toBe(false);
    expect(LocalDateStringSchema.safeParse('2028-02-29').success).toBe(true);

    expect(
      CreateEventRequestSchema.safeParse({
        scope: 'personal',
        title: '不合法的全天事件（誤傳 UTC 時間戳）',
        startsAt: '2026-10-30T00:00:00.000Z',
        endsAt: '2026-10-30T23:59:59.000Z',
        allDay: true,
      }).success,
    ).toBe(false);

    expect(
      CreateEventRequestSchema.safeParse({
        scope: 'personal',
        title: '不合法的具時間事件（缺少時區偏移）',
        startsAt: '2026-10-30 10:00:00',
        endsAt: '2026-10-30 11:00:00',
        allDay: false,
      }).success,
    ).toBe(false);
  });

  it('renders lunar dates, solar terms, holidays, and provenance/non-goal disclaimers in CalendarWorkspace', () => {
    render(<StatefulCalendarHarness initialToday="2026-10-10" />);

    // 2026-10-10 is Double Ten National Day (國慶日)
    expect(screen.getByTestId('calendar-cell-lunar-2026-10-10').textContent).toBe('國慶日');
    expect(screen.getByTestId('calendar-cell-holiday-badge-2026-10-10').textContent).toBe(
      '休',
    );

    // 2026-10-08 is Cold Dew (寒露) solar term, 2026-10-23 is Frost's Descent (霜降)
    expect(screen.getByTestId('calendar-cell-lunar-2026-10-08').textContent).toBe('寒露');
    expect(screen.getByTestId('calendar-cell-lunar-2026-10-23').textContent).toBe('霜降');

    // Click 2026-10-18 (重陽節: 農曆九月初九)
    fireEvent.click(screen.getByTestId('calendar-cell-2026-10-18'));
    expect(screen.getByTestId('selected-date-lunar-full').textContent).toContain(
      '丙午年九月初九（馬年）',
    );
    expect(screen.getByTestId('selected-date-traditional-festival').textContent).toContain(
      '重陽節',
    );

    // Provenance & non-goal disclaimer is visible and explicitly states no lunar recurring schedule
    expect(screen.getByTestId('calendar-lunar-disclaimer').textContent).toContain(
      '暫不支援農曆每年重複事件排程',
    );
    expect(screen.getByTestId('lunar-provenance-notice').textContent).toContain(
      'lunar-javascript',
    );
  });
});

describe('PR #25 Follow-up Fixes (Space Reset, Today Rollover, Personal-Only Diary Guard)', () => {
  it('Follow-up #1: resets or reconciles calendarNavState.selectedSpace when switching identity, logging out, or leaving a family', () => {
    let state = createInitialCalendarNavigationState('2026-10-30');
    state = selectCalendarSpace(state, { kind: 'family', familyId: 'fam_01' });
    expect(state.selectedSpace).toEqual({ kind: 'family', familyId: 'fam_01' });

    // Reconciling when user is still a member of fam_01 keeps the family space
    const stillMemberState = reconcileCalendarSelectedSpace(state, ['fam_01', 'fam_02']);
    expect(stillMemberState.selectedSpace).toEqual({ kind: 'family', familyId: 'fam_01' });

    // Reconciling after leaving fam_01 (or switching to an identity not in fam_01) resets to personal space
    const afterLeaveState = reconcileCalendarSelectedSpace(state, ['fam_02']);
    expect(afterLeaveState.selectedSpace).toEqual({ kind: 'personal' });

    // Explicit identity switch / logout reset helper
    const afterLogoutState = resetCalendarSelectedSpaceToPersonal(state);
    expect(afterLogoutState.selectedSpace).toEqual({ kind: 'personal' });
  });

  it('Follow-up #2: automatically refreshes todayDate on midnight rollover / window focus / visibilitychange while preserving selectedDate', () => {
    let fakeNow = new Date('2026-10-30T15:00:00.000Z'); // 2026-10-30 23:00 in Asia/Taipei
    render(
      <StatefulCalendarHarness
        initialToday="2026-10-30"
        getNow={() => fakeNow}
      />,
    );

    // User selects a specific historical date (2026-10-12)
    fireEvent.click(screen.getByTestId('calendar-cell-2026-10-12'));
    expect(screen.getByTestId('status-selected-date').textContent).toBe('2026-10-12');
    expect(screen.getByTestId('status-today-date').textContent).toBe('2026-10-30');

    // Clock crosses midnight in Asia/Taipei -> 2026-10-31 00:05 (+08:00)
    fakeNow = new Date('2026-10-30T16:05:00.000Z');
    fireEvent(window, new Event('focus'));

    expect(screen.getByTestId('status-today-date').textContent).toBe('2026-10-31');
    // selectedDate MUST remain 2026-10-12
    expect(screen.getByTestId('status-selected-date').textContent).toBe('2026-10-12');
    expect(
      screen.getByTestId('calendar-cell-2026-10-31').getAttribute('data-is-today'),
    ).toBe('true');

    // Clock advances another day -> 2026-11-01 00:10 (+08:00), triggered via visibilitychange
    fakeNow = new Date('2026-10-31T16:10:00.000Z');
    fireEvent(document, new Event('visibilitychange'));
    expect(screen.getByTestId('status-today-date').textContent).toBe('2026-11-01');
    expect(screen.getByTestId('status-selected-date').textContent).toBe('2026-10-12');

    // Pure helper referential stability when todayDate has not changed
    const navState = createInitialCalendarNavigationState('2026-10-30');
    expect(refreshCalendarTodayDate(navState, '2026-10-30')).toBe(navState);
  });

  it('Follow-up #3: clicking Diary (personalOnly) in family space automatically routes back to personal space with a clear notice, and switching to family space leaves Diary tab', () => {
    render(<StatefulCalendarHarness initialToday="2026-10-30" />);

    // Switch to Family Space
    fireEvent.click(screen.getByTestId('space-switch-family-fam_01'));
    expect(screen.getByTestId('status-selected-space').textContent).toBe(
      '家庭：陳家生活空間',
    );
    // Diary tab displays "(個人)" badge while in family space
    expect(screen.getByTestId('diary-tab-personal-only-badge').textContent).toBe('(個人)');

    // Click Diary tab while in Family Space -> automatically switches back to Personal Space and shows notice
    fireEvent.click(screen.getByTestId('right-tab-diary'));
    expect(screen.getByTestId('status-selected-space').textContent).toBe('個人空間');
    expect(
      screen.getByTestId('diary-auto-switched-personal-notice').textContent,
    ).toContain('已自動為您切換回「個人空間」');

    // Now while on Diary tab, switching to Family Space automatically returns activeTab to 'summary'
    fireEvent.click(screen.getByTestId('space-switch-family-fam_01'));
    expect(screen.getByTestId('status-selected-space').textContent).toBe(
      '家庭：陳家生活空間',
    );
    expect(screen.getByTestId('right-tab-summary').getAttribute('aria-selected')).toBe(
      'true',
    );
  });
});

describe('PR #26 Follow-up Fixes (Lunar 1900–2100 Year Guard / Safe Fallback & Holiday Provenance)', () => {
  it('Follow-up #1: documents official holiday reference URL, dataset version, and lastUpdatedDate in LUNAR_AND_HOLIDAY_PROVENANCE', () => {
    const source = LUNAR_AND_HOLIDAY_PROVENANCE.officialHolidaySource;
    expect(source.referenceUrl).toMatch(/^https:\/\/www\.dgpa\.gov\.tw\//);
    expect(source.datasetVersion).toBe('dgpa-static-summary-2025-2027.v1');
    expect(source.lastUpdatedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(source.maintenanceNote).toContain('不代表完整官方辦公日曆表');
  });

  it('Follow-up #2: safely degrades getLunarDateInfo for out-of-range years (<1900 or >2100) and clamps month navigation within 1900–2100', () => {
    expect(isSolarYearInLunarSupportedRange(1899)).toBe(false);
    expect(isSolarYearInLunarSupportedRange(1900)).toBe(true);
    expect(isSolarYearInLunarSupportedRange(2100)).toBe(true);
    expect(isSolarYearInLunarSupportedRange(2101)).toBe(false);

    // Out-of-range dates never throw and return explicit safe fallback metadata
    const before1900 = getLunarDateInfo('1899-12-31');
    expect(before1900.isOutOfSupportedRange).toBe(true);
    expect(before1900.lunarMonthLabel).toBe('超出農曆範圍');
    expect(before1900.cellDisplayText).toBe('—');

    const after2100Holiday = getLunarDateInfo('2101-01-01');
    expect(after2100Holiday.isOutOfSupportedRange).toBe(true);
    expect(after2100Holiday.officialHoliday).toBe('元旦');
    expect(after2100Holiday.cellDisplayText).toBe('元旦');

    // Boundary month grids (1900-01 has Dec 1899 leading cells; 2100-12 has Jan 2101 trailing cells) never throw
    const grid1900Jan = buildMonthCalendarGrid(
      { year: MIN_CALENDAR_YEAR, month: 1 },
      '1900-01-01',
      '2026-10-30',
    );
    expect(grid1900Jan).toHaveLength(42);
    expect(grid1900Jan[0]?.year).toBe(1899);
    expect(grid1900Jan[0]?.lunar.isOutOfSupportedRange).toBe(true);

    const grid2100Dec = buildMonthCalendarGrid(
      { year: MAX_CALENDAR_YEAR, month: 12 },
      '2100-12-31',
      '2026-10-30',
    );
    expect(grid2100Dec).toHaveLength(42);
    expect(grid2100Dec[41]?.year).toBe(2101);
    expect(grid2100Dec[41]?.lunar.isOutOfSupportedRange).toBe(true);

    // Month navigation guards at 1900-01 and 2100-12
    expect(canNavigateCalendarMonth({ year: 1900, month: 1 }, -1)).toBe(false);
    expect(canNavigateCalendarMonth({ year: 1900, month: 1 }, 1)).toBe(true);
    expect(canNavigateCalendarMonth({ year: 2100, month: 12 }, 1)).toBe(false);
    expect(canNavigateCalendarMonth({ year: 2100, month: 12 }, -1)).toBe(true);

    const atMinState = createInitialCalendarNavigationState('1900-01-15');
    expect(navigateCalendarMonth(atMinState, -1)).toBe(atMinState);

    const atMaxState = createInitialCalendarNavigationState('2100-12-15');
    expect(navigateCalendarMonth(atMaxState, 1)).toBe(atMaxState);
  });
});

describe('Issue #7 Personal & Family Calendar Events CRUD, Event Bars & Detail Inspector', () => {
  const SAMPLE_EVENTS: EventDetail[] = [
    {
      id: 'evt_personal_single',
      calendarId: 'cal_p1',
      scope: 'personal',
      ownerUserId: 'usr_alice',
      familyId: null,
      title: '個人牙醫洗牙',
      description: '攜帶健保卡',
      startsAt: '2026-10-15T01:30:00.000Z', // 09:30 Asia/Taipei
      endsAt: '2026-10-15T02:30:00.000Z', // 10:30 Asia/Taipei
      allDay: false,
      timezone: 'Asia/Taipei',
      sourceMessageId: null,
      sourceStatus: 'none',
      sourceMessage: null,
      createdBy: 'usr_alice',
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
    },
    {
      id: 'evt_personal_multiday_allday',
      calendarId: 'cal_p1',
      scope: 'personal',
      ownerUserId: 'usr_alice',
      familyId: null,
      title: '秋季個人環島休假',
      description: '三天兩夜火車旅行',
      startsAt: '2026-10-20',
      endsAt: '2026-10-22',
      allDay: true,
      timezone: 'Asia/Taipei',
      sourceMessageId: 'msg_accessible_1',
      sourceStatus: 'accessible',
      sourceMessage: {
        id: 'msg_accessible_1',
        roomId: 'room_personal_1',
        roomKind: 'personal',
        familyId: null,
        senderUserId: 'usr_alice',
        body: '十月下旬想安排三天火車環島放鬆一下！',
        localDate: '2026-10-05',
        recordDate: null,
        createdAt: '2026-10-05T08:00:00.000Z',
      },
      createdBy: 'usr_alice',
      createdAt: '2026-10-05T08:05:00.000Z',
      updatedAt: '2026-10-05T08:05:00.000Z',
    },
    {
      id: 'evt_personal_cross_midnight_utc',
      calendarId: 'cal_p1',
      scope: 'personal',
      ownerUserId: 'usr_alice',
      familyId: null,
      title: '跨夜系統維護觀測',
      description: '23:30 開始至隔日 01:30',
      startsAt: '2026-10-28T15:30:00.000Z', // 2026-10-28 23:30 Asia/Taipei
      endsAt: '2026-10-28T17:30:00.000Z', // 2026-10-29 01:30 Asia/Taipei
      allDay: false,
      timezone: 'Asia/Taipei',
      sourceMessageId: 'msg_deleted_1',
      sourceStatus: 'deleted',
      sourceMessage: null,
      createdBy: 'usr_alice',
      createdAt: '2026-10-10T00:00:00.000Z',
      updatedAt: '2026-10-10T00:00:00.000Z',
    },
    {
      id: 'evt_family_shared',
      calendarId: 'cal_f1',
      scope: 'family',
      ownerUserId: null,
      familyId: 'fam_01',
      title: '全家人週末火鍋聚餐',
      description: '記得買豆腐與高麗菜',
      startsAt: '2026-10-15',
      endsAt: '2026-10-15',
      allDay: true,
      timezone: 'Asia/Taipei',
      sourceMessageId: 'msg_inaccessible_1',
      sourceStatus: 'inaccessible',
      sourceMessage: null,
      createdBy: 'usr_bob',
      createdAt: '2026-10-11T00:00:00.000Z',
      updatedAt: '2026-10-11T00:00:00.000Z',
    },
  ];

  it('renders single-day, multi-day (start/middle/end), cross-timezone/cross-midnight, and all-day event bars isolated by selectedSpace', () => {
    render(
      <StatefulCalendarHarness
        initialToday="2026-10-30"
        initialEvents={SAMPLE_EVENTS}
      />,
    );

    // 1. In Personal Space, personal events are rendered and family event is NOT shown
    const singleBar = screen.getByTestId(
      'calendar-cell-event-2026-10-15-evt_personal_single',
    );
    expect(singleBar.textContent).toContain('個人牙醫洗牙');
    expect(singleBar.textContent).toContain('09:30');
    expect(singleBar.getAttribute('data-span-position')).toBe('single');
    expect(
      screen.queryByTestId('calendar-cell-event-2026-10-15-evt_family_shared'),
    ).toBeNull();

    // 2. Multi-day all-day event (2026-10-20 ~ 2026-10-22) spans 3 cells with start/middle/end positions
    const spanStart = screen.getByTestId(
      'calendar-cell-event-2026-10-20-evt_personal_multiday_allday',
    );
    const spanMiddle = screen.getByTestId(
      'calendar-cell-event-2026-10-21-evt_personal_multiday_allday',
    );
    const spanEnd = screen.getByTestId(
      'calendar-cell-event-2026-10-22-evt_personal_multiday_allday',
    );
    expect(spanStart.getAttribute('data-span-position')).toBe('start');
    expect(spanMiddle.getAttribute('data-span-position')).toBe('middle');
    expect(spanEnd.getAttribute('data-span-position')).toBe('end');
    expect(spanStart.textContent).toContain('全天 (1/3)');
    expect(spanMiddle.textContent).toContain('全天 (2/3)');
    expect(spanEnd.textContent).toContain('全天 (3/3)');

    // 3. Cross-midnight timed event in Asia/Taipei (2026-10-28 23:30 -> 2026-10-29 01:30) occupies both Oct 28 and Oct 29
    expect(
      screen.getByTestId(
        'calendar-cell-event-2026-10-28-evt_personal_cross_midnight_utc',
      ),
    ).toBeTruthy();
    expect(
      screen.getByTestId(
        'calendar-cell-event-2026-10-29-evt_personal_cross_midnight_utc',
      ),
    ).toBeTruthy();

    // 4. Switch to Family Space -> Personal events disappear, Family event appears on 2026-10-15
    fireEvent.click(screen.getByTestId('space-switch-family-fam_01'));
    expect(
      screen.queryByTestId('calendar-cell-event-2026-10-15-evt_personal_single'),
    ).toBeNull();
    const familyBar = screen.getByTestId(
      'calendar-cell-event-2026-10-15-evt_family_shared',
    );
    expect(familyBar.textContent).toContain('全家人週末火鍋聚餐');
  });

  it('distinguishes clicking an event bar (opens Event Detail) from clicking a blank date cell (selects date and shows Summary)', () => {
    render(
      <StatefulCalendarHarness
        initialToday="2026-10-30"
        initialEvents={SAMPLE_EVENTS}
      />,
    );

    // Initially no event detail panel is open
    expect(screen.queryByTestId('event-detail-panel')).toBeNull();

    // Clicking the event bar on 2026-10-21 (middle day of 3-day trip)
    const pureAfterEventClick = selectCalendarEventFromCell(
      createInitialCalendarNavigationState('2026-10-30'),
      'evt_personal_multiday_allday',
      '2026-10-21',
    );
    expect(pureAfterEventClick.selectedEventId).toBe('evt_personal_multiday_allday');
    expect(pureAfterEventClick.selectedDate).toBe('2026-10-21');
    expect(
      selectCalendarDateBlank(pureAfterEventClick, '2026-10-15').selectedEventId,
    ).toBeNull();

    fireEvent.click(
      screen.getByTestId(
        'calendar-cell-event-2026-10-21-evt_personal_multiday_allday',
      ),
    );

    // Selected date updates to 2026-10-21 AND Event Detail Panel opens directly
    expect(screen.getByTestId('status-selected-date').textContent).toBe('2026-10-21');
    const detailPanel = screen.getByTestId('event-detail-panel');
    expect(detailPanel.getAttribute('data-event-id')).toBe(
      'evt_personal_multiday_allday',
    );
    expect(screen.getByTestId('event-detail-title').textContent).toBe(
      '秋季個人環島休假',
    );
    expect(screen.getByTestId('event-detail-occupied-dates').textContent).toBe(
      '2026-10-20、2026-10-21、2026-10-22',
    );

    // Now click the blank area of date cell 2026-10-15 -> selects 2026-10-15 and closes Event Detail Panel to show date summary
    fireEvent.click(screen.getByTestId('calendar-cell-2026-10-15'));
    expect(screen.getByTestId('status-selected-date').textContent).toBe('2026-10-15');
    expect(screen.queryByTestId('event-detail-panel')).toBeNull();
    expect(
      screen.getByTestId('summary-event-item-evt_personal_single').textContent,
    ).toContain('個人牙醫洗牙');
  });

  it('collapses overflow events (+N 更多) when a date cell has more than MAX_VISIBLE_EVENTS_PER_CELL events and expands on toggle', () => {
    const busyDayEvents: EventDetail[] = [1, 2, 3, 4].map((num) => ({
      id: `evt_busy_${num}`,
      calendarId: 'cal_p1',
      scope: 'personal',
      ownerUserId: 'usr_alice',
      familyId: null,
      title: `忙碌日行程 #${num}`,
      description: null,
      startsAt: `2026-10-12T0${num}:00:00.000Z`,
      endsAt: `2026-10-12T0${num}:30:00.000Z`,
      allDay: false,
      timezone: 'Asia/Taipei',
      sourceMessageId: null,
      sourceStatus: 'none',
      sourceMessage: null,
      createdBy: 'usr_alice',
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
    }));

    render(
      <StatefulCalendarHarness
        initialToday="2026-10-30"
        initialEvents={busyDayEvents}
      />,
    );

    // By default (MAX_VISIBLE_EVENTS_PER_CELL = 2), only first 2 events are visible in cell 2026-10-12 + "+2 更多" button
    expect(
      screen.getByTestId('calendar-cell-event-2026-10-12-evt_busy_1'),
    ).toBeTruthy();
    expect(
      screen.getByTestId('calendar-cell-event-2026-10-12-evt_busy_2'),
    ).toBeTruthy();
    expect(
      screen.queryByTestId('calendar-cell-event-2026-10-12-evt_busy_3'),
    ).toBeNull();
    expect(
      screen.queryByTestId('calendar-cell-event-2026-10-12-evt_busy_4'),
    ).toBeNull();

    const moreBtn = screen.getByTestId('calendar-cell-more-events-2026-10-12');
    expect(moreBtn.textContent).toBe('+2 更多');

    // Click "+2 更多" to expand all 4 event bars in that cell
    fireEvent.click(moreBtn);
    expect(
      screen.getByTestId('calendar-cell-event-2026-10-12-evt_busy_3'),
    ).toBeTruthy();
    expect(
      screen.getByTestId('calendar-cell-event-2026-10-12-evt_busy_4'),
    ).toBeTruthy();

    // Click "收合 (4 筆)" to collapse back to 2 visible events
    const collapseBtn = screen.getByTestId('calendar-cell-collapse-events-2026-10-12');
    fireEvent.click(collapseBtn);
    expect(
      screen.queryByTestId('calendar-cell-event-2026-10-12-evt_busy_3'),
    ).toBeNull();
  });

  it('supports full Event CRUD (Create, Edit, Delete) and validates event time / title rules in CalendarWorkspace', async () => {
    render(<StatefulCalendarHarness initialToday="2026-10-30" />);

    // Select 2026-10-16 and open Create Event form
    fireEvent.click(screen.getByTestId('calendar-cell-2026-10-16'));
    fireEvent.click(screen.getByTestId('open-create-event-form-btn'));

    const form = screen.getByTestId('event-crud-form');
    expect(form).toBeTruthy();

    // 1. Validation: submitting with empty title fails
    fireEvent.click(screen.getByTestId('event-form-submit-btn'));
    expect(screen.getByTestId('event-form-error').textContent).toContain(
      '事件標題不可為空',
    );

    // 2. Validation: end date earlier than start date fails
    fireEvent.change(screen.getByTestId('event-form-title-input'), {
      target: { value: '跨日露營活動' },
    });
    fireEvent.change(screen.getByTestId('event-form-starts-at-input'), {
      target: { value: '2026-10-18' },
    });
    fireEvent.change(screen.getByTestId('event-form-ends-at-input'), {
      target: { value: '2026-10-16' },
    });
    fireEvent.click(screen.getByTestId('event-form-submit-btn'));
    expect(screen.getByTestId('event-form-error').textContent).toContain(
      '結束日期不可早於開始日期',
    );

    // 3. Fix end date to 2026-10-19 and submit valid multi-day all-day event
    fireEvent.change(screen.getByTestId('event-form-ends-at-input'), {
      target: { value: '2026-10-19' },
    });
    fireEvent.change(screen.getByTestId('event-form-description-input'), {
      target: { value: '攜帶帳篷與睡袋' },
    });
    fireEvent.click(screen.getByTestId('event-form-submit-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('event-detail-panel')).toBeTruthy();
    });
    expect(screen.getByTestId('event-detail-title').textContent).toBe('跨日露營活動');
    expect(screen.getByTestId('event-detail-occupied-dates').textContent).toBe(
      '2026-10-18、2026-10-19',
    );

    // Edit the created event
    fireEvent.click(screen.getByTestId('event-detail-edit-btn'));
    fireEvent.change(screen.getByTestId('event-form-title-input'), {
      target: { value: '跨日露營活動（已確認營位）' },
    });
    fireEvent.click(screen.getByTestId('event-form-submit-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('event-detail-title').textContent).toBe(
        '跨日露營活動（已確認營位）',
      );
    });

    // Delete the event
    fireEvent.click(screen.getByTestId('event-detail-delete-btn'));
    await waitFor(() => {
      expect(screen.queryByTestId('event-detail-panel')).toBeNull();
    });
  });

  it('displays source_message_id statuses (none / accessible / deleted / inaccessible) and jumps to source chat when accessible', () => {
    render(
      <StatefulCalendarHarness
        initialToday="2026-10-30"
        initialEvents={SAMPLE_EVENTS}
      />,
    );

    // 1. Event with `sourceStatus: 'none'` (created directly without source message)
    fireEvent.click(
      screen.getByTestId('calendar-cell-event-2026-10-15-evt_personal_single'),
    );
    expect(screen.getByTestId('event-detail-source-none').textContent).toContain(
      '無來源訊息',
    );

    // 2. Event with `sourceStatus: 'deleted'` (source message soft-deleted, event survives)
    fireEvent.click(
      screen.getByTestId(
        'calendar-cell-event-2026-10-28-evt_personal_cross_midnight_utc',
      ),
    );
    expect(screen.getByTestId('event-detail-source-deleted').textContent).toContain(
      '原訊息已移除',
    );

    // 3. Event with `sourceStatus: 'accessible'` -> shows message preview and jumps to 'mood' tab at message's localDate (2026-10-05)
    fireEvent.click(
      screen.getByTestId(
        'calendar-cell-event-2026-10-20-evt_personal_multiday_allday',
      ),
    );
    expect(
      screen.getByTestId('event-detail-source-accessible').textContent,
    ).toContain('十月下旬想安排三天火車環島放鬆一下！');
    fireEvent.click(screen.getByTestId('event-detail-jump-source-btn'));
    expect(screen.getByTestId('status-selected-date').textContent).toBe('2026-10-05');
    expect(screen.getByTestId('right-tab-mood').getAttribute('aria-selected')).toBe(
      'true',
    );

    // 4. Switch to Family Space and click event with `sourceStatus: 'inaccessible'`
    fireEvent.click(screen.getByTestId('space-switch-family-fam_01'));
    fireEvent.click(
      screen.getByTestId('calendar-cell-event-2026-10-15-evt_family_shared'),
    );
    expect(
      screen.getByTestId('event-detail-source-inaccessible').textContent,
    ).toContain('無權限存取來源訊息');
  });

  it('maps cross-timezone timed events accurately in buildCalendarEventsByDateMap', () => {
    // 2026-10-30T22:00:00Z is:
    // - 2026-10-31 06:00 in Asia/Taipei (+08:00)
    // - 2026-10-30 18:00 in America/New_York (-04:00 EDT)
    const nyEvent: EventDetail = {
      id: 'evt_ny_evening',
      calendarId: 'cal_p1',
      scope: 'personal',
      ownerUserId: 'usr_alice',
      familyId: null,
      title: '紐約晚間視訊會議',
      description: null,
      startsAt: '2026-10-30T22:00:00.000Z',
      endsAt: '2026-10-30T23:00:00.000Z',
      allDay: false,
      timezone: 'America/New_York',
      sourceMessageId: null,
      sourceStatus: 'none',
      sourceMessage: null,
      createdBy: 'usr_alice',
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
    };

    // Using the event's own recorded timezone (America/New_York) -> lands on 2026-10-30 at 18:00
    const mapByEventTz = buildCalendarEventsByDateMap([nyEvent]);
    expect(mapByEventTz['2026-10-30']).toHaveLength(1);
    expect(mapByEventTz['2026-10-30']?.[0]?.timeLabel).toBe('18:00');
    expect(mapByEventTz['2026-10-31']).toBeUndefined();

    // Overriding displayTimezone to Asia/Taipei -> lands on 2026-10-31 at 06:00
    const mapByTaipeiTz = buildCalendarEventsByDateMap([nyEvent], 'Asia/Taipei');
    expect(mapByTaipeiTz['2026-10-31']).toHaveLength(1);
    expect(mapByTaipeiTz['2026-10-31']?.[0]?.timeLabel).toBe('06:00');
  });

  it('PR #27 Blocking 1 regression: prevents previous user personal events leak on identity switch and discards out-of-order stale responses', async () => {
    // 1. Verify StaleRequestGuard aborts and invalidates older tickets when a newer identity/space request begins or invalidates
    const guard = createStaleRequestGuard();
    const userATicket = guard.begin();
    expect(guard.isCurrent(userATicket.requestId)).toBe(true);
    expect(userATicket.signal.aborted).toBe(false);

    // User switches identity to User B -> begins new request (or invalidates first)
    const userBTicket = guard.begin();
    expect(userATicket.signal.aborted).toBe(true);
    expect(guard.isCurrent(userATicket.requestId)).toBe(false);
    expect(guard.isCurrent(userBTicket.requestId)).toBe(true);

    // Simulate out-of-order completion: User B resolves first, then User A's slow request resolves later
    let appliedEvents: string[] = [];
    const applyIfCurrent = (requestId: number, items: string[]) => {
      if (!guard.isCurrent(requestId)) return;
      appliedEvents = items;
    };

    applyIfCurrent(userBTicket.requestId, ['evt_user_b_1']);
    expect(appliedEvents).toEqual(['evt_user_b_1']);

    // Stale User A response arrives after User B -> must be ignored
    applyIfCurrent(userATicket.requestId, ['evt_user_a_secret']);
    expect(appliedEvents).toEqual(['evt_user_b_1']);

    // Explicit invalidate() on logout / identity switch
    guard.invalidate();
    expect(userBTicket.signal.aborted).toBe(true);
    expect(guard.isCurrent(userBTicket.requestId)).toBe(false);

    // 2. Verify CalendarWorkspace immediately isolates personal events by `currentUserId` even if stale events array is still passed
    function IdentitySwitchHarness() {
      const [currentUserId, setCurrentUserId] = useState<string>('usr_alice');
      const [navState, setNavState] = useState<CalendarNavigationState>(() =>
        createInitialCalendarNavigationState('2026-10-30'),
      );
      return (
        <div>
          <button
            type="button"
            data-testid="switch-to-bob-btn"
            onClick={() => setCurrentUserId('usr_bob')}
          >
            切換為 Bob
          </button>
          <CalendarWorkspace
            navState={navState}
            onChangeNavState={setNavState}
            families={MOCK_FAMILIES}
            currentUserId={currentUserId}
            events={SAMPLE_EVENTS}
          />
        </div>
      );
    }

    render(<IdentitySwitchHarness />);
    // Initially as usr_alice: Alice's personal event on 2026-10-15 is visible
    expect(
      screen.getByTestId('calendar-cell-event-2026-10-15-evt_personal_single'),
    ).toBeTruthy();

    // Immediately switch identity to usr_bob -> Alice's personal event must disappear immediately without waiting for network
    fireEvent.click(screen.getByTestId('switch-to-bob-btn'));
    expect(
      screen.queryByTestId('calendar-cell-event-2026-10-15-evt_personal_single'),
    ).toBeNull();
  });

  it('PR #27 Blocking 2 regression: jumping from a personal event derived from a family chat message synchronizes selectedSpace to that family and opens chat tab', () => {
    const crossSpaceEvents: EventDetail[] = [
      {
        id: 'evt_personal_from_family_chat',
        calendarId: 'cal_p1',
        scope: 'personal',
        ownerUserId: 'usr_alice',
        familyId: null,
        title: '從家庭群組轉存的個人提醒',
        description: '記得買牛奶回家',
        startsAt: '2026-10-18',
        endsAt: '2026-10-18',
        allDay: true,
        timezone: 'Asia/Taipei',
        sourceMessageId: 'msg_fam_chat_99',
        sourceStatus: 'accessible',
        sourceMessage: {
          id: 'msg_fam_chat_99',
          roomId: 'room_fam_01',
          roomKind: 'family',
          familyId: 'fam_01',
          senderUserId: 'usr_bob',
          body: '下班順路買兩瓶鮮奶喔！',
          localDate: '2026-10-12',
          recordDate: null,
          createdAt: '2026-10-12T09:30:00.000Z',
        },
        createdBy: 'usr_alice',
        createdAt: '2026-10-12T10:00:00.000Z',
        updatedAt: '2026-10-12T10:00:00.000Z',
      },
      {
        id: 'evt_family_from_personal_mood',
        calendarId: 'cal_fam_01',
        scope: 'family',
        ownerUserId: null,
        familyId: 'fam_01',
        title: '從個人心情轉存的家庭聚會',
        description: null,
        startsAt: '2026-10-25',
        endsAt: '2026-10-25',
        allDay: true,
        timezone: 'Asia/Taipei',
        sourceMessageId: 'msg_personal_mood_77',
        sourceStatus: 'accessible',
        sourceMessage: {
          id: 'msg_personal_mood_77',
          roomId: 'room_personal_alice',
          roomKind: 'personal',
          familyId: null,
          senderUserId: 'usr_alice',
          body: '月底帶全家人去吃火鍋',
          localDate: '2026-10-08',
          recordDate: null,
          createdAt: '2026-10-08T04:00:00.000Z',
        },
        createdBy: 'usr_alice',
        createdAt: '2026-10-08T05:00:00.000Z',
        updatedAt: '2026-10-08T05:00:00.000Z',
      },
    ];

    render(
      <StatefulCalendarHarness
        initialToday="2026-10-30"
        initialEvents={crossSpaceEvents}
      />,
    );

    // Initially in Personal Space (`個人空間`)
    expect(screen.getByTestId('status-selected-space').textContent).toBe('個人空間');

    // Click the personal event on 2026-10-18 that originated from a family chat message (`fam_01`)
    fireEvent.click(
      screen.getByTestId(
        'calendar-cell-event-2026-10-18-evt_personal_from_family_chat',
      ),
    );
    expect(
      screen.getByTestId('event-detail-source-accessible').textContent,
    ).toContain('下班順路買兩瓶鮮奶喔！');

    // Click "查看來源聊天 ➔"
    fireEvent.click(screen.getByTestId('event-detail-jump-source-btn'));

    // Must synchronize selectedSpace to `家庭：陳家生活空間` (`fam_01`), selectedDate to `2026-10-12`, and activeTab to `chat`
    expect(screen.getByTestId('status-selected-space').textContent).toBe(
      '家庭：陳家生活空間',
    );
    expect(screen.getByTestId('status-selected-date').textContent).toBe('2026-10-12');
    expect(screen.getByTestId('right-tab-chat').getAttribute('aria-selected')).toBe(
      'true',
    );
    const chatPanel = screen.getByTestId('right-tabpanel-chat');
    expect(chatPanel.textContent).toContain('目前顯示「陳家生活空間」的唯一家庭聊天室');
    expect(
      screen
        .getByTestId('chat-panel-source-message-locator')
        .getAttribute('data-source-message-id'),
    ).toBe('msg_fam_chat_99');

    // Now test the reverse direction: in Family Space (`fam_01`), click the family event on 2026-10-25 derived from a personal mood message
    fireEvent.click(
      screen.getByTestId(
        'calendar-cell-event-2026-10-25-evt_family_from_personal_mood',
      ),
    );
    fireEvent.click(screen.getByTestId('event-detail-jump-source-btn'));

    // Must synchronize selectedSpace back to `個人空間`, selectedDate to `2026-10-08`, and activeTab to `mood`
    expect(screen.getByTestId('status-selected-space').textContent).toBe('個人空間');
    expect(screen.getByTestId('status-selected-date').textContent).toBe('2026-10-08');
    expect(screen.getByTestId('right-tab-mood').getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(
      screen
        .getByTestId('chat-panel-source-message-locator')
        .getAttribute('data-source-message-id'),
    ).toBe('msg_personal_mood_77');

    // Also verify deleted or inaccessible source messages do not navigate in `navigateCalendarToEventSourceMessage`
    const initialState = createInitialCalendarNavigationState('2026-10-30');
    expect(
      navigateCalendarToEventSourceMessage(
        initialState,
        {
          sourceStatus: 'deleted',
          sourceMessage: null,
        },
        ['fam_01'],
      ),
    ).toBe(initialState);
    expect(
      navigateCalendarToEventSourceMessage(
        initialState,
        {
          sourceStatus: 'accessible',
          sourceMessage: {
            id: 'msg_unauth_fam',
            roomId: 'room_fam_unauth',
            roomKind: 'family',
            familyId: 'fam_unauth',
            localDate: '2026-10-12',
          },
        },
        ['fam_01'],
      ),
    ).toBe(initialState);
  });

  it('PR #27 Non-blocking 2 regression: rejects nonexistent DST spring-forward wall times and deterministically disambiguates repeated fall-back wall times', () => {
    // 1. Nonexistent DST spring-forward gap in America/New_York: 2026-03-08 02:30 does not exist (clocks jump 02:00 EST -> 03:00 EDT)
    expect(() =>
      convertLocalDateTimeInTimezoneToUtcIso(
        '2026-03-08T02:30',
        'America/New_York',
      ),
    ).toThrow(/因日光節約時間 \(DST\) 跳轉而不存在/);

    // 2. Repeated DST fall-back wall time in America/New_York: 2026-11-01 01:30 occurs twice (01:30 EDT = 05:30Z, 01:30 EST = 06:30Z)
    expect(
      convertLocalDateTimeInTimezoneToUtcIso(
        '2026-11-01T01:30',
        'America/New_York',
      ),
    ).toBe('2026-11-01T05:30:00.000Z');
    expect(
      convertLocalDateTimeInTimezoneToUtcIso(
        '2026-11-01T01:30',
        'America/New_York',
        { disambiguation: 'earlier' },
      ),
    ).toBe('2026-11-01T05:30:00.000Z');
    expect(
      convertLocalDateTimeInTimezoneToUtcIso(
        '2026-11-01T01:30',
        'America/New_York',
        { disambiguation: 'later' },
      ),
    ).toBe('2026-11-01T06:30:00.000Z');
    expect(() =>
      convertLocalDateTimeInTimezoneToUtcIso(
        '2026-11-01T01:30',
        'America/New_York',
        { disambiguation: 'reject' },
      ),
    ).toThrow(/因日光節約時間 \(DST\) 回撥而重複出現兩次/);
  });
});
