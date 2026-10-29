import type { ChatConfig } from '../../types'
import type { ChatWithHistoryContextValue } from '../context'
import type { AppData, AppMeta, ConversationItem } from '@/models/share'
import type { HumanInputFormData } from '@/types/workflow'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { submitWebAppHumanInputForm } from '@/service/webapp-human-input'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { useChat } from '../../chat/hooks'
import ChatWrapper from '../chat-wrapper'
import { useChatWithHistoryContext } from '../context'

vi.mock('@/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/config')>()),
  ENABLE_HITL_IM: true,
}))

const mockTrackEvent = vi.hoisted(() => vi.fn())

vi.mock('@/app/components/base/amplitude/web-app-event', () => ({
  trackWebAppEvent: mockTrackEvent,
}))

vi.mock('../../chat/hooks', () => ({
  useChat: vi.fn(),
}))

vi.mock('../context', () => ({
  useChatWithHistoryContext: vi.fn(),
}))

vi.mock('@/next/navigation', () => ({
  useRouter: vi.fn(() => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  })),
  usePathname: vi.fn(() => '/'),
  useSearchParams: vi.fn(() => new URLSearchParams()),
  useParams: vi.fn(() => ({ token: 'test-token' })),
}))

vi.mock('../../utils', () => ({
  isValidGeneratedAnswer: vi.fn(),
  getLastAnswer: vi.fn(),
}))

vi.mock('@/service/share', () => ({
  fetchChatList: vi.fn(),
  fetchSuggestedQuestions: vi.fn(),
  getUrl: vi.fn(() => 'mock-url'),
  stopChatMessageResponding: vi.fn(),
  submitHumanInputForm: vi.fn(),
  AppSourceType: {
    installedApp: 'installedApp',
    webApp: 'webApp',
  },
}))

vi.mock('@/service/workflow', () => ({
  submitHumanInputForm: vi.fn(),
}))

vi.mock('@/service/webapp-human-input', () => ({
  submitWebAppHumanInputForm: vi.fn(),
}))

vi.mock('@/app/components/base/markdown', () => ({
  Markdown: ({ content }: { content: string }) => <div>{content}</div>,
}))

vi.mock('@/utils/model-config', () => ({
  formatBooleanInputs: vi.fn((forms, inputs) => inputs),
}))

vi.mock('@/hooks/use-timestamp', () => ({
  default: () => ({
    formatTime: (timestamp: number) => `formatted-${timestamp}`,
    formatDate: (value: string) => `formatted-${value}`,
  }),
}))

type ChatHookReturn = ReturnType<typeof useChat>

const mockAppData = {
  mode: 'advanced-chat',
  site: {
    title: 'Test Chat',
    chat_color_theme: 'blue',
    icon_type: 'image',
    icon: 'test-icon',
    icon_background: '#000000',
    icon_url: 'https://example.com/icon.png',
    use_icon_as_answer_icon: false,
  },
} as unknown as AppData

const defaultContextValue: ChatWithHistoryContextValue = {
  appData: mockAppData,
  appParams: {
    system_parameters: { vision_config: { enabled: true } },
    opening_statement: 'Default opening statement',
  } as unknown as ChatConfig,
  appMeta: { tool_icons: {} } as unknown as AppMeta,
  currentConversationId: '1',
  currentConversationItem: { id: '1', name: 'Conv 1' } as unknown as ConversationItem,
  appPrevChatTree: [],
  newConversationInputs: {},
  newConversationInputsRef: {
    current: {},
  } as ChatWithHistoryContextValue['newConversationInputsRef'],
  inputsForms: [],
  isInstalledApp: false,
  currentChatInstanceRef: {
    current: { handleStop: vi.fn() },
  } as ChatWithHistoryContextValue['currentChatInstanceRef'],
  setIsResponding: vi.fn(),
  setClearChatList: vi.fn(),
  appChatListDataLoading: false,
  conversationList: [],
  sidebarCollapseState: false,
  handleSidebarCollapse: vi.fn(),
  handlePinConversation: vi.fn(),
  handleUnpinConversation: vi.fn(),
  handleDeleteConversation: vi.fn(),
  conversationRenaming: false,
  handleRenameConversation: vi.fn(),
  handleNewConversation: vi.fn(),
  handleNewConversationInputsChange: vi.fn(),
  handleStartChat: vi.fn(),
  handleChangeConversation: vi.fn(),
  handleNewConversationCompleted: vi.fn(),
  handleFeedback: vi.fn(),
  pinnedConversationList: [],
  chatShouldReloadKey: '',
  isMobile: false,
  currentConversationInputs: null,
  setCurrentConversationInputs: vi.fn(),
  allInputsHidden: false,
  initUserVariables: undefined,
  appId: 'test-app-id',
}

const defaultChatHookReturn: Partial<ChatHookReturn> = {
  chatList: [],
  handleSend: vi.fn(),
  handleStop: vi.fn(),
  handleSwitchSibling: vi.fn(),
  prepareHumanInputSubmission: vi.fn().mockResolvedValue(true),
  isResponding: false,
  suggestedQuestions: [],
}

describe('ChatWrapper', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useChatWithHistoryContext).mockReturnValue(defaultContextValue)
    vi.mocked(useChat).mockReturnValue(defaultChatHookReturn as ChatHookReturn)
  })

  it.each(['1', '2', undefined] as const)(
    'submits Web App forms with event version %s',
    async (formVersion) => {
      vi.mocked(useChatWithHistoryContext).mockReturnValue({
        ...defaultContextValue,
        isInstalledApp: false,
      })

      vi.mocked(useChat).mockReturnValue({
        ...defaultChatHookReturn,
        chatList: [
          { id: 'q1', content: 'Question' },
          {
            id: 'a1',
            isAnswer: true,
            content: '',
            humanInputFormDataList: [
              {
                id: 'node1',
                form_id: 'form1',
                form_token: 'token-web-1',
                form_version: formVersion,
                node_id: 'node1',
                node_title: 'Node Web 1',
                display_in_ui: true,
                form_content: '{{#$output.test#}}',
                inputs: [
                  {
                    variable: 'test',
                    label: 'Test',
                    type: 'paragraph',
                    required: true,
                    output_variable_name: 'test',
                    default: { type: 'text', value: '' },
                  },
                ],
                actions: [{ id: 'run', title: 'Run', button_style: 'primary' }],
              },
            ] as unknown as HumanInputFormData[],
          },
        ],
      } as unknown as ChatHookReturn)

      render(<ChatWrapper />)
      expect(await screen.findByText('Node Web 1'))!.toBeInTheDocument()

      const input =
        screen.getAllByRole('textbox').find((el) => el.closest('.chat-answer-container')) ||
        screen.getAllByRole('textbox')[0]
      fireEvent.change(input!, { target: { value: 'web-test' } })
      fireEvent.click(screen.getByText('Run'))

      await waitFor(() => {
        expect(submitWebAppHumanInputForm).toHaveBeenCalledWith(
          'token-web-1',
          {
            inputs: { test: 'web-test' },
            action: 'run',
          },
          formVersion,
        )
      })
    },
  )
})
