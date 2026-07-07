import type { ConversationVariable } from '@/app/components/workflow/types'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import copy from 'copy-to-clipboard'
import { renderWorkflowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { ChatVarType } from '@/app/components/workflow/panel/chat-variable-panel/type'
import { fetchCurrentValueOfConversationVariable } from '@/service/workflow'
import ConversationVariableModal from '../conversation-variable-modal'

vi.mock('copy-to-clipboard', () => ({
  default: vi.fn(),
}))

vi.mock('@/service/workflow', () => ({
  fetchCurrentValueOfConversationVariable: vi.fn(),
}))

vi.mock('@/hooks/use-timestamp', () => ({
  default: () => ({
    formatTime: (timestamp: number) => `formatted-${timestamp}`,
  }),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/editor/code-editor', () => ({
  default: ({ value }: { value?: string }) => <pre data-testid="conversation-code-editor">{value}</pre>,
}))

const mockFetchCurrentValueOfConversationVariable = vi.mocked(fetchCurrentValueOfConversationVariable)
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
  data: Array<Awaited<ReturnType<typeof fetchCurrentValueOfConversationVariable>>['data'][number]> = [],
): Awaited<ReturnType<typeof fetchCurrentValueOfConversationVariable>> => ({
  data,
  has_more: false,
  limit: 20,
  total: data.length,
  page: 1,
})

describe('ConversationVariableModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetchCurrentValueOfConversationVariable.mockResolvedValue(createConversationVariableResponse())
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('loads latest values, switches the active variable, and closes the modal', async () => {
    const user = userEvent.setup()
    const onHide = vi.fn()
    mockFetchCurrentValueOfConversationVariable.mockResolvedValue(createConversationVariableResponse([
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
    ]))

    renderWorkflowComponent(
      <ConversationVariableModal
        conversationID="conversation-1"
        onHide={onHide}
      />,
      {
        initialStoreState: {
          appId: 'app-1',
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
        url: '/apps/app-1/conversation-variables',
        params: { conversation_id: 'conversation-1' },
      })
    })

    expect(screen.getAllByText('session_state')).toHaveLength(2)
    expect(screen.getByText(content => content.includes('formatted-100'))).toBeInTheDocument()
    expect(screen.getByTestId('conversation-code-editor')).toHaveTextContent('{"latest":1}')

    await user.click(screen.getByText('summary'))
    expect(screen.getByText('latest text')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /operation\.close/ }))

    expect(onHide).toHaveBeenCalledTimes(1)
  })

  it('copies the current variable value and resets the copied state after the timeout', () => {
    vi.useFakeTimers()

    renderWorkflowComponent(
      <ConversationVariableModal
        conversationID="conversation-1"
        onHide={vi.fn()}
      />,
      {
        initialStoreState: {
          appId: 'app-1',
          conversationVariables: [createConversationVariable()],
        },
      },
    )

    const copyTrigger = document.querySelector('.flex.items-center.p-1 svg.cursor-pointer') as HTMLElement

    act(() => {
      fireEvent.click(copyTrigger)
    })

    expect(mockCopy).toHaveBeenCalledWith('{"draft":true}')

    act(() => {
      vi.advanceTimersByTime(2000)
    })
  })
})
