import type { PaginatedConversationVariableResponse } from '@dify/contracts/api/console/apps/types.gen'
import type { ConversationVariable } from '@/app/components/workflow/types'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import copy from 'copy-to-clipboard'
import { renderWorkflowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { ChatVarType } from '@/app/components/workflow/panel/chat-variable-panel/type'
import { createDeferred } from '@/test/deferred'
import ConversationVariableModal from '../conversation-variable-modal'

vi.mock('copy-to-clipboard', () => ({
  default: vi.fn(),
}))

const request = vi.hoisted(() => vi.fn<(url: string) => Promise<Response>>())
vi.mock('@/service/base', () => ({ request }))

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
    request.mockImplementation(async () => Response.json(createConversationVariableResponse()))
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('loads latest values, switches the active variable, and closes the modal', async () => {
    const user = userEvent.setup()
    const onHide = vi.fn()
    request.mockResolvedValue(
      Response.json(
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
      ),
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
      expect(request).toHaveBeenCalledWith(
        expect.stringContaining(
          '/apps/app-1/conversation-variables?conversation_id=conversation-1',
        ),
        expect.anything(),
        expect.anything(),
      )
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

  it('keeps the current conversation values when a previous request finishes late', async () => {
    const previous = createDeferred<Response>()
    request.mockReturnValueOnce(previous.promise)
    request.mockResolvedValueOnce(
      Response.json(
        createConversationVariableResponse([
          { ...createConversationVariable(), value: '{"current":true}', updated_at: 200 },
        ]),
      ),
    )
    const { rerender } = renderWorkflowComponent(
      <ConversationVariableModal conversationID="conversation-1" onHide={vi.fn()} />,
      { initialStoreState: { conversationVariables: [createConversationVariable()] } },
    )
    await waitFor(() => expect(request).toHaveBeenCalledOnce())
    rerender(<ConversationVariableModal conversationID="conversation-2" onHide={vi.fn()} />)
    await waitFor(() =>
      expect(screen.getByTestId('conversation-code-editor')).toHaveTextContent('{"current":true}'),
    )
    await act(async () =>
      previous.resolve(
        Response.json(
          createConversationVariableResponse([
            { ...createConversationVariable(), value: '{"previous":true}', updated_at: 100 },
          ]),
        ),
      ),
    )
    expect(screen.getByTestId('conversation-code-editor')).toHaveTextContent('{"current":true}')
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
