// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CreateTaskRequestSchema,
  UpdateTaskRequestSchema,
  buildTasksByDueDateMap,
  createInitialCalendarNavigationState,
  openCalendarTasksForDate,
  type CalendarNavigationState,
  type FamilySummary,
  type TaskDetail,
} from '../shared';
import { CalendarWorkspace } from './components/CalendarWorkspace';
import { TasksPanel } from './components/TasksPanel';

afterEach(() => {
  cleanup();
});

const FAMILIES: FamilySummary[] = [
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

function makeTask(overrides: Partial<TaskDetail> & Pick<TaskDetail, 'id' | 'title'>): TaskDetail {
  return {
    listId: 'list_p1',
    scope: 'personal',
    ownerUserId: 'usr_alice',
    familyId: null,
    dueDate: null,
    completedAt: null,
    sourceMessageId: null,
    sourceStatus: 'none',
    sourceMessage: null,
    createdBy: 'usr_alice',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

function Harness({ initialTasks = [] as TaskDetail[] }: { initialTasks?: TaskDetail[] }) {
  const [navState, setNavState] = useState<CalendarNavigationState>(() =>
    createInitialCalendarNavigationState('2026-10-30'),
  );
  return (
    <CalendarWorkspace
      navState={navState}
      onChangeNavState={setNavState}
      families={FAMILIES}
      currentUserId="usr_alice"
      initialTasks={initialTasks}
    />
  );
}

describe('Issue #8 Personal & Family Tasks', () => {
  describe('shared rules', () => {
    it('maps only valid pure due_date values onto date cells without timezone shifting (D4)', () => {
      const map = buildTasksByDueDateMap([
        makeTask({ id: 't_b', title: 'B', dueDate: '2026-10-31', createdAt: '2026-10-02T00:00:00.000Z' }),
        makeTask({ id: 't_a_done', title: 'A done', dueDate: '2026-10-31', completedAt: '2026-10-03T00:00:00.000Z' }),
        makeTask({ id: 't_a', title: 'A', dueDate: '2026-10-31', createdAt: '2026-10-01T00:00:00.000Z' }),
        makeTask({ id: 't_none', title: 'no date', dueDate: null }),
        makeTask({ id: 't_bad', title: 'bad', dueDate: '2026-02-30' }),
      ]);
      expect(Object.keys(map)).toEqual(['2026-10-31']);
      expect(map['2026-10-31']!.map((t) => t.id)).toEqual(['t_a', 't_b', 't_a_done']);
    });

    it('openCalendarTasksForDate selects the date, opens tasks tab and keeps selectedSpace', () => {
      const base: CalendarNavigationState = {
        ...createInitialCalendarNavigationState('2026-10-30'),
        selectedSpace: { kind: 'family', familyId: 'fam_01' },
      };
      const next = openCalendarTasksForDate(base, '2026-10-12', { openMobilePanel: true });
      expect(next.selectedDate).toBe('2026-10-12');
      expect(next.activeTab).toBe('tasks');
      expect(next.mobileView).toBe('panel');
      expect(next.selectedSpace).toEqual({ kind: 'family', familyId: 'fam_01' });
      expect(next.todayDate).toBe('2026-10-30');
    });

    it('validates due_date: null and valid dates pass; illegal calendar dates and formats are rejected', () => {
      const ok = (dueDate: unknown) =>
        CreateTaskRequestSchema.safeParse({ scope: 'personal', title: 't', dueDate }).success;
      expect(ok(null)).toBe(true);
      expect(ok(undefined)).toBe(true);
      expect(ok('2028-02-29')).toBe(true);
      expect(ok('2026-02-29')).toBe(false);
      expect(ok('2026-04-31')).toBe(false);
      expect(ok('2026-13-01')).toBe(false);
      expect(ok('2026/10/01')).toBe(false);
      expect(ok('2026-10-1')).toBe(false);
      expect(ok('2026-10-01T00:00:00Z')).toBe(false);
      expect(UpdateTaskRequestSchema.safeParse({ dueDate: null }).success).toBe(true);
      expect(UpdateTaskRequestSchema.safeParse({ dueDate: '2026-02-30' }).success).toBe(false);
      expect(UpdateTaskRequestSchema.safeParse({}).success).toBe(false);
    });
  });

  describe('CalendarWorkspace behaviour', () => {
    const TASKS: TaskDetail[] = [
      makeTask({ id: 't_dated', title: '繳電話費', dueDate: '2026-10-15' }),
      makeTask({ id: 't_undated', title: '整理書桌', dueDate: null }),
      makeTask({
        id: 't_family',
        title: '家庭大掃除',
        scope: 'family',
        ownerUserId: null,
        familyId: 'fam_01',
        listId: 'list_f1',
        dueDate: '2026-10-15',
      }),
      makeTask({
        id: 't_other_user',
        title: '別人的待辦',
        ownerUserId: 'usr_bob',
        dueDate: '2026-10-15',
      }),
    ];

    it('shows due-date tasks in the calendar cell and day summary, isolated by space and user', () => {
      render(<Harness initialTasks={TASKS} />);

      const cell = screen.getByTestId('calendar-cell-2026-10-15');
      expect(cell.getAttribute('data-task-count')).toBe('1');
      expect(within(cell).getByText('繳電話費')).toBeTruthy();
      expect(within(cell).queryByText('家庭大掃除')).toBeNull();
      expect(screen.queryByText('別人的待辦')).toBeNull();
      // undated tasks never show up in any date cell
      expect(screen.queryByTestId('calendar-cell-task-2026-10-30-t_undated')).toBeNull();
      expect(screen.queryAllByText('整理書桌')).toHaveLength(0);

      fireEvent.click(screen.getByTestId('calendar-cell-2026-10-15'));
      const summary = screen.getByTestId('selected-date-tasks-list');
      expect(within(summary).getByText('繳電話費')).toBeTruthy();
      expect(within(summary).queryByText('家庭大掃除')).toBeNull();

      fireEvent.click(screen.getByTestId('space-switch-family-fam_01'));
      const familyCell = screen.getByTestId('calendar-cell-2026-10-15');
      expect(within(familyCell).getByText('家庭大掃除')).toBeTruthy();
      expect(within(familyCell).queryByText('繳電話費')).toBeNull();
    });

    it('clicking a task chip selects its date and opens the tasks tab', () => {
      render(<Harness initialTasks={TASKS} />);
      fireEvent.click(screen.getByTestId('calendar-cell-task-2026-10-15-t_dated'));
      expect(screen.getByTestId('status-selected-date').textContent).toBe('2026-10-15');
      expect(screen.getByTestId('right-tabpanel-tasks')).toBeTruthy();
      expect(screen.getByTestId('tasks-group-selected-date').textContent).toContain('繳電話費');
    });

    it('supports create (undated + dated), validation, complete/uncomplete, edit, clear due date and delete', async () => {
      render(<Harness />);
      fireEvent.click(screen.getByTestId('right-tab-tasks'));

      // create undated
      fireEvent.click(screen.getByTestId('task-open-create-btn'));
      fireEvent.change(screen.getByTestId('task-form-title-input'), { target: { value: '買牛奶' } });
      fireEvent.click(screen.getByTestId('task-form-submit-btn'));
      await waitFor(() => expect(screen.getByTestId('tasks-group-undated').textContent).toContain('買牛奶'));

      // illegal due date keeps the form open with an error and creates nothing
      fireEvent.click(screen.getByTestId('task-open-create-btn'));
      fireEvent.change(screen.getByTestId('task-form-title-input'), { target: { value: '壞日期' } });
      fireEvent.change(screen.getByTestId('task-form-due-date-input'), { target: { value: '2026-02-30' } });
      fireEvent.click(screen.getByTestId('task-form-submit-btn'));
      expect((await screen.findByTestId('task-form-error')).textContent).toMatch(/無效|格式/);
      expect(screen.queryByText('壞日期', { selector: 'p' })).toBeNull();

      // empty title rejected
      fireEvent.change(screen.getByTestId('task-form-title-input'), { target: { value: '   ' } });
      fireEvent.change(screen.getByTestId('task-form-due-date-input'), { target: { value: '' } });
      fireEvent.click(screen.getByTestId('task-form-submit-btn'));
      expect((await screen.findByTestId('task-form-error')).textContent).toMatch(/標題/);

      // create dated for selected date via "use selected date"
      fireEvent.change(screen.getByTestId('task-form-title-input'), { target: { value: '今日繳費' } });
      fireEvent.click(screen.getByTestId('task-form-use-selected-date-btn'));
      fireEvent.click(screen.getByTestId('task-form-submit-btn'));
      await waitFor(() =>
        expect(screen.getByTestId('tasks-group-selected-date').textContent).toContain('今日繳費'),
      );
      const cell = screen.getByTestId('calendar-cell-2026-10-30');
      expect(cell.getAttribute('data-task-count')).toBe('1');

      // complete -> persisted visual state, uncomplete
      const dated = within(screen.getByTestId('tasks-group-selected-date')).getByTestId(/^task-item-/);
      const datedId = dated.getAttribute('data-testid')!.replace('task-item-', '');
      fireEvent.click(screen.getByTestId(`task-toggle-${datedId}`));
      await waitFor(() =>
        expect(screen.getByTestId(`task-item-${datedId}`).getAttribute('data-completed')).toBe('true'),
      );
      expect(screen.getByTestId(`task-completed-at-${datedId}`)).toBeTruthy();
      expect(
        screen.getByTestId(`calendar-cell-task-2026-10-30-${datedId}`).getAttribute('data-completed'),
      ).toBe('true');
      fireEvent.click(screen.getByTestId(`task-toggle-${datedId}`));
      await waitFor(() =>
        expect(screen.getByTestId(`task-item-${datedId}`).getAttribute('data-completed')).toBe('false'),
      );

      // edit: move to another date, then clear the date
      fireEvent.click(screen.getByTestId(`task-edit-${datedId}`));
      fireEvent.change(screen.getByTestId('task-form-title-input'), { target: { value: '改期繳費' } });
      fireEvent.change(screen.getByTestId('task-form-due-date-input'), { target: { value: '2026-10-20' } });
      fireEvent.click(screen.getByTestId('task-form-submit-btn'));
      await waitFor(() =>
        expect(screen.getByTestId('tasks-group-other').textContent).toContain('改期繳費'),
      );
      expect(screen.getByTestId('calendar-cell-2026-10-20').getAttribute('data-task-count')).toBe('1');
      expect(screen.getByTestId('calendar-cell-2026-10-30').getAttribute('data-task-count')).toBe('0');

      fireEvent.click(screen.getByTestId(`task-edit-${datedId}`));
      fireEvent.click(screen.getByTestId('task-form-clear-date-btn'));
      fireEvent.click(screen.getByTestId('task-form-submit-btn'));
      await waitFor(() =>
        expect(screen.getByTestId('tasks-group-undated').textContent).toContain('改期繳費'),
      );
      expect(screen.getByTestId('calendar-cell-2026-10-20').getAttribute('data-task-count')).toBe('0');

      // delete
      fireEvent.click(screen.getByTestId(`task-delete-${datedId}`));
      await waitFor(() => expect(screen.queryByTestId(`task-item-${datedId}`)).toBeNull());
    });

    it('shows source status (none / accessible / deleted / inaccessible) and keeps tasks when the source was soft-deleted', () => {
      const sourced: TaskDetail[] = [
        makeTask({ id: 't_none', title: '無來源' }),
        makeTask({
          id: 't_acc',
          title: '可存取來源',
          sourceMessageId: 'msg_1',
          sourceStatus: 'accessible',
          sourceMessage: {
            id: 'msg_1',
            roomId: 'room_p',
            roomKind: 'personal',
            familyId: null,
            senderUserId: 'usr_alice',
            body: '記得買菜',
            localDate: '2026-10-05',
            recordDate: null,
            createdAt: '2026-10-05T00:00:00.000Z',
          },
        }),
        makeTask({ id: 't_del', title: '來源已刪', sourceMessageId: 'msg_2', sourceStatus: 'deleted' }),
        makeTask({ id: 't_inacc', title: '來源無權', sourceMessageId: 'msg_3', sourceStatus: 'inaccessible' }),
      ];
      render(<Harness initialTasks={sourced} />);
      fireEvent.click(screen.getByTestId('right-tab-tasks'));

      expect(screen.queryByTestId('task-source-t_none')).toBeNull();
      expect(screen.getByTestId('task-source-t_acc').getAttribute('data-source-status')).toBe('accessible');
      expect(screen.getByTestId('task-source-t_acc').textContent).toContain('記得買菜');
      expect(screen.getByTestId('task-source-t_del').textContent).toContain('原訊息已移除');
      expect(screen.getByTestId('task-source-t_inacc').textContent).toContain('無權限');
      expect(screen.queryByTestId('task-jump-source-t_del')).toBeNull();
      expect(screen.queryByTestId('task-jump-source-t_inacc')).toBeNull();
      // deleted-source task is still fully operable
      expect(screen.getByTestId('task-toggle-t_del')).toBeTruthy();
      expect(screen.getByTestId('task-edit-t_del')).toBeTruthy();
    });

    it('jumps from a personal-space task to its family source chat and syncs selectedSpace / selectedDate', () => {
      const familySourced = makeTask({
        id: 't_jump',
        title: '來自家庭聊天的待辦',
        sourceMessageId: 'msg_fam',
        sourceStatus: 'accessible',
        sourceMessage: {
          id: 'msg_fam',
          roomId: 'room_f',
          roomKind: 'family',
          familyId: 'fam_01',
          senderUserId: 'usr_bob',
          body: '週末大掃除',
          localDate: '2026-10-08',
          recordDate: null,
          createdAt: '2026-10-08T00:00:00.000Z',
        },
      });
      render(<Harness initialTasks={[familySourced]} />);
      fireEvent.click(screen.getByTestId('right-tab-tasks'));
      fireEvent.click(screen.getByTestId('task-jump-source-t_jump'));

      expect(screen.getByTestId('status-selected-space').textContent).toContain('陳家生活空間');
      expect(screen.getByTestId('status-selected-date').textContent).toBe('2026-10-08');
      expect(screen.getByTestId('right-tabpanel-chat')).toBeTruthy();
      expect(
        screen.getByTestId('chat-panel-source-message-locator').getAttribute('data-source-message-id'),
      ).toBe('msg_fam');
    });

    it('Issue #31 acceptance: automatically resets unsent create drafts and errors on space / identity context switch', () => {
      const dummyProps = {
        tasks: [],
        selectedDate: '2026-10-30',
        spaceLabel: '個人空間',
        onCreate: async () => {},
        onUpdate: async () => {},
        onDelete: async () => {},
        onJumpToSource: () => {},
      };

      const { rerender } = render(<TasksPanel {...dummyProps} contextKey="usr_alice:personal" />);
      
      // 1. Open create form and enter an unsubmitted draft
      fireEvent.click(screen.getByTestId('task-open-create-btn'));
      expect(screen.getByTestId('task-crud-form')).toBeTruthy();

      const titleInput = screen.getByTestId('task-form-title-input') as HTMLInputElement;
      fireEvent.change(titleInput, { target: { value: '未送出的草稿待辦' } });
      expect(titleInput.value).toBe('未送出的草稿待辦');

      // Trigger a form error by entering invalid due date
      const dueInput = screen.getByTestId('task-form-due-date-input') as HTMLInputElement;
      fireEvent.change(dueInput, { target: { value: 'invalid-date' } });
      fireEvent.click(screen.getByTestId('task-form-submit-btn'));
      expect(screen.getByTestId('task-form-error')).toBeTruthy();

      // 2. Switch identity / space context by changing contextKey and spaceLabel
      rerender(
        <TasksPanel
          {...dummyProps}
          spaceLabel="家庭：陳家生活空間"
          contextKey="usr_alice:fam_01"
        />
      );

      // Form is closed and formError is reset
      expect(screen.queryByTestId('task-crud-form')).toBeNull();
      expect(screen.queryByTestId('task-form-error')).toBeNull();

      // 3. Reopen create form: fields are clean
      fireEvent.click(screen.getByTestId('task-open-create-btn'));
      const newTitleInput = screen.getByTestId('task-form-title-input') as HTMLInputElement;
      const newDueInput = screen.getByTestId('task-form-due-date-input') as HTMLInputElement;
      expect(newTitleInput.value).toBe('');
      expect(newDueInput.value).toBe('');
      expect(screen.queryByTestId('task-form-error')).toBeNull();
    });

    it('Issue #31 acceptance: CalendarWorkspace resets TasksPanel create draft when switching space', () => {
      render(<Harness initialTasks={[]} />);

      // Go to tasks tab in personal space
      fireEvent.click(screen.getByTestId('right-tab-tasks'));
      fireEvent.click(screen.getByTestId('task-open-create-btn'));

      const titleInput = screen.getByTestId('task-form-title-input') as HTMLInputElement;
      fireEvent.change(titleInput, { target: { value: '個人空間未送出草稿' } });
      expect(titleInput.value).toBe('個人空間未送出草稿');

      // Switch to family space
      fireEvent.click(screen.getByTestId('space-switch-family-fam_01'));

      // Check tasks tab in family space: create form is closed!
      expect(screen.queryByTestId('task-crud-form')).toBeNull();

      // Reopen in family space: clean draft
      fireEvent.click(screen.getByTestId('task-open-create-btn'));
      const freshTitleInput = screen.getByTestId('task-form-title-input') as HTMLInputElement;
      expect(freshTitleInput.value).toBe('');
    });
  });

  describe('Issue #11 Task Source Message Jump & Status Degradation', () => {
    it('displays source status states (accessible / deleted / inaccessible / none) and jumps to chat when accessible', async () => {
      const taskWithAccessibleSource: TaskDetail = makeTask({
        id: 'task_src_1',
        title: '記得買牛奶',
        sourceMessageId: 'msg_src_1',
        sourceStatus: 'accessible',
        sourceMessage: {
          id: 'msg_src_1',
          roomId: 'room_personal',
          roomKind: 'personal',
          familyId: null,
          localDate: '2026-10-25',
          recordDate: null,
          body: '冰箱沒牛奶了，下班買一下',
          senderUserId: 'usr_alice',
          createdAt: '2026-10-25T08:00:00.000Z',
        },
      });

      const taskWithDeletedSource: TaskDetail = makeTask({
        id: 'task_src_2',
        title: '繳水費',
        sourceMessageId: 'msg_del_1',
        sourceStatus: 'deleted',
        sourceMessage: null,
      });

      const taskWithInaccessibleSource: TaskDetail = makeTask({
        id: 'task_src_3',
        title: '前家庭重要代辦',
        sourceMessageId: 'msg_inacc_1',
        sourceStatus: 'inaccessible',
        sourceMessage: null,
      });

      const taskWithNoSource: TaskDetail = makeTask({
        id: 'task_src_4',
        title: '一般獨立待辦',
        sourceMessageId: null,
        sourceStatus: 'none',
        sourceMessage: null,
      });

      render(
        <Harness
          initialTasks={[
            taskWithAccessibleSource,
            taskWithDeletedSource,
            taskWithInaccessibleSource,
            taskWithNoSource,
          ]}
        />,
      );

      // Open tasks tab
      fireEvent.click(screen.getByTestId('right-tab-tasks'));

      // Check status blocks
      expect(screen.getByTestId('task-source-task_src_1')).toBeTruthy();
      expect(screen.getByTestId('task-source-task_src_1').textContent).toContain('冰箱沒牛奶了');
      expect(screen.getByTestId('task-jump-source-task_src_1')).toBeTruthy();

      expect(screen.getByTestId('task-source-task_src_2').textContent).toContain('原訊息已移除');
      expect(screen.getByTestId('task-source-task_src_3').textContent).toContain('無權限存取來源訊息');
      expect(screen.queryByTestId('task-source-task_src_4')).toBeNull();

      // Click "查看來源聊天 ➔"
      fireEvent.click(screen.getByTestId('task-jump-source-task_src_1'));

      // Navigates to personal mood chat tab, jumps to '2026-10-25' and highlights message
      await waitFor(() => {
        expect(screen.getByTestId('right-tab-mood').getAttribute('aria-selected')).toBe('true');
      });
      expect(screen.getByTestId('status-selected-date').textContent).toContain('2026-10-25');
      expect(screen.getByTestId('chat-panel-source-message-locator')).toBeTruthy();
    });
  });
});
