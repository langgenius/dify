import type { IChatItem } from '@/app/components/base/chat/chat/type'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useClickAway } from 'ahooks'
import { fetchAgentLogDetail } from '@/service/log'
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

vi.mock('@/service/log', () => ({
  fetchAgentLogDetail: vi.fn(),
}))

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: mockToast,
}))

vi.mock('@/app/components/app/store', () => ({
  useStore: vi.fn(selector => selector({ appDetail: { id: 'app-id' } })),
}))

vi.mock('@/app/components/workflow/run/status', () => ({
  default: ({ status, time, tokens, error }: { status: string, time?: number, tokens?: number, error?: string }) => (
    <div data-testid="status-panel" data-status={String(status)} data-time={String(time)} data-tokens={String(tokens)}>{error ? <span>{String(error)}</span> : null}</div>
  ),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/editor/code-editor', () => ({
  default: ({ title, value }: { title: React.ReactNode, value: string | object }) => (
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

vi.mock('@/app/components/base/icons/src/vender/line/arrows', () => ({
  ChevronRight: (props: { className?: string }) => <div data-testid="chevron-right" className={props.className} />,
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
      iterations: [{
        created_at: '',
        files: [],
        thought: '',
        tokens: 0,
        tool_raw: { inputs: '', outputs: '' },
        tool_calls: [{ tool_name: 'tool1', status: 'success', tool_icon: null, tool_label: { 'en-US': 'Tool 1' } }],
      }],
      files: [],
    })
  })

  it('should return null if no currentLogItem', () => {
    const { container } = render(<AgentLogModal {...mockProps} currentLogItem={undefined} />)
    expect(container.firstChild).toBeNull()
  })

  it('should return null if no conversationId', () => {
    const { container } = render(<AgentLogModal {...mockProps} currentLogItem={{ id: '1' } as unknown as IChatItem} />)
    expect(container.firstChild).toBeNull()
  })

  it('should render correctly when log item is provided', async () => {
    render(<AgentLogModal {...mockProps} />)

    expect(screen.getByText('appLog.runDetail.workflowTitle')).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText(/runLog.detail/i)).toBeInTheDocument()
    })
  })

  it('should call onCancel when close button is clicked', () => {
    vi.mocked(fetchAgentLogDetail).mockReturnValue(new Promise(() => {}))

    render(<AgentLogModal {...mockProps} />)

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

    render(<AgentLogModal {...mockProps} />)
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

    render(<AgentLogModal {...mockProps} />)

    expect(mockProps.onCancel).not.toHaveBeenCalled()
  })
})
