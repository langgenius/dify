import type { IChatItem } from '@/app/components/base/chat/chat/type'
import { fireEvent, render, screen } from '@testing-library/react'
import { useStore } from '@/app/components/app/store'
import MessageLogModal from './index'

let clickAwayHandler: (() => void) | null = null
vi.mock('ahooks', () => ({
  useClickAway: (fn: () => void) => {
    clickAwayHandler = fn
  },
}))

vi.mock('@/app/components/app/store', () => ({
  useStore: vi.fn(),
}))

vi.mock('@/app/components/workflow/run', () => ({
  default: ({ activeTab, runDetailUrl, tracingListUrl }: { activeTab: string, runDetailUrl: string, tracingListUrl: string }) => (
    <div
      data-testid="workflow-run"
      data-active-tab={activeTab}
      data-run-detail-url={runDetailUrl}
      data-tracing-list-url={tracingListUrl}
    />
  ),
}))

const mockLog = {
  id: 'msg-1',
  content: 'mock log message',
  workflow_run_id: 'run-1',
  isAnswer: true,
}

describe('MessageLogModal', () => {
  const onCancel = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    clickAwayHandler = null
    // eslint-disable-next-line ts/no-explicit-any
    vi.mocked(useStore).mockImplementation((selector: any) => selector({
      appDetail: { id: 'app-1' },
    }))
  })

  describe('Render', () => {
    it('renders nothing if currentLogItem is missing', () => {
      const { container } = render(<MessageLogModal width={800} onCancel={onCancel} />)
      expect(container.firstChild).toBeNull()
    })

    it('renders nothing if currentLogItem.workflow_run_id is missing', () => {
      const { container } = render(<MessageLogModal width={800} onCancel={onCancel} currentLogItem={{ id: '1' } as IChatItem} />)
      expect(container.firstChild).toBeNull()
    })

    it('renders modal with correct title and Run component', () => {
      render(<MessageLogModal width={800} onCancel={onCancel} currentLogItem={mockLog} />)
      expect(screen.getByText(/title/i)).toBeInTheDocument()
      expect(screen.getByTestId('workflow-run')).toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('passes correct props to Run component', () => {
      render(<MessageLogModal width={800} onCancel={onCancel} currentLogItem={mockLog} defaultTab="TRACING" />)
      const runComponent = screen.getByTestId('workflow-run')
      expect(runComponent.getAttribute('data-active-tab')).toBe('TRACING')
      expect(runComponent.getAttribute('data-run-detail-url')).toBe('/apps/app-1/workflow-runs/run-1')
      expect(runComponent.getAttribute('data-tracing-list-url')).toBe('/apps/app-1/workflow-runs/run-1/node-executions')
    })

    it('sets fixed style when fixedWidth is false (floating)', () => {
      const { container } = render(<MessageLogModal width={1000} onCancel={onCancel} currentLogItem={mockLog} fixedWidth={false} />)
      const modal = container.firstChild as HTMLElement
      expect(modal.style.position).toBe('fixed')
      expect(modal.style.width).toBe('480px')
    })

    it('sets fixed width when fixedWidth is true', () => {
      const { container } = render(<MessageLogModal width={1000} onCancel={onCancel} currentLogItem={mockLog} fixedWidth={true} />)
      const modal = container.firstChild as HTMLElement
      expect(modal.style.width).toBe('1000px')
    })
  })

  describe('Interaction', () => {
    it('calls onCancel when close icon is clicked', () => {
      render(<MessageLogModal width={800} onCancel={onCancel} currentLogItem={mockLog} />)
      const closeButton = screen.getByTestId('close-button')
      expect(closeButton).toBeInTheDocument()
      fireEvent.click(closeButton)
      expect(onCancel).toHaveBeenCalledTimes(1)
    })

    it('calls onCancel when clicked away', () => {
      render(<MessageLogModal width={800} onCancel={onCancel} currentLogItem={mockLog} />)
      expect(clickAwayHandler).toBeTruthy()
      clickAwayHandler!()
      expect(onCancel).toHaveBeenCalledTimes(1)
    })
  })
})
