import { fireEvent, render, screen } from '@testing-library/react'
import AgentLogModal from '.'

vi.mock('./detail', () => ({
  __esModule: true,
  default: () => <div data-testid="agent-log-detail" />,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

let clickAwayHandler: (() => void) | null = null

vi.mock('ahooks', () => ({
  useClickAway: (fn: () => void) => {
    clickAwayHandler = fn
  },
}))

const mockLog = {
  id: 'msg-1',
  content: 'mock log message',
  conversationId: 'conv-1',
  isAnswer: false,
}

describe('Agent Log Modal', () => {
  const onCancel = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    clickAwayHandler = null
  })

  it('null rendered if currentLogItem is not defined', () => {
    const { container } = render(<AgentLogModal width={800} onCancel={onCancel} />)
    expect(container.firstChild).toBeNull()
  })

  it('null rendered if currentLogItem Id is not defined', () => {
    const { container } = render(<AgentLogModal width={800} onCancel={onCancel} currentLogItem={{ ...mockLog, conversationId: undefined }} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders modal on providing item', () => {
    render(<AgentLogModal width={800} onCancel={onCancel} currentLogItem={mockLog} />)
    expect(screen.getByTestId('agent-log-detail')).toBeInTheDocument()
  })

  it('calls onClose when clicked on close button', () => {
    render(<AgentLogModal width={800} onCancel={onCancel} currentLogItem={mockLog} />)
    const closeButton = screen.getByText((_, el) =>
      el?.classList.contains('cursor-pointer') ?? false,
    )
    fireEvent.click(closeButton)
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('calls onClose when clicked outside the modal', () => {
    render(<AgentLogModal width={800} onCancel={onCancel} currentLogItem={mockLog} />)
    expect(clickAwayHandler).not.toBeNull()
    if (clickAwayHandler) {
      clickAwayHandler()
    }
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
