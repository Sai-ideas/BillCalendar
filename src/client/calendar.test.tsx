// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  RIGHT_PANEL_TABS,
  buildMonthCalendarGrid,
  createInitialCalendarNavigationState,
  deriveSelectedDateForMonth,
  getTodayLocalDate,
  navigateCalendarMonth,
  selectCalendarDateBlank,
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
}: {
  initialToday?: string;
  families?: FamilySummary[];
}) {
  const [navState, setNavState] = useState<CalendarNavigationState>(() =>
    createInitialCalendarNavigationState(initialToday),
  );
  return (
    <CalendarWorkspace
      navState={navState}
      onChangeNavState={setNavState}
      families={families}
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
        expect(tabBtn.textContent).toBe(tab.label);
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
