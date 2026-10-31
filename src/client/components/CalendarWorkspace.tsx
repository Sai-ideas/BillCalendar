import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  CreateEventRequestSchema,
  CreateTaskRequestSchema,
  DEFAULT_TIMEZONE,
  LUNAR_AND_HOLIDAY_PROVENANCE,
  MAX_CALENDAR_YEAR,
  MAX_VISIBLE_EVENTS_PER_CELL,
  MIN_CALENDAR_YEAR,
  RIGHT_PANEL_TABS,
  UpdateEventRequestSchema,
  UpdateTaskRequestSchema,
  WEEKDAY_LABELS_ZH,
  buildCalendarEventsByDateMap,
  buildTasksByDueDateMap,
  buildMonthCalendarGrid,
  canNavigateCalendarMonth,
  clearSelectedCalendarEvent,
  convertLocalDateTimeInTimezoneToUtcIso,
  formatInstantToLocalDate,
  formatInstantToLocalDateTimeInput,
  formatInstantToLocalTimeLabel,
  formatYearMonthLabel,
  getCellEventsDisplaySlice,
  getLunarDateInfo,
  getTodayLocalDate,
  isValidIanaTimezone,
  isValidLocalDateString,
  isValidUtcIsoTimestamp,
  jumpCalendarToDate,
  navigateCalendarMonth,
  navigateCalendarToEventSourceMessage,
  normalizeToUtcIsoTimestamp,
  openCalendarTasksForDate,
  refreshCalendarTodayDate,
  resolveEventCalendarDates,
  selectCalendarDateBlank,
  selectCalendarEventFromCell,
  selectCalendarSpace,
  switchRightPanelTab,
  type CalendarNavigationState,
  type CreateEventRequest,
  type CreateTaskRequest,
  type EventDetail,
  type FamilySummary,
  type RightPanelTab,
  type SelectedSpace,
  type MessageWithAuthorizedDerived,
  type TaskDetail,
  type UpdateEventRequest,
  type UpdateTaskRequest,
} from '../../shared';
import { TasksPanel, type TaskMutationInput } from './TasksPanel';
import { ChatPanel } from './ChatPanel';

/** Max task chips rendered inside one calendar date cell before collapsing into "+N 待辦". */
const MAX_VISIBLE_TASKS_PER_CELL = 2;

export interface CalendarWorkspaceProps {
  navState: CalendarNavigationState;
  onChangeNavState: (next: CalendarNavigationState) => void;
  families: FamilySummary[];
  onSelectFamilySpace?: (familyId: string) => void;
  currentUserId?: string | null;
  timezone?: string;
  getNow?: () => Date;
  events?: EventDetail[];
  initialEvents?: EventDetail[];
  eventsLoading?: boolean;
  eventsError?: string | null;
  onCreateEvent?: (payload: CreateEventRequest) => Promise<EventDetail>;
  onUpdateEvent?: (eventId: string, payload: UpdateEventRequest) => Promise<EventDetail>;
  onDeleteEvent?: (eventId: string) => Promise<void>;
  tasks?: TaskDetail[];
  initialTasks?: TaskDetail[];
  tasksLoading?: boolean;
  tasksError?: string | null;
  onCreateTask?: (payload: CreateTaskRequest) => Promise<TaskDetail>;
  onUpdateTask?: (taskId: string, payload: UpdateTaskRequest) => Promise<TaskDetail>;
  onDeleteTask?: (taskId: string) => Promise<void>;
  chatMessages?: MessageWithAuthorizedDerived[];
  initialChatMessages?: MessageWithAuthorizedDerived[];
  chatLoading?: boolean;
  chatError?: string | null;
  onCreateChatMessage?: (payload: { body: string; recordDate?: string | null }) => Promise<MessageWithAuthorizedDerived>;
  onDeleteChatMessage?: (messageId: string) => Promise<void>;
  chatHasMoreBefore?: boolean;
  chatHasMoreAfter?: boolean;
  chatLoadingEarlier?: boolean;
  chatLoadingLater?: boolean;
  chatTargetMessageFound?: boolean | null;
  onChatLoadEarlier?: () => Promise<void>;
  onChatLoadLater?: () => Promise<void>;
  maxVisibleEventsPerCell?: number;
}

export function CalendarWorkspace({
  navState,
  onChangeNavState,
  families,
  onSelectFamilySpace,
  currentUserId = null,
  timezone = DEFAULT_TIMEZONE,
  getNow,
  events: controlledEvents,
  initialEvents = [],
  eventsLoading = false,
  eventsError = null,
  onCreateEvent,
  onUpdateEvent,
  onDeleteEvent,
  tasks: controlledTasks,
  initialTasks = [],
  tasksLoading = false,
  tasksError = null,
  onCreateTask,
  onUpdateTask,
  onDeleteTask,
  chatMessages: controlledChatMessages,
  initialChatMessages = [],
  chatLoading = false,
  chatError = null,
  chatHasMoreBefore = false,
  chatHasMoreAfter = false,
  chatLoadingEarlier = false,
  chatLoadingLater = false,
  chatTargetMessageFound = null,
  onChatLoadEarlier,
  onChatLoadLater,
  onCreateChatMessage,
  onDeleteChatMessage,
  maxVisibleEventsPerCell = MAX_VISIBLE_EVENTS_PER_CELL,
}: CalendarWorkspaceProps) {
  const {
    todayDate,
    selectedDate,
    displayedMonth,
    activeTab,
    selectedSpace,
    mobileView,
    diaryAutoSwitchedToPersonal,
    selectedEventId = null,
    highlightedSourceMessageId = null,
  } = navState;

  // Local fallback state when rendered standalone in component tests without controlled `events`
  const [localEvents, setLocalEvents] = useState<EventDetail[]>(() => initialEvents);
  const allEvents = controlledEvents ?? localEvents;

  // Local fallback tasks when rendered standalone without controlled `tasks` (Issue #8)
  const [localTasks, setLocalTasks] = useState<TaskDetail[]>(() => initialTasks);
  const allTasks = controlledTasks ?? localTasks;

  // Local fallback chat messages when rendered standalone (Issue #9)
  const [localChatMessages, setLocalChatMessages] = useState<MessageWithAuthorizedDerived[]>(
    () => initialChatMessages,
  );
  const allChatMessages = controlledChatMessages ?? localChatMessages;

  const spaceContextKey = `${currentUserId ?? 'anon'}:${
    selectedSpace.kind === 'personal' ? 'personal' : selectedSpace.familyId
  }`;

  const moodMessages = useMemo(
    () => allChatMessages.filter((m) => m.roomKind === 'personal'),
    [allChatMessages],
  );

  const familyMessages = useMemo(
    () =>
      allChatMessages.filter(
        (m) =>
          m.roomKind === 'family' &&
          (selectedSpace.kind === 'family' ? m.familyId === selectedSpace.familyId : true),
      ),
    [allChatMessages, selectedSpace],
  );

  const handleSendChatMessage = async (payload: { body: string; recordDate?: string | null }) => {
    if (onCreateChatMessage) {
      await onCreateChatMessage(payload);
    } else {
      const nowIso = new Date().toISOString();
      const newMsg: MessageWithAuthorizedDerived = {
        id: `msg_local_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        roomId:
          activeTab === 'mood'
            ? 'room_personal'
            : selectedSpace.kind === 'family'
              ? `room_${selectedSpace.familyId}`
              : 'room_unknown',
        roomKind: activeTab === 'mood' ? 'personal' : 'family',
        familyId:
          activeTab === 'mood'
            ? null
            : selectedSpace.kind === 'family'
              ? selectedSpace.familyId
              : null,
        senderUserId: currentUserId ?? 'local_user',
        senderDisplayName: currentUserId ? '我' : '訪客',
        body: payload.body,
        localDate: selectedDate,
        recordDate: payload.recordDate ?? null,
        createdAt: nowIso,
        updatedAt: nowIso,
        derivedTasks: [],
        derivedEvents: [],
        derivedCount: 0,
      };
      setLocalChatMessages((prev) => [...prev, newMsg]);
    }
  };

  const handleDeleteChatMessage = async (messageId: string) => {
    if (onDeleteChatMessage) {
      await onDeleteChatMessage(messageId);
    } else {
      setLocalChatMessages((prev) => prev.filter((m) => m.id !== messageId));
    }
  };

  // Track which date cells have expanded overflow event lists (`+N 更多`)
  const [expandedOverflowCells, setExpandedOverflowCells] = useState<Record<string, boolean>>({});

  // Event CRUD form state ('create' | 'edit' | null)
  const [formMode, setFormMode] = useState<'create' | 'edit' | null>(null);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [formTitle, setFormTitle] = useState<string>('');
  const [formDescription, setFormDescription] = useState<string>('');
  const [formAllDay, setFormAllDay] = useState<boolean>(true);
  const [formStartsAt, setFormStartsAt] = useState<string>(selectedDate);
  const [formEndsAt, setFormEndsAt] = useState<string>(selectedDate);
  const [formTimezone, setFormTimezone] = useState<string>(timezone);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSubmitting, setFormSubmitting] = useState<boolean>(false);

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

  // Strictly isolate events by the active `selectedSpace` (Personal vs selected Family) and `currentUserId`
  const spaceScopedEvents = useMemo(() => {
    return allEvents.filter((ev) => {
      if (selectedSpace.kind === 'personal') {
        if (ev.scope !== 'personal') return false;
        if (currentUserId && ev.ownerUserId && ev.ownerUserId !== currentUserId) {
          return false;
        }
        return true;
      }
      return ev.scope === 'family' && ev.familyId === selectedSpace.familyId;
    });
  }, [allEvents, selectedSpace, currentUserId]);

  // Strictly isolate tasks by the active `selectedSpace` and `currentUserId` (Issue #8)
  const spaceScopedTasks = useMemo(() => {
    return allTasks.filter((task) => {
      if (selectedSpace.kind === 'personal') {
        if (task.scope !== 'personal') return false;
        if (currentUserId && task.ownerUserId && task.ownerUserId !== currentUserId) {
          return false;
        }
        return true;
      }
      return task.scope === 'family' && task.familyId === selectedSpace.familyId;
    });
  }, [allTasks, selectedSpace, currentUserId]);

  // Tasks with a pure `due_date` map onto the matching date cell (no timezone shifting, Review D4)
  const tasksByDueDateMap = useMemo(
    () => buildTasksByDueDateMap(spaceScopedTasks),
    [spaceScopedTasks],
  );
  const selectedDateTasks = tasksByDueDateMap[selectedDate] ?? [];

  // Map space-scoped events onto calendar date cells via `resolveEventCalendarDates`
  const eventsByDateMap = useMemo(
    () => buildCalendarEventsByDateMap(spaceScopedEvents),
    [spaceScopedEvents],
  );

  const selectedDateEventBars = useMemo(
    () => eventsByDateMap[selectedDate] ?? [],
    [eventsByDateMap, selectedDate],
  );

  const selectedEvent = useMemo(() => {
    if (!selectedEventId) return null;
    return spaceScopedEvents.find((ev) => ev.id === selectedEventId) ?? null;
  }, [spaceScopedEvents, selectedEventId]);

  const canGoPrevMonth = canNavigateCalendarMonth(displayedMonth, -1);
  const canGoNextMonth = canNavigateCalendarMonth(displayedMonth, 1);

  const openCreateFormForDate = (targetDate: string = selectedDate) => {
    setFormMode('create');
    setEditingEventId(null);
    setFormTitle('');
    setFormDescription('');
    setFormAllDay(true);
    setFormStartsAt(targetDate);
    setFormEndsAt(targetDate);
    setFormTimezone(timezone);
    setFormError(null);
  };

  const openEditFormForEvent = (ev: EventDetail) => {
    setFormMode('edit');
    setEditingEventId(ev.id);
    setFormTitle(ev.title);
    setFormDescription(ev.description ?? '');
    setFormAllDay(ev.allDay);
    const effectiveTz = ev.timezone || timezone;
    setFormTimezone(effectiveTz);
    if (ev.allDay) {
      setFormStartsAt(ev.startsAt.slice(0, 10));
      setFormEndsAt(ev.endsAt.slice(0, 10));
    } else {
      setFormStartsAt(formatInstantToLocalDateTimeInput(ev.startsAt, effectiveTz));
      setFormEndsAt(formatInstantToLocalDateTimeInput(ev.endsAt, effectiveTz));
    }
    setFormError(null);
  };

  const handleToggleAllDayInForm = (nextAllDay: boolean) => {
    setFormAllDay(nextAllDay);
    setFormError(null);
    if (nextAllDay) {
      const startDay = isValidLocalDateString(formStartsAt.slice(0, 10))
        ? formStartsAt.slice(0, 10)
        : selectedDate;
      const endDay = isValidLocalDateString(formEndsAt.slice(0, 10))
        ? formEndsAt.slice(0, 10)
        : startDay;
      setFormStartsAt(startDay);
      setFormEndsAt(endDay < startDay ? startDay : endDay);
    } else {
      const baseStartDay = isValidLocalDateString(formStartsAt.slice(0, 10))
        ? formStartsAt.slice(0, 10)
        : selectedDate;
      const baseEndDay = isValidLocalDateString(formEndsAt.slice(0, 10))
        ? formEndsAt.slice(0, 10)
        : baseStartDay;
      setFormStartsAt(`${baseStartDay}T09:00`);
      setFormEndsAt(`${baseEndDay}T10:00`);
    }
  };

  const handleSelectSpace = (space: SelectedSpace) => {
    setFormMode(null);
    setFormError(null);
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
    setFormMode(null);
    setFormError(null);
    onChangeNavState(
      selectCalendarDateBlank(navState, dateStr, { openMobilePanel }),
    );
  };

  const handleEventBarClick = (eventId: string, cellDateStr: string) => {
    setFormMode(null);
    setFormError(null);
    onChangeNavState(
      selectCalendarEventFromCell(navState, eventId, cellDateStr, {
        openMobilePanel: true,
      }),
    );
  };

  const handleToggleCellOverflow = (dateStr: string) => {
    setExpandedOverflowCells((prev) => ({
      ...prev,
      [dateStr]: !prev[dateStr],
    }));
  };

  const handleTabClick = (tab: RightPanelTab) => {
    setFormMode(null);
    setFormError(null);
    onChangeNavState({
      ...switchRightPanelTab(navState, tab),
      mobileView: 'panel',
    });
  };

  const handleJumpToSourceMessage = (ev: Pick<EventDetail, 'sourceStatus' | 'sourceMessage'>) => {
    if (ev.sourceStatus !== 'accessible' || !ev.sourceMessage) return;
    const authorizedFamilyIds = families.map((f) => f.id);
    const nextState = navigateCalendarToEventSourceMessage(
      navState,
      ev,
      authorizedFamilyIds,
    );
    if (nextState === navState) return;
    onChangeNavState(nextState);
    if (
      nextState.selectedSpace.kind === 'family' &&
      onSelectFamilySpace
    ) {
      onSelectFamilySpace(nextState.selectedSpace.familyId);
    }
  };

  const resolveFormTimestamps = ():
    | { ok: true; startsAt: string; endsAt: string; timezone: string }
    | { ok: false; message: string } => {
    const trimmedTz = formTimezone.trim() || DEFAULT_TIMEZONE;
    if (!isValidIanaTimezone(trimmedTz)) {
      return { ok: false, message: '無效的 IANA 時區設定' };
    }

    if (formAllDay) {
      const startPure = formStartsAt.trim();
      const endPure = formEndsAt.trim();
      if (!isValidLocalDateString(startPure)) {
        return {
          ok: false,
          message: '全天事件開始日期必須為有效的 YYYY-MM-DD 純日期字串（不做 UTC 換日）',
        };
      }
      if (!isValidLocalDateString(endPure)) {
        return {
          ok: false,
          message: '全天事件結束日期必須為有效的 YYYY-MM-DD 純日期字串（不做 UTC 換日）',
        };
      }
      if (endPure < startPure) {
        return { ok: false, message: '全天事件結束日期不可早於開始日期' };
      }
      return { ok: true, startsAt: startPure, endsAt: endPure, timezone: trimmedTz };
    }

    let startIso: string;
    let endIso: string;
    try {
      startIso = isValidUtcIsoTimestamp(formStartsAt)
        ? normalizeToUtcIsoTimestamp(formStartsAt)
        : convertLocalDateTimeInTimezoneToUtcIso(formStartsAt, trimmedTz);
    } catch (err: unknown) {
      return {
        ok: false,
        message:
          err instanceof Error && err.message.includes('日光節約時間')
            ? err.message
            : '具時間事件開始時間格式無效（請提供 YYYY-MM-DDTHH:mm 或 ISO 8601 時間戳）',
      };
    }

    try {
      endIso = isValidUtcIsoTimestamp(formEndsAt)
        ? normalizeToUtcIsoTimestamp(formEndsAt)
        : convertLocalDateTimeInTimezoneToUtcIso(formEndsAt, trimmedTz);
    } catch (err: unknown) {
      return {
        ok: false,
        message:
          err instanceof Error && err.message.includes('日光節約時間')
            ? err.message
            : '具時間事件結束時間格式無效（請提供 YYYY-MM-DDTHH:mm 或 ISO 8601 時間戳）',
      };
    }

    if (Date.parse(endIso) < Date.parse(startIso)) {
      return { ok: false, message: '具時間事件結束時間不可早於開始時間' };
    }

    return { ok: true, startsAt: startIso, endsAt: endIso, timezone: trimmedTz };
  };

  const handleSubmitEventForm = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const resolvedTime = resolveFormTimestamps();
    if (!resolvedTime.ok) {
      setFormError(resolvedTime.message);
      return;
    }

    if (formMode === 'create') {
      const candidate: CreateEventRequest = {
        scope: selectedSpace.kind,
        ...(selectedSpace.kind === 'family' ? { familyId: selectedSpace.familyId } : {}),
        title: formTitle,
        description: formDescription.trim() ? formDescription.trim() : null,
        startsAt: resolvedTime.startsAt,
        endsAt: resolvedTime.endsAt,
        allDay: formAllDay,
        timezone: resolvedTime.timezone,
      };

      const parsed = CreateEventRequestSchema.safeParse(candidate);
      if (!parsed.success) {
        setFormError(parsed.error.issues[0]?.message ?? '事件資料驗證失敗');
        return;
      }

      setFormSubmitting(true);
      try {
        let createdEvent: EventDetail;
        if (onCreateEvent) {
          createdEvent = await onCreateEvent(parsed.data);
        } else {
          const nowIso = new Date().toISOString();
          createdEvent = {
            id: `evt_local_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            calendarId:
              selectedSpace.kind === 'personal'
                ? 'cal_personal_local'
                : `cal_family_${selectedSpace.familyId}`,
            scope: parsed.data.scope,
            ownerUserId:
              parsed.data.scope === 'personal' ? (currentUserId ?? 'usr_local') : null,
            familyId: parsed.data.scope === 'family' ? parsed.data.familyId! : null,
            title: parsed.data.title,
            description: parsed.data.description ?? null,
            startsAt: parsed.data.startsAt,
            endsAt: parsed.data.endsAt,
            allDay: parsed.data.allDay,
            timezone: parsed.data.timezone,
            sourceMessageId: parsed.data.sourceMessageId ?? null,
            sourceStatus: 'none',
            sourceMessage: null,
            createdBy: 'usr_local',
            createdAt: nowIso,
            updatedAt: nowIso,
          };
          setLocalEvents((prev) => [...prev, createdEvent]);
        }

        const occupied = resolveEventCalendarDates(
          createdEvent,
          createdEvent.timezone || timezone,
        );
        const firstDate = occupied[0] ?? selectedDate;
        setFormMode(null);
        onChangeNavState(
          selectCalendarEventFromCell(navState, createdEvent.id, firstDate),
        );
      } catch (err: unknown) {
        setFormError(err instanceof Error ? err.message : '建立事件失敗');
      } finally {
        setFormSubmitting(false);
      }
      return;
    }

    if (formMode === 'edit' && editingEventId) {
      const updateCandidate: UpdateEventRequest = {
        title: formTitle,
        description: formDescription.trim() ? formDescription.trim() : null,
        startsAt: resolvedTime.startsAt,
        endsAt: resolvedTime.endsAt,
        allDay: formAllDay,
        timezone: resolvedTime.timezone,
      };

      const parsed = UpdateEventRequestSchema.safeParse(updateCandidate);
      if (!parsed.success) {
        setFormError(parsed.error.issues[0]?.message ?? '更新事件資料驗證失敗');
        return;
      }

      setFormSubmitting(true);
      try {
        let updatedEvent: EventDetail;
        if (onUpdateEvent) {
          updatedEvent = await onUpdateEvent(editingEventId, parsed.data);
        } else {
          const existing = allEvents.find((item) => item.id === editingEventId);
          if (!existing) {
            throw new Error('找不到要更新的事件');
          }
          updatedEvent = {
            ...existing,
            title: parsed.data.title ?? existing.title,
            description:
              parsed.data.description !== undefined
                ? parsed.data.description
                : existing.description,
            startsAt: parsed.data.startsAt ?? existing.startsAt,
            endsAt: parsed.data.endsAt ?? existing.endsAt,
            allDay: parsed.data.allDay ?? existing.allDay,
            timezone: parsed.data.timezone ?? existing.timezone,
            updatedAt: new Date().toISOString(),
          };
          setLocalEvents((prev) =>
            prev.map((item) => (item.id === editingEventId ? updatedEvent : item)),
          );
        }

        const occupied = resolveEventCalendarDates(
          updatedEvent,
          updatedEvent.timezone || timezone,
        );
        const targetDate = occupied.includes(selectedDate)
          ? selectedDate
          : (occupied[0] ?? selectedDate);
        setFormMode(null);
        setEditingEventId(null);
        onChangeNavState(
          selectCalendarEventFromCell(navState, updatedEvent.id, targetDate),
        );
      } catch (err: unknown) {
        setFormError(err instanceof Error ? err.message : '更新事件失敗');
      } finally {
        setFormSubmitting(false);
      }
    }
  };

  const handleDeleteEvent = async (eventId: string) => {
    setFormError(null);
    setFormSubmitting(true);
    try {
      if (onDeleteEvent) {
        await onDeleteEvent(eventId);
      } else {
        setLocalEvents((prev) => prev.filter((item) => item.id !== eventId));
      }
      setFormMode(null);
      setEditingEventId(null);
      onChangeNavState(clearSelectedCalendarEvent(navState));
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : '刪除事件失敗');
    } finally {
      setFormSubmitting(false);
    }
  };

  const handleCreateTaskInput = async (input: { title: string; dueDate: string | null }) => {
    const candidate: CreateTaskRequest = {
      scope: selectedSpace.kind,
      ...(selectedSpace.kind === 'family' ? { familyId: selectedSpace.familyId } : {}),
      title: input.title,
      dueDate: input.dueDate,
    };
    const parsed = CreateTaskRequestSchema.safeParse(candidate);
    if (!parsed.success) {
      throw new Error(parsed.error.issues[0]?.message ?? '待辦資料驗證失敗');
    }
    if (onCreateTask) {
      await onCreateTask(parsed.data);
      return;
    }
    const nowIso = new Date().toISOString();
    const created: TaskDetail = {
      id: `task_local_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      listId: selectedSpace.kind === 'personal' ? 'list_personal_local' : `list_family_${selectedSpace.familyId}`,
      scope: parsed.data.scope,
      ownerUserId: parsed.data.scope === 'personal' ? (currentUserId ?? 'usr_local') : null,
      familyId: parsed.data.scope === 'family' ? parsed.data.familyId! : null,
      title: parsed.data.title,
      dueDate: parsed.data.dueDate ?? null,
      completedAt: null,
      sourceMessageId: null,
      sourceStatus: 'none',
      sourceMessage: null,
      createdBy: 'usr_local',
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    setLocalTasks((prev) => [...prev, created]);
  };

  const handleUpdateTaskInput = async (taskId: string, input: TaskMutationInput) => {
    const parsed = UpdateTaskRequestSchema.safeParse(input);
    if (!parsed.success) {
      throw new Error(parsed.error.issues[0]?.message ?? '待辦更新資料驗證失敗');
    }
    if (onUpdateTask) {
      await onUpdateTask(taskId, parsed.data);
      return;
    }
    const nowIso = new Date().toISOString();
    setLocalTasks((prev) =>
      prev.map((task) =>
        task.id !== taskId
          ? task
          : {
              ...task,
              title: parsed.data.title ?? task.title,
              dueDate: parsed.data.dueDate !== undefined ? parsed.data.dueDate : task.dueDate,
              completedAt:
                parsed.data.completed === undefined
                  ? task.completedAt
                  : parsed.data.completed
                    ? (task.completedAt ?? nowIso)
                    : null,
              updatedAt: nowIso,
            },
      ),
    );
  };

  const handleDeleteTaskInput = async (taskId: string) => {
    if (onDeleteTask) {
      await onDeleteTask(taskId);
      return;
    }
    setLocalTasks((prev) => prev.filter((task) => task.id !== taskId));
  };

  const handleOpenTasksForDate = (dateStr: string) => {
    setFormMode(null);
    setFormError(null);
    onChangeNavState(openCalendarTasksForDate(navState, dateStr, { openMobilePanel: true }));
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

          {/* Month Navigation Controls (guarded within 1900–2100 supported lunar range) */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center rounded-lg border border-slate-300 bg-white shadow-2xs">
              <button
                type="button"
                data-testid="calendar-prev-month"
                aria-label="上個月"
                disabled={!canGoPrevMonth}
                onClick={handlePrevMonth}
                className="px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-l-lg disabled:opacity-40"
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
                disabled={!canGoNextMonth}
                onClick={handleNextMonth}
                className="px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-r-lg disabled:opacity-40"
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

            <button
              type="button"
              data-testid="top-open-create-event-btn"
              onClick={() => {
                onChangeNavState({
                  ...switchRightPanelTab(navState, 'summary'),
                  selectedEventId: null,
                  mobileView: 'panel',
                });
                openCreateFormForDate(selectedDate);
              }}
              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 shadow-2xs"
            >
              + 新增事件
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

          {/* 6-week High-Density Month Grid (Solar + Lunar + 24 Solar Terms + Holidays + Event Bars) */}
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

              const cellEvents = eventsByDateMap[dateStr] ?? [];
              const cellTasks = tasksByDueDateMap[dateStr] ?? [];
              const cellSlice = getCellEventsDisplaySlice(cellEvents, {
                maxVisible: maxVisibleEventsPerCell,
                isExpanded: Boolean(expandedOverflowCells[dateStr]),
              });

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
                <div
                  key={dateStr}
                  role="gridcell"
                  tabIndex={0}
                  data-testid={`calendar-cell-${dateStr}`}
                  data-current-month={isCurrentMonth ? 'true' : 'false'}
                  data-is-today={isToday ? 'true' : 'false'}
                  data-is-selected={isSelected ? 'true' : 'false'}
                  data-is-leap-month={lunar.isLeapMonth ? 'true' : 'false'}
                  data-event-count={String(cellSlice.totalCount)}
                  data-task-count={String(cellTasks.length)}
                  aria-label={`選擇日期 ${dateStr} 農曆${lunar.lunarMonthLabel}${lunar.lunarDayLabel}${lunar.cellDisplayText !== lunar.lunarDayLabel ? ` (${lunar.cellDisplayText})` : ''}${isToday ? ' (今日)' : ''}${isSelected ? ' (已選取)' : ''}`}
                  aria-selected={isSelected}
                  onClick={() => handleCellBlankClick(dateStr, false)}
                  onKeyDown={(e) => {
                    if (
                      e.target === e.currentTarget &&
                      (e.key === 'Enter' || e.key === ' ')
                    ) {
                      e.preventDefault();
                      handleCellBlankClick(dateStr, false);
                    }
                  }}
                  className={`group relative flex min-h-[88px] cursor-pointer flex-col items-start justify-between rounded-lg border p-1.5 text-left transition sm:min-h-[104px] sm:p-2 ${
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

                  {/* Lunar Date / Leap Month / 24 Solar Term / Festival Row (Issue #6) */}
                  <div className="mt-0.5 w-full">
                    <div className="flex items-center justify-between gap-1">
                      <span
                        data-testid={`calendar-cell-lunar-${dateStr}`}
                        data-lunar-highlight={lunar.cellHighlightKind}
                        className={`truncate text-[10px] leading-tight ${lunarTextClass}`}
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
                  </div>

                  {/* Event Bars Slot (Issue #7: single-day, multi-day, all-day + overflow collapse) */}
                  <div className="mt-1 flex w-full flex-col gap-0.5">
                    {cellSlice.visibleEvents.map((bar) => {
                      const isEventSelected = selectedEventId === bar.event.id;
                      const isFamilyEvent = bar.event.scope === 'family';
                      const spanRoundingClass =
                        bar.spanPosition === 'start'
                          ? 'rounded-l-md rounded-r-xs border-l-2'
                          : bar.spanPosition === 'middle'
                            ? 'rounded-xs'
                            : bar.spanPosition === 'end'
                              ? 'rounded-l-xs rounded-r-md border-r-2'
                              : 'rounded-md';

                      const barToneClass = isEventSelected
                        ? 'bg-indigo-700 text-white ring-1 ring-indigo-900'
                        : bar.event.allDay
                          ? isFamilyEvent
                            ? 'bg-teal-600 text-white hover:bg-teal-700'
                            : 'bg-indigo-600 text-white hover:bg-indigo-700'
                          : isFamilyEvent
                            ? 'border border-teal-300 bg-teal-50 text-teal-900 hover:bg-teal-100'
                            : 'border border-indigo-200 bg-indigo-50 text-indigo-900 hover:bg-indigo-100';

                      return (
                        <button
                          key={`${dateStr}-${bar.event.id}`}
                          type="button"
                          data-testid={`calendar-cell-event-${dateStr}-${bar.event.id}`}
                          data-event-id={bar.event.id}
                          data-all-day={bar.event.allDay ? 'true' : 'false'}
                          data-span-position={bar.spanPosition}
                          data-is-multi-day={bar.isMultiDay ? 'true' : 'false'}
                          title={`${bar.event.title} (${bar.timeLabel})`}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleEventBarClick(bar.event.id, dateStr);
                          }}
                          className={`flex w-full items-center justify-between gap-1 px-1.5 py-0.5 text-left text-[10px] leading-tight font-medium transition ${spanRoundingClass} ${barToneClass}`}
                        >
                          <span className="truncate font-semibold">
                            {bar.event.title}
                          </span>
                          <span className="shrink-0 text-[9px] opacity-90">
                            {bar.timeLabel}
                          </span>
                        </button>
                      );
                    })}

                    {cellSlice.hasOverflow && !cellSlice.isExpanded && (
                      <button
                        type="button"
                        data-testid={`calendar-cell-more-events-${dateStr}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleCellOverflow(dateStr);
                        }}
                        className="w-full rounded-xs bg-slate-100 px-1 py-0.5 text-center text-[10px] font-semibold text-slate-700 hover:bg-slate-200"
                      >
                        +{cellSlice.hiddenCount} 更多
                      </button>
                    )}

                    {cellSlice.hasOverflow && cellSlice.isExpanded && (
                      <button
                        type="button"
                        data-testid={`calendar-cell-collapse-events-${dateStr}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleCellOverflow(dateStr);
                        }}
                        className="w-full rounded-xs bg-slate-200/80 px-1 py-0.5 text-center text-[10px] font-semibold text-slate-700 hover:bg-slate-300"
                      >
                        收合 ({cellSlice.totalCount} 筆)
                      </button>
                    )}
                  </div>

                  {/* Task due-date chips (Issue #8): pure due_date maps to this date cell */}
                  {cellTasks.length > 0 && (
                    <div className="mt-0.5 flex w-full flex-col gap-0.5">
                      {cellTasks.slice(0, MAX_VISIBLE_TASKS_PER_CELL).map((task) => (
                        <button
                          key={`task-${dateStr}-${task.id}`}
                          type="button"
                          data-testid={`calendar-cell-task-${dateStr}-${task.id}`}
                          data-completed={task.completedAt ? 'true' : 'false'}
                          title={`待辦：${task.title}${task.completedAt ? '（已完成）' : ''}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenTasksForDate(dateStr);
                          }}
                          className={`flex w-full items-center gap-1 rounded-xs border border-amber-200 bg-amber-50 px-1 py-0.5 text-left text-[10px] leading-tight hover:bg-amber-100 ${
                            task.completedAt ? 'text-slate-400 line-through' : 'text-amber-900'
                          }`}
                        >
                          <span aria-hidden="true">{task.completedAt ? '☑' : '☐'}</span>
                          <span className="truncate">{task.title}</span>
                        </button>
                      ))}
                      {cellTasks.length > MAX_VISIBLE_TASKS_PER_CELL && (
                        <button
                          type="button"
                          data-testid={`calendar-cell-more-tasks-${dateStr}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenTasksForDate(dateStr);
                          }}
                          className="w-full rounded-xs bg-amber-100 px-1 py-0.5 text-center text-[10px] font-semibold text-amber-900 hover:bg-amber-200"
                        >
                          +{cellTasks.length - MAX_VISIBLE_TASKS_PER_CELL} 待辦
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Lunar & Holiday Disclaimer Footer under Month Grid (Review D5 / UX.md / PR #26 Follow-up) */}
          <div
            data-testid="calendar-lunar-disclaimer"
            className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200/80 bg-slate-50 px-3 py-2 text-[11px] text-slate-600"
          >
            <span>
              🌕 <strong>農曆與節慶顯示（支援西元 {MIN_CALENDAR_YEAR}–{MAX_CALENDAR_YEAR}）：</strong>
              {LUNAR_AND_HOLIDAY_PROVENANCE.officialHolidaySource.disclaimer}
              （資料版本：
              <code>{LUNAR_AND_HOLIDAY_PROVENANCE.officialHolidaySource.datasetVersion}</code>
              ，更新日：{LUNAR_AND_HOLIDAY_PROVENANCE.officialHolidaySource.lastUpdatedDate}，
              <a
                href={LUNAR_AND_HOLIDAY_PROVENANCE.officialHolidaySource.referenceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-indigo-700 underline hover:no-underline"
              >
                行政院人事行政總處參考來源
              </a>
              ）
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
                    {eventsError && (
                      <div
                        role="alert"
                        data-testid="events-api-error"
                        className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700"
                      >
                        {eventsError}
                      </div>
                    )}

                    {/* Issue #7 Requirement #3: Direct Event Detail Inspector when an event bar is clicked */}
                    {selectedEvent && formMode === null && (
                      <div
                        data-testid="event-detail-panel"
                        data-event-id={selectedEvent.id}
                        className="rounded-xl border-2 border-indigo-600 bg-indigo-50/40 p-3.5 text-xs shadow-2xs space-y-2.5"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2 border-b border-indigo-200/80 pb-2">
                          <div>
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="rounded-xs bg-indigo-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                                事件詳情
                              </span>
                              <span
                                data-testid="event-detail-scope-badge"
                                className="rounded-xs bg-white px-1.5 py-0.5 text-[10px] font-semibold text-indigo-900 border border-indigo-200"
                              >
                                {selectedEvent.scope === 'personal'
                                  ? '個人空間'
                                  : currentSpaceLabel}
                              </span>
                              <span
                                data-testid="event-detail-all-day-badge"
                                className="rounded-xs bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700"
                              >
                                {selectedEvent.allDay ? '全天事件 (純日期)' : '具時間事件 (UTC + 時區)'}
                              </span>
                            </div>
                            <h4
                              data-testid="event-detail-title"
                              className="mt-1.5 text-sm font-bold text-slate-900"
                            >
                              {selectedEvent.title}
                            </h4>
                          </div>

                          <button
                            type="button"
                            data-testid="event-detail-close-btn"
                            onClick={() =>
                              onChangeNavState(clearSelectedCalendarEvent(navState))
                            }
                            className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                          >
                            ✕ 返回當日摘要
                          </button>
                        </div>

                        <dl className="space-y-1.5 text-slate-700">
                          <div>
                            <dt className="inline font-semibold text-slate-600">
                              時間安排：
                            </dt>
                            <dd
                              data-testid="event-detail-time-range"
                              className="inline font-mono"
                            >
                              {selectedEvent.allDay
                                ? `${selectedEvent.startsAt} ～ ${selectedEvent.endsAt}`
                                : `${formatInstantToLocalDate(selectedEvent.startsAt, selectedEvent.timezone)} ${formatInstantToLocalTimeLabel(selectedEvent.startsAt, selectedEvent.timezone)} ～ ${formatInstantToLocalDate(selectedEvent.endsAt, selectedEvent.timezone)} ${formatInstantToLocalTimeLabel(selectedEvent.endsAt, selectedEvent.timezone)} (${selectedEvent.timezone})`}
                            </dd>
                          </div>

                          <div>
                            <dt className="inline font-semibold text-slate-600">
                              對應月曆日期格：
                            </dt>
                            <dd
                              data-testid="event-detail-occupied-dates"
                              className="inline font-mono text-indigo-900"
                            >
                              {resolveEventCalendarDates(
                                selectedEvent,
                                selectedEvent.timezone || timezone,
                              ).join('、')}
                            </dd>
                          </div>

                          <div>
                            <dt className="inline font-semibold text-slate-600">
                              事件說明：
                            </dt>
                            <dd
                              data-testid="event-detail-description"
                              className="inline text-slate-800"
                            >
                              {selectedEvent.description || '（無說明）'}
                            </dd>
                          </div>
                        </dl>

                        {/* Issue #7 Requirement #4: Source Message Status (`none` / `accessible` / `deleted` / `inaccessible`) */}
                        <div
                          data-testid="event-detail-source-section"
                          data-source-status={selectedEvent.sourceStatus}
                          className="rounded-lg border border-slate-200 bg-white p-2.5 text-[11px]"
                        >
                          <div className="font-semibold text-slate-700">
                            💬 來源聊天訊息關聯（<code>source_message_id</code>）：
                          </div>

                          {selectedEvent.sourceStatus === 'none' && (
                            <p
                              data-testid="event-detail-source-none"
                              className="mt-1 text-slate-500"
                            >
                              無來源訊息（直接於行事曆建立）
                            </p>
                          )}

                          {selectedEvent.sourceStatus === 'accessible' &&
                            selectedEvent.sourceMessage && (
                              <div
                                data-testid="event-detail-source-accessible"
                                className="mt-1.5 space-y-1.5"
                              >
                                <p className="rounded-md bg-slate-50 p-2 text-slate-800 border border-slate-100">
                                  「{selectedEvent.sourceMessage.body}」
                                  <span className="ml-2 font-mono text-[10px] text-slate-500">
                                    ({selectedEvent.sourceMessage.localDate})
                                  </span>
                                </p>
                                <button
                                  type="button"
                                  data-testid="event-detail-jump-source-btn"
                                  onClick={() => handleJumpToSourceMessage(selectedEvent)}
                                  className="rounded-md bg-indigo-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-indigo-700"
                                >
                                  查看來源聊天 ➔
                                </button>
                              </div>
                            )}

                          {selectedEvent.sourceStatus === 'deleted' && (
                            <p
                              data-testid="event-detail-source-deleted"
                              className="mt-1 font-medium text-amber-800"
                            >
                              ⚠️ 原訊息已移除（來源訊息軟刪除不影響本事件獨立存在）
                            </p>
                          )}

                          {selectedEvent.sourceStatus === 'inaccessible' && (
                            <p
                              data-testid="event-detail-source-inaccessible"
                              className="mt-1 font-medium text-rose-700"
                            >
                              🔒 無權限存取來源訊息（您可能非該聊天空間成員或已退出）
                            </p>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                          <button
                            type="button"
                            data-testid="event-detail-edit-btn"
                            disabled={formSubmitting}
                            onClick={() => openEditFormForEvent(selectedEvent)}
                            className="rounded-lg border border-indigo-300 bg-white px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-50"
                          >
                            ✏️ 編輯事件
                          </button>
                          <button
                            type="button"
                            data-testid="event-detail-delete-btn"
                            disabled={formSubmitting}
                            onClick={() => void handleDeleteEvent(selectedEvent.id)}
                            className="rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50"
                          >
                            🗑️ 刪除事件
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Create / Edit Event Form (Issue #7 Requirement #1 & #4) */}
                    {formMode !== null && (
                      <form
                        data-testid="event-crud-form"
                        onSubmit={(e) => void handleSubmitEventForm(e)}
                        className="rounded-xl border border-indigo-200 bg-white p-3.5 text-xs shadow-2xs space-y-3"
                      >
                        <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                          <h4 className="font-bold text-slate-900">
                            {formMode === 'create'
                              ? `➕ 新增行事曆事件（${currentSpaceLabel}）`
                              : `✏️ 編輯行事曆事件（${currentSpaceLabel}）`}
                          </h4>
                          <button
                            type="button"
                            data-testid="event-form-cancel-btn"
                            onClick={() => {
                              setFormMode(null);
                              setEditingEventId(null);
                              setFormError(null);
                            }}
                            className="text-slate-500 hover:text-slate-800"
                          >
                            取消
                          </button>
                        </div>

                        {formError && (
                          <div
                            role="alert"
                            data-testid="event-form-error"
                            className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700"
                          >
                            {formError}
                          </div>
                        )}

                        <div>
                          <label
                            htmlFor="event-form-title"
                            className="block font-semibold text-slate-700"
                          >
                            事件標題 *
                          </label>
                          <input
                            id="event-form-title"
                            type="text"
                            data-testid="event-form-title-input"
                            placeholder="例如：家庭聚餐、繳水電費、牙醫預約..."
                            value={formTitle}
                            onChange={(e) => setFormTitle(e.target.value)}
                            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-indigo-600 focus:outline-hidden"
                          />
                        </div>

                        <div>
                          <label
                            htmlFor="event-form-description"
                            className="block font-semibold text-slate-700"
                          >
                            說明（選填）
                          </label>
                          <textarea
                            id="event-form-description"
                            rows={2}
                            data-testid="event-form-description-input"
                            placeholder="輸入補充備註或地點..."
                            value={formDescription}
                            onChange={(e) => setFormDescription(e.target.value)}
                            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-indigo-600 focus:outline-hidden"
                          />
                        </div>

                        <div className="flex items-center gap-2">
                          <input
                            id="event-form-all-day"
                            type="checkbox"
                            data-testid="event-form-all-day-checkbox"
                            checked={formAllDay}
                            onChange={(e) => handleToggleAllDayInForm(e.target.checked)}
                            className="h-4 w-4 rounded border-slate-300 text-indigo-600"
                          />
                          <label
                            htmlFor="event-form-all-day"
                            className="font-semibold text-slate-700"
                          >
                            全天事件（<code>all_day = true</code>，以純日期 YYYY-MM-DD 保存，不做 UTC 換日）
                          </label>
                        </div>

                        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                          <div>
                            <label
                              htmlFor="event-form-starts-at"
                              className="block font-semibold text-slate-700"
                            >
                              {formAllDay ? '開始日期 (YYYY-MM-DD)' : '開始時間'}
                            </label>
                            <input
                              id="event-form-starts-at"
                              type="text"
                              data-testid="event-form-starts-at-input"
                              placeholder={
                                formAllDay ? '2026-10-30' : '2026-10-30T09:00'
                              }
                              value={formStartsAt}
                              onChange={(e) => setFormStartsAt(e.target.value)}
                              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900 focus:border-indigo-600 focus:outline-hidden"
                            />
                          </div>

                          <div>
                            <label
                              htmlFor="event-form-ends-at"
                              className="block font-semibold text-slate-700"
                            >
                              {formAllDay ? '結束日期 (YYYY-MM-DD)' : '結束時間'}
                            </label>
                            <input
                              id="event-form-ends-at"
                              type="text"
                              data-testid="event-form-ends-at-input"
                              placeholder={
                                formAllDay ? '2026-10-30' : '2026-10-30T10:00'
                              }
                              value={formEndsAt}
                              onChange={(e) => setFormEndsAt(e.target.value)}
                              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900 focus:border-indigo-600 focus:outline-hidden"
                            />
                          </div>
                        </div>

                        {!formAllDay && (
                          <div>
                            <label
                              htmlFor="event-form-timezone"
                              className="block font-semibold text-slate-700"
                            >
                              事件時區 (IANA Timezone)
                            </label>
                            <input
                              id="event-form-timezone"
                              type="text"
                              data-testid="event-form-timezone-input"
                              value={formTimezone}
                              onChange={(e) => setFormTimezone(e.target.value)}
                              placeholder="Asia/Taipei"
                              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900 focus:border-indigo-600 focus:outline-hidden"
                            />
                          </div>
                        )}

                        <div className="flex items-center justify-end gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() => {
                              setFormMode(null);
                              setEditingEventId(null);
                              setFormError(null);
                            }}
                            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                          >
                            取消
                          </button>
                          <button
                            type="submit"
                            data-testid="event-form-submit-btn"
                            disabled={formSubmitting}
                            className="rounded-lg bg-indigo-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                          >
                            {formMode === 'create' ? '儲存新事件' : '儲存變更'}
                          </button>
                        </div>
                      </form>
                    )}

                    {/* Selected Date Summary & Events List */}
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 text-xs text-slate-700 space-y-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-semibold text-slate-900">
                          📌 {selectedDate} 單日摘要（{currentSpaceLabel}）
                        </p>
                        <button
                          type="button"
                          data-testid="open-create-event-form-btn"
                          onClick={() => openCreateFormForDate(selectedDate)}
                          className="rounded-md bg-indigo-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-indigo-700"
                        >
                          + 新增當日事件
                        </button>
                      </div>

                      <p className="text-slate-600">
                        農曆對照：
                        <strong className="text-slate-900">
                          {selectedDateLunar.fullLunarLabel}
                        </strong>
                        （該農曆月共 {selectedDateLunar.lunarMonthDayCount} 日
                        {selectedDateLunar.leapMonthOfYear
                          ? `，本農曆年含閏${selectedDateLunar.leapMonthOfYear}月`
                          : ''}
                        ）。點擊左側月曆任意日期空白處，即更新全域{' '}
                        <code>selectedDate</code> 並開啟本摘要面板；點選月曆格內的事件條則直接開啟該事件詳情。
                      </p>

                      {/* Day Events List in Summary */}
                      <div
                        data-testid="selected-date-events-list"
                        className="border-t border-slate-200/80 pt-2.5 space-y-1.5"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-slate-800">
                            📅 當日行程事件（{selectedDateEventBars.length} 筆）
                          </span>
                          {eventsLoading && (
                            <span className="text-[11px] text-slate-400">載入中...</span>
                          )}
                        </div>

                        {selectedDateEventBars.length === 0 ? (
                          <p
                            data-testid="selected-date-no-events"
                            className="text-[11px] text-slate-500"
                          >
                            當日尚無行程事件。可點選右上角「+ 新增當日事件」建立個人或家庭行程。
                          </p>
                        ) : (
                          <div className="space-y-1.5">
                            {selectedDateEventBars.map((bar) => {
                              const isSelectedBar = selectedEventId === bar.event.id;
                              return (
                                <button
                                  key={`summary-item-${bar.event.id}`}
                                  type="button"
                                  data-testid={`summary-event-item-${bar.event.id}`}
                                  onClick={() =>
                                    handleEventBarClick(bar.event.id, selectedDate)
                                  }
                                  className={`flex w-full items-center justify-between rounded-lg border px-2.5 py-1.5 text-left transition ${
                                    isSelectedBar
                                      ? 'border-indigo-600 bg-indigo-50 text-indigo-950'
                                      : 'border-slate-200 bg-white text-slate-800 hover:border-indigo-300'
                                  }`}
                                >
                                  <div className="min-w-0 flex-1">
                                    <span className="font-semibold">
                                      {bar.event.title}
                                    </span>
                                    {bar.event.description && (
                                      <span className="ml-2 text-[11px] text-slate-500">
                                        — {bar.event.description}
                                      </span>
                                    )}
                                  </div>
                                  <span className="ml-2 shrink-0 rounded-xs bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-medium text-slate-700">
                                    {bar.timeLabel}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Issue #8: tasks due on the selected date */}
                    <div
                      data-testid="selected-date-tasks-list"
                      className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 text-xs text-slate-700 space-y-1.5"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-slate-800">
                          ✅ 當日到期待辦（{selectedDateTasks.length} 筆）
                        </span>
                        {tasksLoading && (
                          <span className="text-[11px] text-slate-400">載入中...</span>
                        )}
                      </div>
                      {tasksError && (
                        <div
                          role="alert"
                          data-testid="summary-tasks-api-error"
                          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700"
                        >
                          {tasksError}
                        </div>
                      )}
                      {selectedDateTasks.length === 0 ? (
                        <p data-testid="selected-date-no-tasks" className="text-[11px] text-slate-500">
                          當日沒有到期的待辦。可前往「待辦」分頁新增。
                        </p>
                      ) : (
                        <ul className="space-y-1">
                          {selectedDateTasks.map((task) => (
                            <li
                              key={`summary-task-${task.id}`}
                              data-testid={`summary-task-item-${task.id}`}
                              data-completed={task.completedAt ? 'true' : 'false'}
                              className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5"
                            >
                              <input
                                type="checkbox"
                                aria-label={`${task.completedAt ? '取消完成' : '完成'}待辦：${task.title}`}
                                data-testid={`summary-task-toggle-${task.id}`}
                                checked={Boolean(task.completedAt)}
                                onChange={() =>
                                  void handleUpdateTaskInput(task.id, {
                                    completed: !task.completedAt,
                                  }).catch(() => undefined)
                                }
                                className="h-4 w-4 rounded border-slate-300 text-indigo-600"
                              />
                              <span
                                className={`font-semibold ${task.completedAt ? 'text-slate-400 line-through' : 'text-slate-900'}`}
                              >
                                {task.title}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
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
                          （支援西元 {MIN_CALENDAR_YEAR}–{MAX_CALENDAR_YEAR}）；國定假日採{' '}
                          {LUNAR_AND_HOLIDAY_PROVENANCE.officialHolidaySource.authority}（版本{' '}
                          <code>{LUNAR_AND_HOLIDAY_PROVENANCE.officialHolidaySource.datasetVersion}</code>
                          ）。{LUNAR_AND_HOLIDAY_PROVENANCE.mvpScopeBoundary.nonGoalNotice}
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
                  <ChatPanel
                    key="chat-panel-personal"
                    roomId="personal"
                    roomKind="personal"
                    roomLabel="個人心情聊天室"
                    selectedDate={selectedDate}
                    highlightedMessageId={highlightedSourceMessageId}
                    currentUserId={currentUserId}
                    currentUserRole={null}
                    messages={moodMessages}
                    loading={chatLoading}
                    error={chatError}
                    hasMoreBefore={chatHasMoreBefore}
                    hasMoreAfter={chatHasMoreAfter}
                    loadingEarlier={chatLoadingEarlier}
                    loadingLater={chatLoadingLater}
                    targetMessageFound={chatTargetMessageFound}
                    onLoadEarlier={onChatLoadEarlier}
                    onLoadLater={onChatLoadLater}
                    onSendMessage={handleSendChatMessage}
                    onDeleteMessage={handleDeleteChatMessage}
                  />
                )}

                {activeTab === 'chat' &&
                  (selectedSpace.kind === 'family' && selectedFamily ? (
                    <ChatPanel
                      key={`chat-panel-family-${selectedSpace.familyId}`}
                      roomId={selectedSpace.familyId}
                      roomKind="family"
                      roomLabel={`家庭聊天室（${selectedFamily.name}）`}
                      familyDisplayName={selectedFamily.name}
                      selectedDate={selectedDate}
                      highlightedMessageId={highlightedSourceMessageId}
                      currentUserId={currentUserId}
                      currentUserRole={selectedFamily.myRole}
                      messages={familyMessages}
                      loading={chatLoading}
                      error={chatError}
                      hasMoreBefore={chatHasMoreBefore}
                      hasMoreAfter={chatHasMoreAfter}
                      loadingEarlier={chatLoadingEarlier}
                      loadingLater={chatLoadingLater}
                      targetMessageFound={chatTargetMessageFound}
                      onLoadEarlier={onChatLoadEarlier}
                      onLoadLater={onChatLoadLater}
                      onSendMessage={handleSendChatMessage}
                      onDeleteMessage={handleDeleteChatMessage}
                    />
                  ) : (
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs text-slate-700 space-y-2">
                      <p className="font-semibold text-slate-900">
                        🏠 家庭聊天室（定位日期：{selectedDate}）
                      </p>
                      {highlightedSourceMessageId && (
                        <div
                          data-testid="chat-panel-source-message-locator"
                          data-source-message-id={highlightedSourceMessageId}
                          className="rounded-md border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-[11px] font-medium text-indigo-900"
                        >
                          📍 已定位至來源訊息：<code>{highlightedSourceMessageId}</code>（{selectedDate}）
                        </div>
                      )}
                      <p className="mt-1 text-amber-800">
                        您目前位於「個人空間」。請由頂端空間切換器選擇一個家庭空間以檢視該家庭聊天室，或切換至「心情」分頁記錄個人隨手記。
                      </p>
                    </div>
                  ))}

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
                  <TasksPanel
                    tasks={spaceScopedTasks}
                    selectedDate={selectedDate}
                    spaceLabel={currentSpaceLabel}
                    contextKey={spaceContextKey}
                    loading={tasksLoading}
                    error={tasksError}
                    onCreate={handleCreateTaskInput}
                    onUpdate={handleUpdateTaskInput}
                    onDelete={handleDeleteTaskInput}
                    onJumpToSource={handleJumpToSourceMessage}
                  />
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
