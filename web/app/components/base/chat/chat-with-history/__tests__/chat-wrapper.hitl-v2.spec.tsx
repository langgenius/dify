import type { ChatConfig, ChatItemInTree } from '../../types'
import type { ChatWithHistoryContextValue } from '../context'
import type { AppData } from '@/models/share'
import type { HumanInputFormData } from '@/types/workflow'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { onTestFinished } from 'vite-plus/test'
import { UserActionButtonType } from '@/app/components/workflow/nodes/human-input/types'
import { InputVarType, WorkflowRunningStatus } from '@/app/components/workflow/types'
// oxlint-disable-next-line no-restricted-imports -- Exercise the existing chat SSE transport at its network boundary.
import { sseGet } from '@/service/base'
import { submitWebAppHumanInputForm } from '@/service/webapp-human-input'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { createChatConfigFixture } from '@/test/fixtures/chat'
import {
  createHumanInputFormFixture,
  createWorkflowProcessFixture,
} from '@/test/fixtures/workflow-process'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import ChatWrapper from '../chat-wrapper'
import { ChatWithHistoryContext } from '../context'

// oxlint-disable-next-line typescript/no-deprecated -- Existing workflow event transport boundary.
const workflowEvents = vi.mocked(sseGet)

vi.mock('@/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/config')>()),
  ENABLE_HITL_IM: true,
}))
vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({ token: 'test-token' }),
}))
vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  sseGet: vi.fn(),
  ssePost: vi.fn(),
}))
vi.mock('@/service/webapp-human-input', () => ({
  submitWebAppHumanInputForm: vi.fn().mockResolvedValue(undefined),
}))

const createForm = (formVersion: HumanInputFormData['form_version']): HumanInputFormData =>
  createHumanInputFormFixture({
    form_version: formVersion,
    form_token: 'form-token',
    node_title: 'Approval',
    form_content: '{{#$output.review#}}',
    inputs: [
      {
        type: InputVarType.paragraph,
        output_variable_name: 'review',
        default: { type: 'constant', value: '', selector: [] },
      },
    ],
    actions: [{ id: 'approve', title: 'Approve', button_style: UserActionButtonType.Primary }],
  })

const pausedConversation = (formVersion: HumanInputFormData['form_version']): ChatItemInTree[] => [
  {
    id: 'question',
    content: 'Please review',
    isAnswer: false,
    children: [
      {
        id: 'paused-answer',
        content: '',
        isAnswer: true,
        parentMessageId: 'question',
        workflow_run_id: 'run-1',
        workflowProcess: createWorkflowProcessFixture({ status: WorkflowRunningStatus.Paused }),
        humanInputFormDataList: [createForm(formVersion)],
      },
    ],
  },
]

const createContext = (
  formVersion: HumanInputFormData['form_version'],
): ChatWithHistoryContextValue => ({
  appData: {
    app_id: 'app-1',
    mode: 'advanced-chat',
    custom_config: null,
    site: { title: 'Test Chat' },
  } as AppData,
  appParams: createChatConfigFixture() as ChatConfig,
  appMeta: { tool_icons: {} },
  currentConversationId: 'conversation-1',
  currentConversationItem: {
    id: 'conversation-1',
    name: 'Conversation',
    inputs: {},
    introduction: '',
  },
  appPrevChatTree: pausedConversation(formVersion),
  newConversationInputs: {},
  newConversationInputsRef: { current: {} },
  inputsForms: [],
  isInstalledApp: false,
  currentChatInstanceRef: { current: { handleStop: vi.fn() } },
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
  handleStartChat: (callback) => callback?.(),
  handleChangeConversation: vi.fn(),
  handleNewConversationCompleted: vi.fn(),
  handleFeedback: vi.fn().mockResolvedValue(undefined),
  pinnedConversationList: [],
  chatShouldReloadKey: '',
  isMobile: false,
  currentConversationInputs: {},
  setCurrentConversationInputs: vi.fn(),
  allInputsHidden: false,
  appId: 'app-1',
})

const renderSubject = (formVersion: HumanInputFormData['form_version']) => {
  renderWithConsoleQuery(
    // oxlint-disable-next-line eslint-react/no-context-provider -- use-context-selector requires its Provider component.
    <ChatWithHistoryContext.Provider value={createContext(formVersion)}>
      <ChatWrapper />
    </ChatWithHistoryContext.Provider>,
  )
  return userEvent.setup()
}

describe('ChatWithHistory human-input submission', () => {
  beforeEach(() => {
    const stopGuard = guardUnexpectedFetch()
    onTestFinished(stopGuard)
  })

  it.each(['1', '2', undefined] as const)(
    'submits Web App form version %s only after the real workflow stream is ready',
    async (formVersion) => {
      const user = renderSubject(formVersion)
      await user.type(await screen.findByRole('textbox', { name: 'review' }), 'Approved')
      await user.click(screen.getByRole('button', { name: 'Approve' }))
      expect(submitWebAppHumanInputForm).not.toHaveBeenCalled()

      await waitFor(() => expect(workflowEvents).toHaveBeenCalledOnce())
      act(() =>
        workflowEvents.mock.calls[0]![2].onWorkflowPaused?.({
          task_id: 'task-1',
          workflow_run_id: 'run-1',
          event: 'workflow_paused',
          data: {
            workflow_run_id: 'run-1',
            outputs: {},
            paused_nodes: ['human-input'],
            reasons: [],
          },
        }),
      )

      await waitFor(() =>
        expect(submitWebAppHumanInputForm).toHaveBeenCalledExactlyOnceWith(
          'form-token',
          { inputs: { review: 'Approved' }, action: 'approve' },
          formVersion,
        ),
      )
    },
  )
})
