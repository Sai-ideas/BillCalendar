import { useCallback, useEffect, useMemo } from 'react';
import {
  DEFAULT_TIMEZONE,
  LUNAR_AND_HOLIDAY_PROVENANCE,
  RIGHT_PANEL_TABS,
  WEEKDAY_LABELS_ZH,
  buildMonthCalendarGrid,
  formatYearMonthLabel,
  getLunarDateInfo,
  getTodayLocalDate,
  jumpCalendarToDate,
  navigateCalendarMonth,
  refreshCalendarTodayDate,
  selectCalendarDateBlank,
  selectCalendarSpace,
  switchRightPanelTab,
  type CalendarNavigationState,
  type FamilySummary,
  type RightPanelTab,
  type SelectedSpace,
} from '../../shared';

export interface CalendarWorkspaceProps {
  navState: CalendarNavigationState;
  onChangeNavState: (next: CalendarNavigationState) => void;
  families: FamilySummary[];
  onSelectFamilySpace?: (familyId: string) => void;
  timezone?: string;
  getNow?: () => Date;
}

export function CalendarWorkspace({
  navState,
  onChangeNavState,
  families,
  onSelectFamilySpace,
  timezone = DEFAULT_TIMEZONE,
  getNow,
}: CalendarWorkspaceProps) {
  const {
    todayDate,
    selectedDate,
    displayedMonth,
    activeTab,
    selectedSpace,
    mobileView,
    diaryAutoSwitchedToPersonal,
  } = navState;

  // Automatically refresh `todayDate` on midnight rollover, window focus, or visibilitychange (PR #25 Follow-up #2)
  const syncTodayDateIfNeeded = useCallback(() => {
    const now = getNow ? getNow() : new Date();
    const latestToday = getTodayLocalDate(now, timezone);
    if (latestToday !== navState.todayDate) {
      onChangeNavState(refreshCalendarTodayDate(navState, latestToday));
    }
  }, [getNow, timezone, navState, onChangeNavState]);

  useEffect(() => {
    const handleFocus = () => {
      syncTodayDateIfNeeded();
    };
    const handleVisibilityChange = () => {
      if (typeof document === 'undefined' || document.visibilityState !== 'hidden') {
        syncTodayDateIfNeeded();
      }
    };

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    const intervalId = window.setInterval(syncTodayDateIfNeeded, 30_000);

    return () => {
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.clearInterval(intervalId);
    };
  }, [syncTodayDateIfNeeded]);

  const gridCells = useMemo(
    () => buildMonthCalendarGrid(displayedMonth, selectedDate, todayDate),
    [displayedMonth, selectedDate, todayDate],
  );

  const selectedDateLunar = useMemo(
    () => getLunarDateInfo(selectedDate),
    [selectedDate],
  );

  const selectedFamily = useMemo(() => {
    if (selectedSpace.kind !== 'family') return null;
    return families.find((f) => f.id === selectedSpace.familyId) ?? null;
  }, [families, selectedSpace]);

  const currentSpaceLabel =
    selectedSpace.kind === 'personal'
      ? '個人空間'
      : selectedFamily
        ? `家庭：${selectedFamily.name}`
        : '家庭空間';

  const handleSelectSpace = (space: SelectedSpace) => {
    onChangeNavState(selectCalendarSpace(navState, space));
    if (space.kind === 'family' && onSelectFamilySpace) {
      onSelectFamilySpace(space.familyId);
    }
  };

  const handlePrevMonth = () => {
    onChangeNavState(navigateCalendarMonth(navState, -1));
  };

  const handleNextMonth = () => {
    onChangeNavState(navigateCalendarMonth(navState, 1));
  };

  const handleJumpToday = () => {
    const now = getNow ? getNow() : new Date();
    const latestToday = getTodayLocalDate(now, timezone);
    const refreshed = refreshCalendarTodayDate(navState, latestToday);
    onChangeNavState(jumpCalendarToDate(refreshed, latestToday));
  };

  const handleCellBlankClick = (dateStr: string, openMobilePanel: boolean) => {
    onChangeNavState(
      selectCalendarDateBlank(navState, dateStr, { openMobilePanel }),
    );
  };

  const handleTabClick = (tab: RightPanelTab) => {
    onChangeNavState({
      ...switchRightPanelTab(navState, tab),
      mobileView: 'panel',
    });
  };

  const activeTabMeta =
    RIGHT_PANEL_TABS.find((t) => t.id === activeTab) ?? RIGHT_PANEL_TABS[0];

  return (
    <section
      aria-label="月曆與生活紀錄工作區"
      className="rounded-xl border border-slate-200 bg-white shadow-xs overflow-hidden"
    >
      {/* Top Bar: Space Switcher, Month Navigation, Today vs Selected Date Status */}
      <div className="border-b border-slate-200 bg-slate-50/80 px-4 py-3 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Global Space Switcher (UX.md: 頂端空間切換：個人或家庭) */}
          <div
            role="group"
            aria-label="空間切換器"
            className="flex flex-wrap items-center gap-1.5"
          >
            <span className="mr-1 text-xs font-semibold text-slate-500">
              目前空間：
            </span>
            <button
              type="button"
              data-testid="space-switch-personal"
              aria-pressed={selectedSpace.kind === 'personal'}
              onClick={() => handleSelectSpace({ kind: 'personal' })}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                selectedSpace.kind === 'personal'
                  ? 'bg-indigo-600 text-white shadow-2xs'
                  : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
              }`}
            >
              個人空間
            </button>

            {families.map((fam) => {
              const isSelected =
                selectedSpace.kind === 'family' &&
                selectedSpace.familyId === fam.id;
              return (
                <button
                  key={fam.id}
                  type="button"
                  data-testid={`space-switch-family-${fam.id}`}
                  aria-pressed={isSelected}
                  onClick={() =>
                    handleSelectSpace({ kind: 'family', familyId: fam.id })
                  }
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                    isSelected
                      ? 'bg-indigo-600 text-white shadow-2xs'
                      : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  家庭：{fam.name}
                </button>
              );
            })}
          </div>

          {/* Month Navigation Controls */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center rounded-lg border border-slate-300 bg-white shadow-2xs">
              <button
                type="button"
                data-testid="calendar-prev-month"
                aria-label="上個月"
                onClick={handlePrevMonth}
                className="px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-l-lg"
              >
                ◀ 上月
              </button>
              <span
                data-testid="calendar-current-month-label"
                className="border-x border-slate-200 px-3.5 py-1.5 text-sm font-bold text-slate-900 min-w-[116px] text-center"
              >
                {formatYearMonthLabel(displayedMonth)}
              </span>
              <button
                type="button"
                data-testid="calendar-next-month"
                aria-label="下個月"
                onClick={handleNextMonth}
                className="px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-r-lg"
              >
                下月 ▶
              </button>
            </div>

            <button
              type="button"
              data-testid="calendar-jump-today"
              onClick={handleJumpToday}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
            >
              回到今日
            </button>
          </div>
        </div>

        {/* Status Bar: Explicitly separating selectedDate vs todayDate */}
        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200/80 pt-2 text-xs text-slate-600">
          <div className="flex flex-wrap items-center gap-3">
            <span>
              今日 (<code>today</code>)：
              <strong
                data-testid="status-today-date"
                className="ml-1 font-mono font-semibold text-emerald-700"
              >
                {todayDate}
              </strong>
            </span>
            <span className="text-slate-300">|</span>
            <span>
              選取日期 (<code>selectedDate</code>)：
              <strong
                data-testid="status-selected-date"
                className="ml-1 font-mono font-semibold text-indigo-700"
              >
                {selectedDate}
              </strong>
              <span
                data-testid="status-selected-lunar"
                className="ml-1.5 text-[11px] font-medium text-slate-500"
              >
                ({selectedDateLunar.lunarMonthLabel}
                {selectedDateLunar.lunarDayLabel})
              </span>
            </span>
            <span className="text-slate-300">|</span>
            <span>
              空間範圍 (<code>selectedSpace</code>)：
              <strong
                data-testid="status-selected-space"
                className="ml-1 font-semibold text-slate-900"
              >
                {currentSpaceLabel}
              </strong>
            </span>
          </div>

          {/* Mobile Viewport Switcher (UX.md: 手機版優先月曆，右面板改分頁或底部 sheet，維持日期選擇) */}
          <div
            role="group"
            aria-label="行動版檢視切換"
            className="flex items-center gap-1 lg:hidden"
          >
            <button
              type="button"
              data-testid="mobile-view-calendar-btn"
              aria-pressed={mobileView === 'calendar'}
              onClick={() =>
                onChangeNavState({ ...navState, mobileView: 'calendar' })
              }
              className={`rounded-md px-2.5 py-1 text-xs font-semibold ${
                mobileView === 'calendar'
                  ? 'bg-slate-900 text-white'
                  : 'border border-slate-300 bg-white text-slate-700'
              }`}
            >
              📅 月曆視圖
            </button>
            <button
              type="button"
              data-testid="mobile-view-panel-btn"
              aria-pressed={mobileView === 'panel'}
              onClick={() =>
                onChangeNavState({ ...navState, mobileView: 'panel' })
              }
              className={`rounded-md px-2.5 py-1 text-xs font-semibold ${
                mobileView === 'panel'
                  ? 'bg-slate-900 text-white'
                  : 'border border-slate-300 bg-white text-slate-700'
              }`}
            >
              📑 右側分頁 ({activeTabMeta.label})
            </button>
          </div>
        </div>
      </div>

      {/* Desktop 62% / 38% Split & Mobile Responsive Container */}
      <div className="grid grid-cols-1 lg:grid-cols-12">
        {/* Left 60-65% on Desktop (7 of 12 cols = 58.3%) */}
        <div
          data-testid="calendar-left-pane"
          className={`border-b border-slate-200 p-4 sm:p-5 lg:col-span-7 lg:border-r lg:border-b-0 ${
            mobileView === 'panel' ? 'hidden lg:block' : 'block'
          }`}
        >
          {/* Weekday Headers */}
          <div className="grid grid-cols-7 gap-1 border-b border-slate-200 pb-2 text-center text-xs font-bold">
            {WEEKDAY_LABELS_ZH.map((label, idx) => (
              <div
                key={label}
                className={
                  idx === 0
                    ? 'text-rose-600'
                    : idx === 6
                      ? 'text-indigo-600'
                      : 'text-slate-600'
                }
              >
                週{label}
              </div>
            ))}
          </div>

          {/* 6-week High-Density Month Grid (Solar + Lunar + 24 Solar Terms + Holidays) */}
          <div
            role="grid"
            aria-label={`${formatYearMonthLabel(displayedMonth)} 月曆格`}
            className="mt-2 grid grid-cols-7 gap-1.5"
          >
            {gridCells.map((cell) => {
              const {
                dateStr,
                day,
                isCurrentMonth,
                isToday,
                isSelected,
                dayOfWeek,
                lunar,
              } = cell;

              const lunarTextClass =
                lunar.cellHighlightKind === 'festival'
                  ? isCurrentMonth
                    ? 'font-bold text-rose-600'
                    : 'font-semibold text-rose-400'
                  : lunar.cellHighlightKind === 'solar_term'
                    ? isCurrentMonth
                      ? 'font-bold text-teal-700'
                      : 'font-semibold text-teal-500'
                    : lunar.cellHighlightKind === 'lunar_first_day'
                      ? isCurrentMonth
                        ? 'font-bold text-indigo-700'
                        : 'font-semibold text-indigo-400'
                      : isCurrentMonth
                        ? 'text-slate-500'
                        : 'text-slate-400';

              return (
                <button
                  key={dateStr}
                  type="button"
                  data-testid={`calendar-cell-${dateStr}`}
                  data-current-month={isCurrentMonth ? 'true' : 'false'}
                  data-is-today={isToday ? 'true' : 'false'}
                  data-is-selected={isSelected ? 'true' : 'false'}
                  data-is-leap-month={lunar.isLeapMonth ? 'true' : 'false'}
                  aria-label={`選擇日期 ${dateStr} 農曆${lunar.lunarMonthLabel}${lunar.lunarDayLabel}${lunar.cellDisplayText !== lunar.lunarDayLabel ? ` (${lunar.cellDisplayText})` : ''}${isToday ? ' (今日)' : ''}${isSelected ? ' (已選取)' : ''}`}
                  aria-selected={isSelected}
                  onClick={() => handleCellBlankClick(dateStr, false)}
                  className={`group relative flex min-h-[78px] flex-col items-start justify-between rounded-lg border p-1.5 text-left transition sm:min-h-[90px] sm:p-2 ${
                    isSelected
                      ? 'border-indigo-600 bg-indigo-50/75 ring-2 ring-indigo-600/30'
                      : isToday
                        ? 'border-emerald-500 bg-emerald-50/40 hover:border-emerald-600'
                        : isCurrentMonth
                          ? 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/70'
                          : 'border-slate-100 bg-slate-50/60 text-slate-400 hover:border-slate-200'
                  }`}
                >
                  {/* Top Row of Cell: Solar Day + Holiday/Today Badges */}
                  <div className="flex w-full items-center justify-between gap-0.5">
                    <span
                      className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                        isSelected
                          ? 'bg-indigo-600 text-white'
                          : isToday
                            ? 'bg-emerald-600 text-white'
                            : !isCurrentMonth
                              ? 'text-slate-400'
                              : dayOfWeek === 0 || lunar.isHolidayDayOff
                                ? 'text-rose-600'
                                : dayOfWeek === 6
                                  ? 'text-indigo-600'
                                  : 'text-slate-800'
                      }`}
                    >
                      {day}
                    </span>

                    <div className="flex items-center gap-0.5">
                      {lunar.isHolidayDayOff && isCurrentMonth && (
                        <span
                          data-testid={`calendar-cell-holiday-badge-${dateStr}`}
                          className="rounded-xs bg-rose-100 px-1 py-0.5 text-[9px] font-bold text-rose-700"
                        >
                          休
                        </span>
                      )}
                      {isToday && (
                        <span className="rounded-xs bg-emerald-100 px-1 py-0.5 text-[10px] font-bold text-emerald-800">
                          今日
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Middle/Bottom Slot: Lunar Date / Leap Month / 24 Solar Term / Festival (Issue #6) */}
                  <div className="mt-1 w-full space-y-0.5">
                    <div className="flex items-center justify-between gap-1">
                      <span
                        data-testid={`calendar-cell-lunar-${dateStr}`}
                        data-lunar-highlight={lunar.cellHighlightKind}
                        className={`truncate text-[11px] leading-tight ${lunarTextClass}`}
                      >
                        {lunar.cellDisplayText}
                      </span>
                      {lunar.isLeapMonth && lunar.lunarDay !== 1 && (
                        <span
                          data-testid={`calendar-cell-leap-tag-${dateStr}`}
                          className="shrink-0 rounded-xs bg-amber-100 px-1 py-0.2 text-[9px] font-semibold text-amber-800"
                        >
                          閏
                        </span>
                      )}
                    </div>
                    <div className="truncate text-[10px] text-slate-400">
                      {lunar.solarTerm && lunar.cellDisplayText !== lunar.solarTerm
                        ? `節氣：${lunar.solarTerm}`
                        : `${lunar.lunarMonthLabel}${lunar.lunarDayLabel}`}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Lunar & Holiday Disclaimer Footer under Month Grid (Review D5 / UX.md) */}
          <div
            data-testid="calendar-lunar-disclaimer"
            className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200/80 bg-slate-50 px-3 py-2 text-[11px] text-slate-600"
          >
            <span>
              🌕 <strong>農曆與節慶顯示：</strong>
              {LUNAR_AND_HOLIDAY_PROVENANCE.officialHolidaySource.disclaimer}
            </span>
            <span className="font-medium text-amber-800">
              ⚠️ {LUNAR_AND_HOLIDAY_PROVENANCE.mvpScopeBoundary.nonGoalNotice}
            </span>
          </div>

          {/* Mobile Quick Bar under calendar to open selected date details on small screens */}
          <div className="mt-3 flex items-center justify-between rounded-lg border border-indigo-100 bg-indigo-50/70 px-3 py-2 text-xs lg:hidden">
            <div>
              <span className="text-slate-600">已選日期：</span>
              <strong className="font-mono font-bold text-indigo-900">
                {selectedDate}
              </strong>
              <span className="ml-1 text-[11px] text-indigo-700">
                ({selectedDateLunar.lunarMonthLabel}
                {selectedDateLunar.lunarDayLabel})
              </span>
            </div>
            <button
              type="button"
              data-testid="mobile-open-selected-summary"
              onClick={() => handleCellBlankClick(selectedDate, true)}
              className="rounded-md bg-indigo-600 px-3 py-1 font-semibold text-white hover:bg-indigo-700"
            >
              開啟當日{activeTabMeta.label} ➔
            </button>
          </div>
        </div>

        {/* Right 35-40% on Desktop (5 of 12 cols = 41.6%): 6 Function Tabs */}
        <div
          data-testid="calendar-right-pane"
          className={`flex flex-col justify-between bg-slate-50/40 p-4 sm:p-5 lg:col-span-5 ${
            mobileView === 'calendar' ? 'hidden lg:flex' : 'flex'
          }`}
        >
          <div>
            {/* Mobile back-to-calendar button */}
            <div className="mb-3 flex items-center justify-between lg:hidden">
              <button
                type="button"
                data-testid="mobile-back-to-calendar"
                onClick={() =>
                  onChangeNavState({ ...navState, mobileView: 'calendar' })
                }
                className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700"
              >
                ◀ 返回月曆（保持選日 {selectedDate}）
              </button>
              <span className="font-mono text-xs font-semibold text-indigo-700">
                {selectedDate}
              </span>
            </div>

            {/* 6 Right-Hand Function Tabs: 摘要、心情、聊天、記帳、待辦、日記 */}
            <div
              role="tablist"
              aria-label="右側功能分頁"
              className="grid grid-cols-3 gap-1.5 rounded-xl border border-slate-200 bg-slate-100/80 p-1.5 sm:grid-cols-6 lg:grid-cols-3 xl:grid-cols-6"
            >
              {RIGHT_PANEL_TABS.map((tab) => {
                const isActive = activeTab === tab.id;
                const isPersonalOnlyInFamily =
                  Boolean(tab.personalOnly) && selectedSpace.kind === 'family';
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    data-testid={`right-tab-${tab.id}`}
                    data-personal-only={tab.personalOnly ? 'true' : 'false'}
                    aria-selected={isActive}
                    title={
                      isPersonalOnlyInFamily
                        ? '私人日記僅限個人空間存取，點擊將自動切回個人空間'
                        : tab.shortDescription
                    }
                    onClick={() => handleTabClick(tab.id)}
                    className={`rounded-lg px-2 py-2 text-xs font-bold transition ${
                      isActive
                        ? 'bg-indigo-600 text-white shadow-2xs'
                        : isPersonalOnlyInFamily
                          ? 'border border-dashed border-indigo-200 bg-white/60 text-indigo-800 hover:bg-indigo-50'
                          : 'bg-white/70 text-slate-700 hover:bg-white hover:text-slate-900'
                    }`}
                  >
                    <span>{tab.label}</span>
                    {isPersonalOnlyInFamily && (
                      <span
                        data-testid="diary-tab-personal-only-badge"
                        className="ml-0.5 text-[10px] font-normal text-indigo-600"
                      >
                        (個人)
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Selected Date Context Banner inside Right Panel */}
            <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4 shadow-2xs">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                <div>
                  <span className="text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
                    目前檢視分頁：{activeTabMeta.label}
                  </span>
                  <h3
                    data-testid="right-panel-heading"
                    className="mt-0.5 text-base font-bold text-slate-900"
                  >
                    {selectedDate} — {activeTabMeta.label}
                  </h3>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-600">
                    <span
                      data-testid="selected-date-lunar-full"
                      className="font-medium text-slate-700"
                    >
                      農曆：{selectedDateLunar.fullLunarLabel}
                    </span>
                    {selectedDateLunar.isLeapMonth && (
                      <span
                        data-testid="selected-date-leap-badge"
                        className="rounded-xs bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-900"
                      >
                        農曆閏月
                      </span>
                    )}
                    {selectedDateLunar.solarTerm && (
                      <span
                        data-testid="selected-date-solar-term"
                        className="rounded-xs bg-teal-100 px-1.5 py-0.5 text-[10px] font-bold text-teal-800"
                      >
                        節氣：{selectedDateLunar.solarTerm}
                      </span>
                    )}
                    {selectedDateLunar.traditionalFestival && (
                      <span
                        data-testid="selected-date-traditional-festival"
                        className="rounded-xs bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-800"
                      >
                        傳統節日：{selectedDateLunar.traditionalFestival}
                      </span>
                    )}
                    {selectedDateLunar.officialHoliday && (
                      <span
                        data-testid="selected-date-official-holiday"
                        className="rounded-xs bg-rose-50 border border-rose-200 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700"
                      >
                        國定假日參考：{selectedDateLunar.officialHoliday}
                      </span>
                    )}
                  </div>
                </div>
                <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-800">
                  {currentSpaceLabel}
                </span>
              </div>

              <p className="mt-2.5 text-xs text-slate-600">
                {activeTabMeta.shortDescription}
              </p>

              {/* Tab Content View */}
              <div
                role="tabpanel"
                data-testid={`right-tabpanel-${activeTab}`}
                className="mt-4 space-y-3"
              >
                {activeTab === 'summary' && (
                  <div className="space-y-3">
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 text-xs text-slate-700">
                      <p className="font-semibold text-slate-900">
                        📌 {selectedDate} 單日摘要（{currentSpaceLabel}）
                      </p>
                      <p className="mt-1 text-slate-600">
                        農曆對照：
                        <strong className="text-slate-900">
                          {selectedDateLunar.fullLunarLabel}
                        </strong>
                        （該農曆月共 {selectedDateLunar.lunarMonthDayCount} 日
                        {selectedDateLunar.leapMonthOfYear
                          ? `，本農曆年含閏${selectedDateLunar.leapMonthOfYear}月`
                          : ''}
                        ）。點擊左側月曆任意日期空白處，即更新全域{' '}
                        <code>selectedDate</code> 並開啟本摘要面板；
                        <code>selectedDate</code> ({selectedDate}) 與系統今日{' '}
                        <code>today</code> ({todayDate}) 狀態彼此獨立。
                      </p>
                    </div>

                    {/* Issue #6 Date/Timezone Strategy & Lunar Data Provenance Card */}
                    <div
                      data-testid="timezone-and-lunar-policy-card"
                      className="rounded-lg border border-indigo-100 bg-indigo-50/40 p-3.5 text-xs text-slate-700 space-y-1.5"
                    >
                      <p className="font-semibold text-indigo-950">
                        🕒 日期時區規則與農曆資料來源說明（Issue #6 / D4 & D5）
                      </p>
                      <ul className="list-disc pl-4 space-y-1 text-[11px] text-slate-600">
                        <li>
                          <strong>純日期欄位（YYYY-MM-DD）：</strong>全天事件（
                          <code>all_day = true</code>）、待辦截止日（
                          <code>due_date</code>）、記帳日（
                          <code>occurred_on</code>）與私人日記日（
                          <code>entry_date</code>）均以純日期保存，不做 UTC 換日偏移。
                        </li>
                        <li>
                          <strong>具時間事件與訊息時間戳：</strong>一律以 UTC ISO 8601
                          保存瞬間，並依空間／事件時區（預設{' '}
                          <code>{timezone}</code>）換算所屬月曆日期格。
                        </li>
                        <li data-testid="lunar-provenance-notice">
                          <strong>資料來源與範圍限制：</strong>農曆與 24 節氣採用離線演算法庫{' '}
                          <code>
                            {LUNAR_AND_HOLIDAY_PROVENANCE.lunarEngine.packageName} v
                            {LUNAR_AND_HOLIDAY_PROVENANCE.lunarEngine.version} (
                            {LUNAR_AND_HOLIDAY_PROVENANCE.lunarEngine.license})
                          </code>
                          ；國定假日採{' '}
                          {LUNAR_AND_HOLIDAY_PROVENANCE.officialHolidaySource.authority}
                          。{LUNAR_AND_HOLIDAY_PROVENANCE.mvpScopeBoundary.nonGoalNotice}
                        </li>
                      </ul>
                    </div>

                    {/* Quick Module Entry Buttons */}
                    <div>
                      <h4 className="text-xs font-semibold text-slate-500">
                        快速前往當日各功能分頁（切換分頁不會改變選取日{' '}
                        <code>{selectedDate}</code>）：
                      </h4>
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        {RIGHT_PANEL_TABS.filter((t) => t.id !== 'summary').map(
                          (tab) => {
                            const isHiddenInFamily =
                              tab.personalOnly &&
                              selectedSpace.kind === 'family';
                            return (
                              <button
                                key={tab.id}
                                type="button"
                                data-testid={`summary-entry-${tab.id}`}
                                onClick={() => handleTabClick(tab.id)}
                                className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-xs font-medium text-slate-800 hover:border-indigo-300 hover:bg-indigo-50/40"
                              >
                                <span className="font-semibold">
                                  前往「{tab.label}」
                                </span>
                                <span className="text-[11px] text-slate-400">
                                  {isHiddenInFamily
                                    ? '切回個人空間開啟 ➔'
                                    : '開啟 ➔'}
                                </span>
                              </button>
                            );
                          },
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === 'mood' && (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs text-slate-700">
                    <p className="font-semibold text-slate-900">
                      💬 個人心情聊天室（定位日期：{selectedDate}）
                    </p>
                    <p className="mt-1 text-slate-600">
                      「心情」即個人專屬聊天室（<code>kind = 'personal'</code>
                      ），支援文字、emoji、快速筆記與外部 HTTPS 圖片連結，並將在
                      Issue #9 / #10 接入時間軸定位與上下文捲動。
                    </p>
                  </div>
                )}

                {activeTab === 'chat' && (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs text-slate-700">
                    <p className="font-semibold text-slate-900">
                      🏠 家庭聊天室（定位日期：{selectedDate}）
                    </p>
                    {selectedSpace.kind === 'family' && selectedFamily ? (
                      <p className="mt-1 text-slate-600">
                        目前顯示「{selectedFamily.name}」的唯一家庭聊天室，定位於{' '}
                        <code>{selectedDate}</code> 並保留前後訊息上下文。
                      </p>
                    ) : (
                      <p className="mt-1 text-amber-800">
                        您目前位於「個人空間」。請由頂端空間切換器選擇一個家庭空間以檢視該家庭聊天室，或切換至「心情」分頁記錄個人隨手記。
                      </p>
                    )}
                  </div>
                )}

                {activeTab === 'ledger' && (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs text-slate-700">
                    <p className="font-semibold text-slate-900">
                      💰 記帳收支明細（日期：{selectedDate} ｜ {currentSpaceLabel}）
                    </p>
                    <p className="mt-1 text-slate-600">
                      依目前選取空間（{currentSpaceLabel}）顯示{' '}
                      <code>{selectedDate}</code> 的收支紀錄與當月統計（Issue #13）。
                    </p>
                  </div>
                )}

                {activeTab === 'tasks' && (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs text-slate-700">
                    <p className="font-semibold text-slate-900">
                      ✅ 待辦事項（選取日：{selectedDate} ｜ {currentSpaceLabel}）
                    </p>
                    <p className="mt-1 text-slate-600">
                      顯示 {currentSpaceLabel} 於 <code>{selectedDate}</code>{' '}
                      截止或無特定日期的待辦事項（Issue #8）。
                    </p>
                  </div>
                )}

                {activeTab === 'diary' && (
                  <div className="space-y-3">
                    {diaryAutoSwitchedToPersonal && (
                      <div
                        role="status"
                        data-testid="diary-auto-switched-personal-notice"
                        className="rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs font-medium text-amber-900"
                      >
                        🔒 私人日記屬於個人專屬資料（<code>personalOnly</code>
                        ），不對家庭空間共享；系統已自動為您切換回「個人空間」。
                      </div>
                    )}

                    {selectedSpace.kind === 'family' ? (
                      <div
                        data-testid="diary-family-space-guard"
                        className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-xs text-amber-950 space-y-2"
                      >
                        <p className="font-semibold">
                          🔒 家庭空間不顯示私人日記（僅限個人空間存取）
                        </p>
                        <p className="text-amber-900">
                          依據隱私保護規則，私人日記永不對家庭共享。請返回個人空間檢視或撰寫您的私人日記。
                        </p>
                        <button
                          type="button"
                          data-testid="diary-switch-to-personal-btn"
                          onClick={() => handleSelectSpace({ kind: 'personal' })}
                          className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700"
                        >
                          立即切回個人空間
                        </button>
                      </div>
                    ) : (
                      <div className="rounded-lg border border-indigo-200 bg-indigo-50/50 p-4 text-xs text-slate-700">
                        <p className="font-semibold text-indigo-950">
                          🔒 私人日記（日期：{selectedDate} ｜ 嚴格個人專屬）
                        </p>
                        <p className="mt-1 text-slate-600">
                          私人日記永遠僅限本人（<code>user_id</code>
                          ）讀寫，絕不對家庭成員公開。即使頂端切換至家庭空間，月曆也不會洩露私人日記圖示（Issue #12 / #14）。
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Footer hint in Right Panel */}
          <div className="mt-4 flex items-center justify-between border-t border-slate-200/80 pt-3 text-[11px] text-slate-500">
            <span>點擊左側任意日期格空白處 ➔ 自動選日並切回「摘要」</span>
            <span className="font-mono">{selectedDate}</span>
          </div>
        </div>
      </div>
    </section>
  );
}
