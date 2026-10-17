import type { PaginatedConversationVariableResponse } from '@dify/contracts/api/console/apps/types.gen'
import type { ConversationVariable } from '@/app/components/workflow/types'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import copy from 'copy-to-clipboard'
import { renderWorkflowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { ChatVarType } from '@/app/components/workflow/panel/chat-variable-panel/type'
import ConversationVariableModal from '../conversation-variable-modal'

vi.mock('copy-to-clipboard', () => ({
  default: vi.fn(),
}))

const mockFetchCurrentValueOfConversationVariable = vi.hoisted(() =>
  vi.fn<(query: { appId?: string; conversationId: string | null }) => Promise<unknown>>(),
)

vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  request: async (_url: string, _init: RequestInit, { request }: { request: Request }) => {
    const url = new URL(request.url)
    const appId = url.pathname.match(/\/apps\/([^/]+)\/conversation-variables$/)?.[1]
    if (!appId) throw new Error(`Unexpected request: ${request.method} ${request.url}`)
    return Response.json(
      await mockFetchCurrentValueOfConversationVariable({
        appId,
        conversationId: url.searchParams.get('conversation_id'),
      }),
    )
  },
}))

vi.mock('@/hooks/use-timestamp', () => ({
  default: () => ({
    formatTime: (timestamp: number) => `formatted-${timestamp}`,
  }),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/editor/code-editor', () => ({
  default: ({ value }: { value?: string }) => (
    <pre data-testid="conversation-code-editor">{value}</pre>
  ),
}))

const mockCopy = vi.mocked(copy)

const createConversationVariable = (
  overrides: Partial<ConversationVariable> = {},
): ConversationVariable => ({
  id: 'var-1',
  name: 'session_state',
  description: 'Session state',
  value_type: ChatVarType.Object,
  value: '{"draft":true}',
  ...overrides,
})

const createConversationVariableResponse = (
  data: PaginatedConversationVariableResponse['data'] = [],
): PaginatedConversationVariableResponse => ({
  data,
  has_more: false,
  limit: 20,
  total: data.length,
  page: 1,
})

describe('ConversationVariableModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetchCurrentValueOfConversationVariable.mockResolvedValue(
      createConversationVariableResponse(),
    )
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('loads latest values, switches the active variable, and closes the modal', async () => {
    const user = userEvent.setup()
    const onHide = vi.fn()
    mockFetchCurrentValueOfConversationVariable.mockResolvedValue(
      createConversationVariableResponse([
        {
          ...createConversationVariable({
            id: 'var-1',
            value: '{"latest":1}',
          }),
          updated_at: 100,
          created_at: 50,
        },
        {
          ...createConversationVariable({
            id: 'var-2',
            name: 'summary',
            value_type: ChatVarType.String,
            value: 'latest text',
          }),
          updated_at: 200,
          created_at: 150,
        },
      ]),
    )

    renderWorkflowComponent(
      <ConversationVariableModal conversationID="conversation-1" onHide={onHide} />,
      {
        resource: { kind: 'app' as const, appId: 'app-1', mode: 'workflow' as const },
        initialStoreState: {
          conversationVariables: [
            createConversationVariable(),
            createConversationVariable({
              id: 'var-2',
              name: 'summary',
              value_type: ChatVarType.String,
              value: 'plain text',
            }),
          ],
        },
      },
    )

    await waitFor(() => {
      expect(mockFetchCurrentValueOfConversationVariable).toHaveBeenCalledWith({
        appId: 'app-1',
        conversationId: 'conversation-1',
      })
    })

    expect(screen.getAllByText('session_state')).toHaveLength(2)
    expect(
      await screen.findByText((content) => content.includes('formatted-100')),
    ).toBeInTheDocument()
    expect(await screen.findByTestId('conversation-code-editor')).toHaveTextContent('{"latest":1}')

    await user.click(screen.getByText('summary'))
    expect(screen.getByText('latest text')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /operation\.close/ }))

    expect(onHide).toHaveBeenCalledTimes(1)
  })

  it('copies the current variable value and resets the copied state after the timeout', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    renderWorkflowComponent(
      <ConversationVariableModal conversationID="conversation-1" onHide={vi.fn()} />,
      {
        resource: { kind: 'app' as const, appId: 'app-1', mode: 'workflow' as const },
        initialStoreState: {
          conversationVariables: [createConversationVariable()],
        },
      },
    )

    const copyTrigger = screen.getByRole('button', { name: 'common.operation.copy' })

    await user.click(copyTrigger)

    expect(mockCopy).toHaveBeenCalledWith('{"draft":true}')
    expect(copyTrigger).toHaveFocus()
    expect(copyTrigger).toHaveAttribute('aria-disabled', 'true')
    await user.keyboard('{Enter}')
    expect(mockCopy).toHaveBeenCalledTimes(1)

    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(copyTrigger).toHaveAttribute('aria-disabled', 'false')
    await user.keyboard(' ')
    expect(mockCopy).toHaveBeenCalledTimes(2)
  })
})
