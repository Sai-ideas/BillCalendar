// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ALL_24_SOLAR_TERMS_ZH_TW,
  CreateEventRequestSchema,
  LUNAR_AND_HOLIDAY_PROVENANCE,
  LocalDateStringSchema,
  RIGHT_PANEL_TABS,
  buildMonthCalendarGrid,
  createInitialCalendarNavigationState,
  deriveSelectedDateForMonth,
  formatInstantToLocalDate,
  getLunarDateInfo,
  getTodayLocalDate,
  navigateCalendarMonth,
  reconcileCalendarSelectedSpace,
  refreshCalendarTodayDate,
  resetCalendarSelectedSpaceToPersonal,
  resolveEventCalendarDates,
  selectCalendarDateBlank,
  selectCalendarSpace,
  switchRightPanelTab,
  type CalendarNavigationState,
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
}: {
  initialToday?: string;
  families?: FamilySummary[];
  getNow?: () => Date;
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
