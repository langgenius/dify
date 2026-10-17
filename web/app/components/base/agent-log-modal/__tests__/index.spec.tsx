import type { IChatItem } from '@/app/components/base/chat/chat/type'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import AgentLogModal from '../index'

const { mockToast } = vi.hoisted(() => {
  const mockToast = Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    dismiss: vi.fn(),
    update: vi.fn(),
    promise: vi.fn(),
  })
  return { mockToast }
})

const { fetchAgentLogDetail } = vi.hoisted(() => ({
  fetchAgentLogDetail: vi.fn(),
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'apps.byAppId.agent.logs.get': fetchAgentLogDetail,
    }),
  }
})

vi.mock('@/app/notifications', () => ({
  toast: mockToast,
}))

const mockLog = {
  id: 'msg-id',
  conversationId: 'conv-id',
  content: 'content',
  isAnswer: false,
  input: 'test input',
} as IChatItem

const mockProps = {
  currentLogItem: mockLog,
  width: 1000,
  onCancel: vi.fn(),
}

describe('AgentLogModal', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    fetchAgentLogDetail.mockResolvedValue({
      meta: {
        status: 'succeeded',
        executor: 'User',
        start_time: '2023-01-01',
        elapsed_time: 1.0,
        total_tokens: 100,
        agent_mode: 'function_call',
        iterations: 1,
      },
      iterations: [
        {
          created_at: '',
          files: [],
          thought: '',
          tokens: 0,
          tool_raw: { inputs: '', outputs: '' },
          tool_calls: [
            {
              tool_name: 'tool1',
              status: 'success',
              tool_icon: null,
              tool_label: { 'en-US': 'Tool 1' },
            },
          ],
        },
      ],
      files: [],
    })
  })

  it('should return null if no currentLogItem', () => {
    const { container } = render(
      <AgentLogModal appId="app-id" {...mockProps} currentLogItem={undefined} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('should return null if no conversationId', () => {
    const { container } = render(
      <AgentLogModal
        appId="app-id"
        {...mockProps}
        currentLogItem={{ id: '1' } as unknown as IChatItem}
      />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('should render the floating modal through a dialog portal', () => {
    fetchAgentLogDetail.mockReturnValue(new Promise(() => {}))

    const { container } = render(<AgentLogModal appId="app-id" {...mockProps} floating />)

    const modal = screen.getByRole('dialog')
    expect(container).not.toContainElement(modal)
    expect(document.body).toContainElement(modal)
  })

  it('should call onCancel when close button is clicked', async () => {
    fetchAgentLogDetail.mockReturnValue(new Promise(() => {}))

    render(<AgentLogModal appId="app-id" {...mockProps} />)

    const closeBtn = screen.getByRole('button', { name: 'common.operation.close' })
    await userEvent.setup().click(closeBtn)

    expect(mockProps.onCancel).toHaveBeenCalledTimes(1)
  })

  it('should call onCancel when clicking outside the panel', async () => {
    fetchAgentLogDetail.mockReturnValue(new Promise(() => {}))
    render(<AgentLogModal appId="app-id" {...mockProps} />)
    await userEvent.setup().click(document.body)
    expect(mockProps.onCancel).toHaveBeenCalledOnce()
  })

  it('does not close when clicking inside the panel', async () => {
    fetchAgentLogDetail.mockReturnValue(new Promise(() => {}))
    render(<AgentLogModal appId="app-id" {...mockProps} />)
    await userEvent.setup().click(screen.getByText('appLog.runDetail.workflowTitle'))
    expect(mockProps.onCancel).not.toHaveBeenCalled()
  })

  it('keeps the floating dialog open when clicking its content', async () => {
    fetchAgentLogDetail.mockReturnValue(new Promise(() => {}))
    render(<AgentLogModal appId="app-id" {...mockProps} floating />)
    await userEvent.setup().click(screen.getByRole('dialog'))
    expect(mockProps.onCancel).not.toHaveBeenCalled()
  })

  it('keeps the new app log visible when the previous app response arrives late', async () => {
    const response = {
      meta: {
        status: 'succeeded',
        executor: 'New executor',
        start_time: '2023-01-01',
        elapsed_time: 1,
        total_tokens: 1,
        agent_mode: 'function_call',
        iterations: 0,
      },
      iterations: [],
      files: [],
    }
    let resolveOldResponse!: (value: Awaited<ReturnType<typeof fetchAgentLogDetail>>) => void
    const pending = new Promise<Awaited<ReturnType<typeof fetchAgentLogDetail>>>((resolve) => {
      resolveOldResponse = resolve
    })
    fetchAgentLogDetail.mockResolvedValue(response).mockImplementationOnce(() => pending)
    const { rerender } = render(<AgentLogModal appId="old-app" {...mockProps} />)
    rerender(<AgentLogModal appId="new-app" {...mockProps} />)
    await screen.findByText('New executor')
    expect(fetchAgentLogDetail).toHaveBeenLastCalledWith({
      params: { app_id: 'new-app' },
      query: { conversation_id: mockLog.conversationId, message_id: mockLog.id },
    })
    await act(async () => {
      resolveOldResponse({ ...response, meta: { ...response.meta, executor: 'Old executor' } })
      await pending
    })
    expect(screen.getByText('New executor')).toBeInTheDocument()
    expect(screen.queryByText('Old executor')).not.toBeInTheDocument()
  })
  it('preserves the selected tab when another message replaces the open record', async () => {
    const { rerender } = render(<AgentLogModal appId="app-id" {...mockProps} />)
    await screen.findByText('User')
    await userEvent.setup().click(screen.getByRole('button', { name: 'runLog.tracing' }))
    rerender(
      <AgentLogModal
        appId="app-id"
        {...mockProps}
        currentLogItem={{ ...mockLog, id: 'next-message' }}
      />,
    )
    expect(screen.getByRole('button', { name: 'runLog.tracing' })).toHaveAttribute(
      'data-active',
      'true',
    )
    expect(screen.getByRole('progressbar')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument())
    expect(fetchAgentLogDetail).toHaveBeenLastCalledWith({
      params: { app_id: 'app-id' },
      query: { conversation_id: mockLog.conversationId, message_id: 'next-message' },
    })
  })

  it('ignores a failed request after its record has been replaced', async () => {
    let rejectOldResponse: (error: Error) => void = () => {}
    const pending = new Promise<Awaited<ReturnType<typeof fetchAgentLogDetail>>>((_, reject) => {
      rejectOldResponse = reject
    })
    fetchAgentLogDetail.mockReturnValueOnce(pending)
    const { rerender } = render(<AgentLogModal appId="old-app" {...mockProps} />)
    rerender(<AgentLogModal appId="new-app" {...mockProps} />)
    await screen.findByText('User')
    await act(async () => {
      rejectOldResponse(new Error('Old request failed'))
    })
    expect(mockToast.error).not.toHaveBeenCalled()
    expect(screen.getByText('User')).toBeInTheDocument()
  })
})
