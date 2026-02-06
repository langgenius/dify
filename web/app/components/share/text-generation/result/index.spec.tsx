import type { IResultProps } from './index'
import { render, screen } from '@testing-library/react'
import { AppSourceType } from '@/service/share'
import Result from './index'

// Mock the custom hook to control state
const mockHandleSend = vi.fn()
const mockHandleStop = vi.fn()
const mockHandleFeedback = vi.fn()

let hookReturnValue = {
  isResponding: false,
  completionRes: '',
  workflowProcessData: undefined as IResultProps['isWorkflow'] extends true ? object : undefined,
  messageId: null as string | null,
  feedback: { rating: null as string | null },
  isStopping: false,
  currentTaskId: null as string | null,
  controlClearMoreLikeThis: 0,
  handleSend: mockHandleSend,
  handleStop: mockHandleStop,
  handleFeedback: mockHandleFeedback,
}

vi.mock('./hooks/use-text-generation', () => ({
  useTextGeneration: () => hookReturnValue,
}))

vi.mock('i18next', () => ({
  t: (key: string) => key,
}))

// Mock complex external component to keep tests focused
vi.mock('@/app/components/app/text-generate/item', () => ({
  default: ({ content, isWorkflow, taskId, isLoading }: {
    content: string
    isWorkflow: boolean
    taskId?: string
    isLoading: boolean
  }) => (
    <div
      data-testid="text-generation-res"
      data-content={content}
      data-workflow={String(isWorkflow)}
      data-task-id={taskId ?? ''}
      data-loading={String(isLoading)}
    />
  ),
}))

vi.mock('@/app/components/share/text-generation/no-data', () => ({
  default: () => <div data-testid="no-data" />,
}))

// Factory for default props
const createProps = (overrides: Partial<IResultProps> = {}): IResultProps => ({
  isWorkflow: false,
  isCallBatchAPI: false,
  isPC: true,
  isMobile: false,
  appSourceType: AppSourceType.webApp,
  appId: 'app-1',
  isError: false,
  isShowTextToSpeech: false,
  promptConfig: { prompt_template: '', prompt_variables: [] },
  moreLikeThisEnabled: false,
  inputs: {},
  onShowRes: vi.fn(),
  handleSaveMessage: vi.fn(),
  onCompleted: vi.fn(),
  visionConfig: { enabled: false } as IResultProps['visionConfig'],
  completionFiles: [],
  siteInfo: null,
  onRunStart: vi.fn(),
  ...overrides,
})

describe('Result', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hookReturnValue = {
      isResponding: false,
      completionRes: '',
      workflowProcessData: undefined,
      messageId: null,
      feedback: { rating: null },
      isStopping: false,
      currentTaskId: null,
      controlClearMoreLikeThis: 0,
      handleSend: mockHandleSend,
      handleStop: mockHandleStop,
      handleFeedback: mockHandleFeedback,
    }
  })

  // Empty state rendering
  describe('empty state', () => {
    it('should show NoData when not batch and no completion data', () => {
      render(<Result {...createProps()} />)

      expect(screen.getByTestId('no-data')).toBeInTheDocument()
      expect(screen.queryByTestId('text-generation-res')).not.toBeInTheDocument()
    })

    it('should show NoData when workflow mode has no process data', () => {
      render(<Result {...createProps({ isWorkflow: true })} />)

      expect(screen.getByTestId('no-data')).toBeInTheDocument()
    })
  })

  // Loading state rendering
  describe('loading state', () => {
    it('should show loading spinner when responding but no data yet', () => {
      hookReturnValue.isResponding = true
      hookReturnValue.completionRes = ''

      const { container } = render(<Result {...createProps()} />)

      // Loading area renders a spinner
      expect(container.querySelector('.items-center.justify-center')).toBeInTheDocument()
      expect(screen.queryByTestId('no-data')).not.toBeInTheDocument()
      expect(screen.queryByTestId('text-generation-res')).not.toBeInTheDocument()
    })

    it('should not show loading in batch mode even when responding', () => {
      hookReturnValue.isResponding = true
      hookReturnValue.completionRes = ''

      render(<Result {...createProps({ isCallBatchAPI: true })} />)

      // Batch mode skips loading state and goes to TextGenerationRes
      expect(screen.getByTestId('text-generation-res')).toBeInTheDocument()
    })
  })

  // Result rendering
  describe('result rendering', () => {
    it('should render TextGenerationRes when completion data exists', () => {
      hookReturnValue.completionRes = 'Generated output'

      render(<Result {...createProps()} />)

      const res = screen.getByTestId('text-generation-res')
      expect(res).toBeInTheDocument()
      expect(res.dataset.content).toBe('Generated output')
    })

    it('should render TextGenerationRes for workflow with process data', () => {
      hookReturnValue.workflowProcessData = { status: 'running', tracing: [] } as never

      render(<Result {...createProps({ isWorkflow: true })} />)

      const res = screen.getByTestId('text-generation-res')
      expect(res.dataset.workflow).toBe('true')
    })

    it('should format batch taskId with leading zero for single digit', () => {
      hookReturnValue.completionRes = 'batch result'

      render(<Result {...createProps({ isCallBatchAPI: true, taskId: 3 })} />)

      expect(screen.getByTestId('text-generation-res').dataset.taskId).toBe('03')
    })

    it('should format batch taskId without leading zero for double digit', () => {
      hookReturnValue.completionRes = 'batch result'

      render(<Result {...createProps({ isCallBatchAPI: true, taskId: 12 })} />)

      expect(screen.getByTestId('text-generation-res').dataset.taskId).toBe('12')
    })

    it('should show loading in TextGenerationRes for batch mode while responding', () => {
      hookReturnValue.isResponding = true
      hookReturnValue.completionRes = ''

      render(<Result {...createProps({ isCallBatchAPI: true })} />)

      expect(screen.getByTestId('text-generation-res').dataset.loading).toBe('true')
    })
  })

  // Stop button
  describe('stop button', () => {
    it('should show stop button when responding with active task', () => {
      hookReturnValue.isResponding = true
      hookReturnValue.completionRes = 'data'
      hookReturnValue.currentTaskId = 'task-1'

      render(<Result {...createProps()} />)

      expect(screen.getByText('operation.stopResponding')).toBeInTheDocument()
    })

    it('should hide stop button when hideInlineStopButton is true', () => {
      hookReturnValue.isResponding = true
      hookReturnValue.completionRes = 'data'
      hookReturnValue.currentTaskId = 'task-1'

      render(<Result {...createProps({ hideInlineStopButton: true })} />)

      expect(screen.queryByText('operation.stopResponding')).not.toBeInTheDocument()
    })

    it('should hide stop button when not responding', () => {
      hookReturnValue.completionRes = 'data'
      hookReturnValue.currentTaskId = 'task-1'

      render(<Result {...createProps()} />)

      expect(screen.queryByText('operation.stopResponding')).not.toBeInTheDocument()
    })

    it('should show spinner icon when stopping', () => {
      hookReturnValue.isResponding = true
      hookReturnValue.completionRes = 'data'
      hookReturnValue.currentTaskId = 'task-1'
      hookReturnValue.isStopping = true

      const { container } = render(<Result {...createProps()} />)

      expect(container.querySelector('.animate-spin')).toBeInTheDocument()
    })

    it('should align stop button to end on PC, center on mobile', () => {
      hookReturnValue.isResponding = true
      hookReturnValue.completionRes = 'data'
      hookReturnValue.currentTaskId = 'task-1'

      const { container, rerender } = render(<Result {...createProps({ isPC: true })} />)
      expect(container.querySelector('.justify-end')).toBeInTheDocument()

      rerender(<Result {...createProps({ isPC: false })} />)
      expect(container.querySelector('.justify-center')).toBeInTheDocument()
    })
  })

  // Memo
  describe('memoization', () => {
    it('should be wrapped with React.memo', () => {
      expect((Result as unknown as { $$typeof: symbol }).$$typeof).toBe(Symbol.for('react.memo'))
    })
  })
})
