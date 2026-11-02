import type { ChatItemInTree } from '../../types'
import type { EmbeddedChatbotContextValue } from '../context'
import type { HumanInputFormData } from '@/types/workflow'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { onTestFinished } from 'vite-plus/test'
import { UserActionButtonType } from '@/app/components/workflow/nodes/human-input/types'
import { InputVarType, WorkflowRunningStatus } from '@/app/components/workflow/types'
// oxlint-disable-next-line no-restricted-imports -- Exercise the existing chat SSE transport at its network boundary.
import { sseGet } from '@/service/base'
import { AppSourceType, submitHumanInputForm } from '@/service/share'
import { submitWebAppHumanInputForm } from '@/service/webapp-human-input'
import { submitHumanInputForm as submitInstalledHumanInput } from '@/service/workflow'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { createChatConfigFixture } from '@/test/fixtures/chat'
import { createEmbeddedChatbotContextFixture } from '@/test/fixtures/embedded-chatbot'
import {
  createHumanInputFormFixture,
  createWorkflowProcessFixture,
} from '@/test/fixtures/workflow-process'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import ChatWrapper from '../chat-wrapper'
import { EmbeddedChatbotContext } from '../context'

// oxlint-disable-next-line typescript/no-deprecated -- Existing workflow event transport boundary.
const workflowEvents = vi.mocked(sseGet)

vi.mock('@/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/config')>()),
  ENABLE_HITL_IM: true,
}))
vi.mock('@/next/navigation', () => ({
  useParams: () => ({ token: 'share-code' }),
  usePathname: () => '/chat/share-code',
}))
vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  sseGet: vi.fn(),
  ssePost: vi.fn(),
}))
vi.mock('@/service/share', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/share')>()),
  submitHumanInputForm: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/service/workflow', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/workflow')>()),
  submitHumanInputForm: vi.fn().mockResolvedValue(undefined),
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

const renderSubject = (
  formVersion: HumanInputFormData['form_version'],
  overrides: Partial<EmbeddedChatbotContextValue>,
) => {
  const context = createEmbeddedChatbotContextFixture({
    appId: 'app-1',
    appData: {
      app_id: 'app-1',
      mode: 'chat',
      custom_config: null,
      site: { title: 'Embedded App', input_placeholder: 'Ask the assistant' },
    },
    appMeta: { tool_icons: {} },
    appParams: createChatConfigFixture(),
    currentConversationId: 'conversation-1',
    appPrevChatList: pausedConversation(formVersion),
    ...overrides,
  })
  renderWithConsoleQuery(
    // oxlint-disable-next-line eslint-react/no-context-provider -- use-context-selector requires its Provider component.
    <EmbeddedChatbotContext.Provider value={context}>
      <ChatWrapper />
    </EmbeddedChatbotContext.Provider>,
  )
  return userEvent.setup()
}

const confirmWorkflowReady = async () => {
  await waitFor(() => expect(workflowEvents).toHaveBeenCalledOnce())
  act(() =>
    workflowEvents.mock.calls[0]![2].onWorkflowPaused?.({
      task_id: 'task-1',
      workflow_run_id: 'run-1',
      event: 'workflow_paused',
      data: { workflow_run_id: 'run-1', outputs: {}, paused_nodes: ['human-input'], reasons: [] },
    }),
  )
}

const submitVisibleForm = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.type(await screen.findByRole('textbox', { name: 'review' }), 'Approved')
  await user.click(screen.getByRole('button', { name: 'Approve' }))
}

describe('EmbeddedChatbot human-input submission', () => {
  beforeEach(() => {
    const stopGuard = guardUnexpectedFetch()
    onTestFinished(stopGuard)
  })

  it.each(['1', '2', undefined] as const)(
    'submits installed-app form version %s after the workflow stream is ready',
    async (formVersion) => {
      const user = renderSubject(formVersion, { isInstalledApp: true })
      await submitVisibleForm(user)

      expect(submitInstalledHumanInput).not.toHaveBeenCalled()
      await confirmWorkflowReady()
      await waitFor(() =>
        expect(submitInstalledHumanInput).toHaveBeenCalledExactlyOnceWith(
          'form-token',
          { inputs: { review: 'Approved' }, action: 'approve' },
          formVersion,
        ),
      )
      expect(submitHumanInputForm).not.toHaveBeenCalled()
      expect(submitWebAppHumanInputForm).not.toHaveBeenCalled()
    },
  )

  it.each(['1', '2', undefined] as const)(
    'submits public-share form version %s after the workflow stream is ready',
    async (formVersion) => {
      const user = renderSubject(formVersion, { appSourceType: AppSourceType.tryApp })
      await submitVisibleForm(user)

      expect(submitHumanInputForm).not.toHaveBeenCalled()
      await confirmWorkflowReady()
      await waitFor(() =>
        expect(submitHumanInputForm).toHaveBeenCalledExactlyOnceWith(
          'form-token',
          { inputs: { review: 'Approved' }, action: 'approve' },
          formVersion,
        ),
      )
      expect(submitInstalledHumanInput).not.toHaveBeenCalled()
      expect(submitWebAppHumanInputForm).not.toHaveBeenCalled()
    },
  )

  it.each(['1', '2', undefined] as const)(
    'submits web-app form version %s after the workflow stream is ready',
    async (formVersion) => {
      const user = renderSubject(formVersion, { appSourceType: AppSourceType.webApp })
      await submitVisibleForm(user)

      expect(submitWebAppHumanInputForm).not.toHaveBeenCalled()
      await confirmWorkflowReady()
      await waitFor(() =>
        expect(submitWebAppHumanInputForm).toHaveBeenCalledExactlyOnceWith(
          'form-token',
          { inputs: { review: 'Approved' }, action: 'approve' },
          formVersion,
        ),
      )
      expect(submitInstalledHumanInput).not.toHaveBeenCalled()
      expect(submitHumanInputForm).not.toHaveBeenCalled()
    },
  )
})
