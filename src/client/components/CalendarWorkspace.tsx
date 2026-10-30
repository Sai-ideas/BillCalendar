import { useMemo } from 'react';
import {
  RIGHT_PANEL_TABS,
  WEEKDAY_LABELS_ZH,
  buildMonthCalendarGrid,
  formatYearMonthLabel,
  jumpCalendarToDate,
  navigateCalendarMonth,
  selectCalendarDateBlank,
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
}

export function CalendarWorkspace({
  navState,
  onChangeNavState,
  families,
  onSelectFamilySpace,
}: CalendarWorkspaceProps) {
  const {
    todayDate,
    selectedDate,
    displayedMonth,
    activeTab,
    selectedSpace,
    mobileView,
  } = navState;

  const gridCells = useMemo(
    () => buildMonthCalendarGrid(displayedMonth, selectedDate, todayDate),
    [displayedMonth, selectedDate, todayDate],
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
    onChangeNavState({
      ...navState,
      selectedSpace: space,
    });
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
    onChangeNavState(jumpCalendarToDate(navState, todayDate));
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
        {/* Left 60-65% on Desktop (7 of 12 cols = 58.3% or custom grid): Let's use lg:col-span-7 (~60%) */}
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

          {/* 6-week High-Density Month Grid */}
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
              } = cell;

              return (
                <button
                  key={dateStr}
                  type="button"
                  data-testid={`calendar-cell-${dateStr}`}
                  data-current-month={isCurrentMonth ? 'true' : 'false'}
                  data-is-today={isToday ? 'true' : 'false'}
                  data-is-selected={isSelected ? 'true' : 'false'}
                  aria-label={`選擇日期 ${dateStr}${isToday ? ' (今日)' : ''}${isSelected ? ' (已選取)' : ''}`}
                  aria-selected={isSelected}
                  onClick={() => handleCellBlankClick(dateStr, false)}
                  className={`group relative flex min-h-[76px] flex-col items-start justify-between rounded-lg border p-1.5 text-left transition sm:min-h-[88px] sm:p-2 ${
                    isSelected
                      ? 'border-indigo-600 bg-indigo-50/75 ring-2 ring-indigo-600/30'
                      : isToday
                        ? 'border-emerald-500 bg-emerald-50/40 hover:border-emerald-600'
                        : isCurrentMonth
                          ? 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/70'
                          : 'border-slate-100 bg-slate-50/60 text-slate-400 hover:border-slate-200'
                  }`}
                >
                  {/* Top Row of Cell: Solar Day + Today/Selected Badges */}
                  <div className="flex w-full items-center justify-between gap-1">
                    <span
                      className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                        isSelected
                          ? 'bg-indigo-600 text-white'
                          : isToday
                            ? 'bg-emerald-600 text-white'
                            : !isCurrentMonth
                              ? 'text-slate-400'
                              : dayOfWeek === 0
                                ? 'text-rose-600'
                                : dayOfWeek === 6
                                  ? 'text-indigo-600'
                                  : 'text-slate-800'
                      }`}
                    >
                      {day}
                    </span>

                    <div className="flex items-center gap-0.5">
                      {isToday && (
                        <span className="rounded-xs bg-emerald-100 px-1 py-0.5 text-[10px] font-bold text-emerald-800">
                          今日
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Middle/Bottom Slot: Reserved for Lunar label (Issue #6), Event/Task bars (Issues #7/#8) & Existence Icons (Issue #14) */}
                  <div className="mt-1 w-full space-y-0.5">
                    <div className="truncate text-[10px] text-slate-400">
                      {/* Issue #6 will populate lunar date & solar terms here */}
                      {isCurrentMonth ? '點擊看摘要' : `${cell.month}/${cell.day}`}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Mobile Quick Bar under calendar to open selected date details on small screens */}
          <div className="mt-3 flex items-center justify-between rounded-lg border border-indigo-100 bg-indigo-50/70 px-3 py-2 text-xs lg:hidden">
            <div>
              <span className="text-slate-600">已選日期：</span>
              <strong className="font-mono font-bold text-indigo-900">
                {selectedDate}
              </strong>
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
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    data-testid={`right-tab-${tab.id}`}
                    aria-selected={isActive}
                    onClick={() => handleTabClick(tab.id)}
                    className={`rounded-lg px-2 py-2 text-xs font-bold transition ${
                      isActive
                        ? 'bg-indigo-600 text-white shadow-2xs'
                        : 'bg-white/70 text-slate-700 hover:bg-white hover:text-slate-900'
                    }`}
                  >
                    {tab.label}
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
                        點擊左側月曆任意日期空白處，即更新全域{' '}
                        <code>selectedDate</code> 並開啟本摘要面板；
                        <code>selectedDate</code> ({selectedDate}) 與系統今日{' '}
                        <code>today</code> ({todayDate}) 狀態彼此獨立。
                      </p>
                    </div>

                    {/* Quick Module Entry Buttons (UX.md: 摘要顯示當日行程／待辦／收支及其他已授權紀錄，並提供進入各模組的入口) */}
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
                                  {isHiddenInFamily ? '僅限個人' : '開啟 ➔'}
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
