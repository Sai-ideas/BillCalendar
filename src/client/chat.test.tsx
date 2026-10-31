// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createInitialCalendarNavigationState,
  type CalendarNavigationState,
  type FamilySummary,
  type MessageWithAuthorizedDerived,
} from '../shared';
import { CalendarWorkspace } from './components/CalendarWorkspace';
import { ChatPanel } from './components/ChatPanel';

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
  {
    id: 'fam_02',
    name: '林家生活空間',
    createdBy: 'usr_charlie',
    myRole: 'member',
    memberCount: 3,
    createdAt: '2026-10-05T00:00:00.000Z',
    updatedAt: '2026-10-05T00:00:00.000Z',
  },
];

function makeMessage(
  overrides: Partial<MessageWithAuthorizedDerived> & Pick<MessageWithAuthorizedDerived, 'id' | 'body' | 'roomKind'>,
): MessageWithAuthorizedDerived {
  return {
    roomId: overrides.roomKind === 'personal' ? 'room_personal_alice' : 'room_fam_01',
    familyId: overrides.roomKind === 'family' ? 'fam_01' : null,
    senderUserId: 'usr_alice',
    senderDisplayName: '愛麗絲',
    localDate: '2026-10-30',
    recordDate: null,
    createdAt: '2026-10-30T10:00:00.000Z',
    updatedAt: '2026-10-30T10:00:00.000Z',
    derivedTasks: [],
    derivedEvents: [],
    derivedCount: 0,
    ...overrides,
  };
}

function ChatWorkspaceHarness({
  initialNav = createInitialCalendarNavigationState('2026-10-30'),
  initialMessages = [] as MessageWithAuthorizedDerived[],
  currentUserId = 'usr_alice',
}: {
  initialNav?: CalendarNavigationState;
  initialMessages?: MessageWithAuthorizedDerived[];
  currentUserId?: string;
}) {
  const [navState, setNavState] = useState<CalendarNavigationState>(initialNav);
  return (
    <CalendarWorkspace
      navState={navState}
      onChangeNavState={setNavState}
      families={FAMILIES}
      currentUserId={currentUserId}
      initialChatMessages={initialMessages}
    />
  );
}

describe('Issue #9 ChatPanel & CalendarWorkspace Mood/Chat Integration', () => {
  describe('Personal Mood Chat ("心情" Tab)', () => {
    it('renders personal mood room, supports text and emoji input, optional recordDate, and preserves emojis', async () => {
      const initialMoods = [
        makeMessage({
          id: 'msg_m1',
          body: '今天天氣晴朗 ☀️ 心情大好 😊',
          roomKind: 'personal',
          localDate: '2026-10-28',
          createdAt: '2026-10-28T09:00:00.000Z',
        }),
      ];

      render(<ChatWorkspaceHarness initialMessages={initialMoods} />);

      // Switch to '心情' tab
      fireEvent.click(screen.getByTestId('right-tab-mood'));
      expect(screen.getByTestId('right-tab-mood').getAttribute('aria-selected')).toBe('true');
      expect(screen.getByText(/個人心情聊天室/)).toBeTruthy();

      // Check existing message
      expect(screen.getByTestId('chat-message-msg_m1')).toBeTruthy();
      expect(screen.getByText('今天天氣晴朗 ☀️ 心情大好 😊')).toBeTruthy();

      // Type new message and use quick emoji button
      const input = screen.getByTestId('chat-message-input') as HTMLTextAreaElement;
      fireEvent.change(input, { target: { value: '發布第一則心情隨手記 ' } });
      fireEvent.click(screen.getByTestId('emoji-btn-🎉'));
      fireEvent.click(screen.getByTestId('emoji-btn-🚀'));
      expect(input.value).toBe('發布第一則心情隨手記 🎉🚀');

      // Set optional recordDate
      const recordDateInput = screen.getByTestId('chat-record-date-input') as HTMLInputElement;
      fireEvent.change(recordDateInput, { target: { value: '2026-10-25' } });

      // Send message
      fireEvent.click(screen.getByTestId('chat-send-button'));

      // New message appears in list
      await waitFor(() => {
        expect(screen.getByText('發布第一則心情隨手記 🎉🚀')).toBeTruthy();
      });

      // RecordDate badge is rendered
      expect(screen.getByText('📅 補記日：2026-10-25')).toBeTruthy();

      // Input fields are cleared after send
      expect(input.value).toBe('');
      expect(recordDateInput.value).toBe('');
    });

    it('supports deleting personal mood messages', async () => {
      const moodMsg = makeMessage({
        id: 'msg_del_test',
        body: '待刪除的心情文字 🗑️',
        roomKind: 'personal',
      });

      render(<ChatWorkspaceHarness initialMessages={[moodMsg]} />);
      fireEvent.click(screen.getByTestId('right-tab-mood'));

      expect(screen.getByTestId('chat-message-msg_del_test')).toBeTruthy();
      const deleteBtn = screen.getByTestId('delete-message-msg_del_test');
      fireEvent.click(deleteBtn);

      await waitFor(() => {
        expect(screen.queryByTestId('chat-message-msg_del_test')).toBeNull();
      });
    });
  });

  describe('Family Chat Room ("聊天" Tab)', () => {
    it('in personal space, chat tab instructs user to select a family space', () => {
      render(<ChatWorkspaceHarness />);
      fireEvent.click(screen.getByTestId('right-tab-chat'));

      expect(
        screen.getByText(/您目前位於「個人空間」。請由頂端空間切換器選擇一個家庭空間/i),
      ).toBeTruthy();
    });

    it('in family space, displays family room, and enforces admin vs member delete permissions', async () => {
      const familyMessages = [
        makeMessage({
          id: 'msg_fam_alice',
          body: '愛麗絲（管理員）：大家記得週日家庭聚會！🍲',
          roomKind: 'family',
          senderUserId: 'usr_alice',
          senderDisplayName: '愛麗絲',
          createdAt: '2026-10-30T10:00:00.000Z',
        }),
        makeMessage({
          id: 'msg_fam_bob',
          body: '鮑伯（成員）：好的一定準時出席！👍',
          roomKind: 'family',
          senderUserId: 'usr_bob',
          senderDisplayName: '鮑伯',
          createdAt: '2026-10-30T10:05:00.000Z',
        }),
      ];

      // 1. Render as Alice (family admin of fam_01)
      const { unmount } = render(
        <ChatWorkspaceHarness
          initialMessages={familyMessages}
          currentUserId="usr_alice"
          initialNav={{
            ...createInitialCalendarNavigationState('2026-10-30'),
            selectedSpace: { kind: 'family', familyId: 'fam_01' },
            activeTab: 'chat',
          }}
        />,
      );

      expect(screen.getByText(/目前顯示「陳家生活空間」的唯一家庭聊天室/)).toBeTruthy();
      expect(screen.getByTestId('chat-message-msg_fam_alice')).toBeTruthy();
      expect(screen.getByTestId('chat-message-msg_fam_bob')).toBeTruthy();

      // Alice is Admin -> can delete her own message AND Bob's message!
      expect(screen.getByTestId('delete-message-msg_fam_alice')).toBeTruthy();
      expect(screen.getByTestId('delete-message-msg_fam_bob')).toBeTruthy();

      // Alice deletes Bob's message using admin authority
      fireEvent.click(screen.getByTestId('delete-message-msg_fam_bob'));
      await waitFor(() => {
        expect(screen.queryByTestId('chat-message-msg_fam_bob')).toBeNull();
      });

      unmount();

      // 2. Render as Bob in a family where he is only a member (fam_02)
      const fam2Messages = [
        makeMessage({
          id: 'msg_fam2_charlie',
          body: '查理（管理員發送）',
          roomKind: 'family',
          familyId: 'fam_02',
          senderUserId: 'usr_charlie',
          senderDisplayName: '查理',
        }),
        makeMessage({
          id: 'msg_fam2_bob',
          body: '鮑伯（成員本人發送）',
          roomKind: 'family',
          familyId: 'fam_02',
          senderUserId: 'usr_bob',
          senderDisplayName: '鮑伯',
        }),
      ];

      render(
        <ChatWorkspaceHarness
          initialMessages={fam2Messages}
          currentUserId="usr_bob"
          initialNav={{
            ...createInitialCalendarNavigationState('2026-10-30'),
            selectedSpace: { kind: 'family', familyId: 'fam_02' },
            activeTab: 'chat',
          }}
        />,
      );

      expect(screen.getByText(/目前顯示「林家生活空間」的唯一家庭聊天室/)).toBeTruthy();

      // Member Bob can delete his OWN message
      expect(screen.getByTestId('delete-message-msg_fam2_bob')).toBeTruthy();
      // But Bob CANNOT delete Charlie's message (no delete button)
      expect(screen.queryByTestId('delete-message-msg_fam2_charlie')).toBeNull();
    });
  });

  describe('Source Message Locator & Error Handling', () => {
    it('highlights source message when locator is active', () => {
      const msg = makeMessage({
        id: 'msg_source_target',
        body: '關鍵來源訊息',
        roomKind: 'personal',
      });

      render(
        <ChatWorkspaceHarness
          initialMessages={[msg]}
          initialNav={{
            ...createInitialCalendarNavigationState('2026-10-30'),
            activeTab: 'mood',
            highlightedSourceMessageId: 'msg_source_target',
          }}
        />,
      );

      const locator = screen.getByTestId('chat-panel-source-message-locator');
      expect(locator.getAttribute('data-source-message-id')).toBe('msg_source_target');

      const msgCard = screen.getByTestId('chat-message-msg_source_target');
      expect(msgCard.getAttribute('data-highlighted')).toBe('true');
    });

    it('ChatPanel handles send validation error and external error banner', () => {
      render(
        <ChatPanel
          roomId="room_p"
          roomKind="personal"
          roomLabel="個人心情"
          selectedDate="2026-10-30"
          messages={[]}
          error="無法連線至聊天室"
          onSendMessage={async () => {}}
          onDeleteMessage={async () => {}}
        />,
      );

      expect(screen.getByRole('alert').textContent).toContain('無法連線至聊天室');

      // Attempt submit empty message
      fireEvent.click(screen.getByTestId('chat-send-button'));
      // Button disabled when empty
      expect(screen.getByTestId('chat-send-button').hasAttribute('disabled')).toBe(true);
    });
  });

  describe('Issue #10 Chat Timeline Date Dividers, Empty State, and Pagination', () => {
    it('renders date dividers between different localDates formatted in Traditional Chinese', () => {
      const messages = [
        makeMessage({
          id: 'msg_d1',
          body: '10月29日的筆記',
          localDate: '2026-10-29',
          createdAt: '2026-10-29T10:00:00.000Z',
          roomKind: 'personal',
        }),
        makeMessage({
          id: 'msg_d2',
          body: '10月30日的筆記',
          localDate: '2026-10-30',
          createdAt: '2026-10-30T10:00:00.000Z',
          roomKind: 'personal',
        }),
      ];

      render(
        <ChatPanel
          roomId="room_p"
          roomKind="personal"
          roomLabel="個人心情"
          selectedDate="2026-10-30"
          messages={messages}
          onSendMessage={async () => {}}
          onDeleteMessage={async () => {}}
        />,
      );

      const dividers = screen.getAllByTestId('chat-date-divider');
      expect(dividers).toHaveLength(2);
      expect(dividers[0]?.textContent).toContain('2026年10月29日 星期四');
      expect(dividers[1]?.textContent).toContain('2026年10月30日 星期五');
    });

    it('shows friendly empty state notice when selectedDate has no messages in current timeline', () => {
      const messages = [
        makeMessage({
          id: 'msg_d1',
          body: '10月29日的筆記',
          localDate: '2026-10-29',
          createdAt: '2026-10-29T10:00:00.000Z',
          roomKind: 'personal',
        }),
      ];

      render(
        <ChatPanel
          roomId="room_p"
          roomKind="personal"
          roomLabel="個人心情"
          selectedDate="2026-10-31" // No messages on this date
          messages={messages}
          onSendMessage={async () => {}}
          onDeleteMessage={async () => {}}
        />,
      );

      const notice = screen.getByTestId('chat-selected-date-empty-notice');
      expect(notice.textContent).toContain('2026-10-31 尚無心情筆記，在今日記下一筆吧');
    });

    it('renders Load Earlier and Load Later pagination buttons and fires callbacks', async () => {
      let earlierCalled = false;
      let laterCalled = false;

      render(
        <ChatPanel
          roomId="room_p"
          roomKind="personal"
          roomLabel="個人心情"
          selectedDate="2026-10-30"
          messages={[
            makeMessage({ id: 'msg_mid', body: '中間訊息', roomKind: 'personal' }),
          ]}
          hasMoreBefore={true}
          hasMoreAfter={true}
          onLoadEarlier={async () => {
            earlierCalled = true;
          }}
          onLoadLater={async () => {
            laterCalled = true;
          }}
          onSendMessage={async () => {}}
          onDeleteMessage={async () => {}}
        />,
      );

      const earlierBtn = screen.getByTestId('chat-load-earlier-button');
      const laterBtn = screen.getByTestId('chat-load-later-button');

      expect(earlierBtn).toBeTruthy();
      expect(laterBtn).toBeTruthy();

      fireEvent.click(earlierBtn);
      expect(earlierCalled).toBe(true);

      fireEvent.click(laterBtn);
      expect(laterCalled).toBe(true);
    });
  });

  describe('Issue #28 Source Message Scroll Focus & Graceful Degradation', () => {
    it('scrolls into view when highlightedMessageId exists in message list', async () => {
      const scrollIntoViewMock = vi.fn();
      // jsdom does not define scrollIntoView by default
      Element.prototype.scrollIntoView = scrollIntoViewMock;

      const targetMsg = makeMessage({
        id: 'msg_target_focus',
        body: '聚焦目標訊息',
        roomKind: 'personal',
      });

      render(
        <ChatPanel
          roomId="room_p"
          roomKind="personal"
          roomLabel="個人心情"
          selectedDate="2026-10-30"
          highlightedMessageId="msg_target_focus"
          messages={[targetMsg]}
          onSendMessage={async () => {}}
          onDeleteMessage={async () => {}}
        />,
      );

      await waitFor(() => {
        expect(scrollIntoViewMock).toHaveBeenCalled();
      });
    });

    it('displays graceful degradation alert when source message is missing or deleted', () => {
      render(
        <ChatPanel
          roomId="room_p"
          roomKind="personal"
          roomLabel="個人心情"
          selectedDate="2026-10-30"
          highlightedMessageId="msg_deleted_or_missing"
          targetMessageFound={false}
          messages={[
            makeMessage({ id: 'msg_other', body: '其他筆記', roomKind: 'personal' }),
          ]}
          onSendMessage={async () => {}}
          onDeleteMessage={async () => {}}
        />,
      );

      const alert = screen.getByTestId('chat-source-missing-alert');
      expect(alert.textContent).toContain('來源訊息已遭移除、不存在或無存取權限');
      expect(alert.textContent).toContain('已為您安全切換至接近日期');
      expect(screen.getByTestId('chat-message-msg_other')).toBeTruthy();
    });
  });

});
