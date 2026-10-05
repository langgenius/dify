import type { IChatItem } from '@/app/components/base/chat/chat/type'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useClickAway } from 'ahooks'
import { fetchAgentLogDetail } from '@/service/log'
import { AgentLogModal } from '../index'

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

vi.mock('@/service/log', () => ({
  fetchAgentLogDetail: vi.fn(),
}))

vi.mock('@/app/notifications', () => ({
  toast: mockToast,
}))

vi.mock('@/app/components/workflow/run/status', () => ({
  default: ({
    status,
    time,
    tokens,
    error,
  }: {
    status: string
    time?: number
    tokens?: number
    error?: string
  }) => (
    <div
      data-testid="status-panel"
      data-status={String(status)}
      data-time={String(time)}
      data-tokens={String(tokens)}
    >
      {error ? <span>{String(error)}</span> : null}
    </div>
  ),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/editor/code-editor', () => ({
  default: ({ title, value }: { title: React.ReactNode; value: string | object }) => (
    <div data-testid="code-editor">
      {title}
      {typeof value === 'string' ? value : JSON.stringify(value)}
    </div>
  ),
}))

vi.mock('@/hooks/use-timestamp', () => ({
  default: () => ({ formatTime: (ts: number, fmt: string) => `${ts}-${fmt}` }),
}))

vi.mock('@/app/components/workflow/block-icon', () => ({
  default: () => <div data-testid="block-icon" />,
}))

vi.mock('ahooks', () => ({
  useClickAway: vi.fn(),
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
    vi.clearAllMocks()
    vi.mocked(fetchAgentLogDetail).mockResolvedValue({
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

  it('should render correctly when log item is provided', async () => {
    render(<AgentLogModal appId="app-id" {...mockProps} />)

    expect(screen.getByText('appLog.runDetail.workflowTitle')).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText(/runLog.detail/i)).toBeInTheDocument()
    })
  })

  it('should render the floating modal through a dialog portal', () => {
    vi.mocked(fetchAgentLogDetail).mockReturnValue(new Promise(() => {}))

    const { container } = render(
      <AgentLogModal appId="app-id" {...mockProps} floating open onOpenChange={vi.fn()} />,
    )

    const modal = screen.getByRole('dialog')
    expect(container).not.toContainElement(modal)
    expect(document.body).toContainElement(modal)
    expect(modal).toHaveClass('fixed', 'z-50', 'w-120!', 'left-[max(8px,calc(100vw-1136px))]!')
  })

  it('mounts floating details only while open and starts a fresh tab session on reopen', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    const props = {
      appId: 'app-id',
      currentLogItem: mockLog,
      width: 1000,
      floating: true as const,
      onOpenChange,
    }
    const { rerender } = render(<AgentLogModal {...props} open={false} />)
    expect(fetchAgentLogDetail).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    rerender(<AgentLogModal {...props} open />)
    await screen.findByText('User')
    await user.click(screen.getByRole('button', { name: 'runLog.tracing' }))
    await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
    expect(onOpenChange).toHaveBeenCalledWith(false, expect.anything())
    rerender(<AgentLogModal {...props} open={false} />)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    rerender(<AgentLogModal {...props} open />)
    await screen.findByText('User')
    expect(screen.getByRole('button', { name: 'runLog.detail' })).toHaveAttribute(
      'data-active',
      'true',
    )
    expect(fetchAgentLogDetail).toHaveBeenCalledTimes(2)
  })

  it('should call onCancel when close button is clicked', () => {
    vi.mocked(fetchAgentLogDetail).mockReturnValue(new Promise(() => {}))

    render(<AgentLogModal appId="app-id" {...mockProps} />)

    const closeBtn = screen.getByRole('button', { name: 'common.operation.close' })
    fireEvent.click(closeBtn)

    expect(mockProps.onCancel).toHaveBeenCalledTimes(1)
  })

  it('should call onCancel when clicking away', () => {
    vi.mocked(fetchAgentLogDetail).mockReturnValue(new Promise(() => {}))

    let clickAwayHandler!: (event: Event) => void
    vi.mocked(useClickAway).mockImplementation((callback) => {
      clickAwayHandler = callback
    })

    render(<AgentLogModal appId="app-id" {...mockProps} />)
    clickAwayHandler(new Event('click'))

    expect(mockProps.onCancel).toHaveBeenCalledTimes(1)
  })

  it('should ignore click-away before mounted state is set', () => {
    vi.mocked(fetchAgentLogDetail).mockReturnValue(new Promise(() => {}))
    let invoked = false
    vi.mocked(useClickAway).mockImplementation((callback) => {
      if (!invoked) {
        invoked = true
        callback(new Event('click'))
      }
    })

    render(<AgentLogModal appId="app-id" {...mockProps} />)

    expect(mockProps.onCancel).not.toHaveBeenCalled()
  })

  it('should not use click-away to close the floating dialog', () => {
    vi.mocked(fetchAgentLogDetail).mockReturnValue(new Promise(() => {}))

    let clickAwayHandler!: (event: Event) => void
    vi.mocked(useClickAway).mockImplementation((callback) => {
      clickAwayHandler = callback
    })

    render(<AgentLogModal appId="app-id" {...mockProps} floating open onOpenChange={vi.fn()} />)
    clickAwayHandler(new Event('click'))

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
    vi.mocked(fetchAgentLogDetail)
      .mockResolvedValue(response)
      .mockImplementationOnce(() => pending)
    const { rerender } = render(<AgentLogModal appId="old-app" {...mockProps} />)
    rerender(<AgentLogModal appId="new-app" {...mockProps} />)
    await screen.findByText('New executor')
    expect(fetchAgentLogDetail).toHaveBeenLastCalledWith({
      appID: 'new-app',
      params: { conversation_id: mockLog.conversationId, message_id: mockLog.id },
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
    fireEvent.click(screen.getByRole('button', { name: 'runLog.tracing' }))
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
      appID: 'app-id',
      params: { conversation_id: mockLog.conversationId, message_id: 'next-message' },
    })
  })

  it('ignores a failed request after its record has been replaced', async () => {
    let rejectOldResponse: (error: Error) => void = () => {}
    const pending = new Promise<Awaited<ReturnType<typeof fetchAgentLogDetail>>>((_, reject) => {
      rejectOldResponse = reject
    })
    vi.mocked(fetchAgentLogDetail).mockReturnValueOnce(pending)
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
