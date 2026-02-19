import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import RunMode from '../run-mode'

const mockHandleWorkflowStartRunInWorkflow = vi.fn()
const mockHandleStopRun = vi.fn()
const mockSetIsPreparingDataSource = vi.fn()
const mockSetShowDebugAndPreviewPanel = vi.fn()

let mockWorkflowRunningData: { task_id: string, result: { status: string } } | undefined
let mockIsPreparingDataSource = false
vi.mock('@/app/components/workflow/hooks', () => ({
  useWorkflowRun: () => ({
    handleStopRun: mockHandleStopRun,
  }),
  useWorkflowStartRun: () => ({
    handleWorkflowStartRunInWorkflow: mockHandleWorkflowStartRunInWorkflow,
  }),
}))

vi.mock('@/app/components/workflow/shortcuts-name', () => ({
  default: ({ keys }: { keys: string[] }) => <span data-testid="shortcuts">{keys.join('+')}</span>,
}))

vi.mock('@/app/components/workflow/store', () => ({
  useStore: (selector: (state: Record<string, unknown>) => unknown) => {
    const state = {
      workflowRunningData: mockWorkflowRunningData,
      isPreparingDataSource: mockIsPreparingDataSource,
    }
    return selector(state)
  },
  useWorkflowStore: () => ({
    getState: () => ({
      setIsPreparingDataSource: mockSetIsPreparingDataSource,
      setShowDebugAndPreviewPanel: mockSetShowDebugAndPreviewPanel,
    }),
  }),
}))

vi.mock('@/app/components/workflow/types', () => ({
  WorkflowRunningStatus: { Running: 'running' },
}))

vi.mock('@/app/components/workflow/variable-inspect/types', () => ({
  EVENT_WORKFLOW_STOP: 'EVENT_WORKFLOW_STOP',
}))

vi.mock('@/context/event-emitter', () => ({
  useEventEmitterContextContext: () => ({
    eventEmitter: { useSubscription: vi.fn() },
  }),
}))

vi.mock('@/utils/classnames', () => ({
  cn: (...args: unknown[]) => args.filter(a => typeof a === 'string').join(' '),
}))

vi.mock('@remixicon/react', () => ({
  RiCloseLine: () => <span data-testid="close-icon" />,
  RiDatabase2Line: () => <span data-testid="database-icon" />,
  RiLoader2Line: () => <span data-testid="loader-icon" />,
  RiPlayLargeLine: () => <span data-testid="play-icon" />,
}))

vi.mock('@/app/components/base/icons/src/vender/line/mediaAndDevices', () => ({
  StopCircle: () => <span data-testid="stop-icon" />,
}))

describe('RunMode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWorkflowRunningData = undefined
    mockIsPreparingDataSource = false
  })

  describe('Idle state', () => {
    it('should render test run text when no data', () => {
      render(<RunMode />)

      expect(screen.getByText('pipeline.common.testRun')).toBeInTheDocument()
    })

    it('should render custom text when provided', () => {
      render(<RunMode text="Custom Run" />)

      expect(screen.getByText('Custom Run')).toBeInTheDocument()
    })

    it('should render play icon', () => {
      render(<RunMode />)

      expect(screen.getByTestId('play-icon')).toBeInTheDocument()
    })

    it('should render keyboard shortcuts', () => {
      render(<RunMode />)

      expect(screen.getByTestId('shortcuts')).toBeInTheDocument()
    })

    it('should call start run when button clicked', () => {
      render(<RunMode />)

      fireEvent.click(screen.getByText('pipeline.common.testRun'))

      expect(mockHandleWorkflowStartRunInWorkflow).toHaveBeenCalled()
    })
  })

  describe('Running state', () => {
    beforeEach(() => {
      mockWorkflowRunningData = {
        task_id: 'task-1',
        result: { status: 'running' },
      }
    })

    it('should show processing text', () => {
      render(<RunMode />)

      expect(screen.getByText('pipeline.common.processing')).toBeInTheDocument()
    })

    it('should show stop button', () => {
      render(<RunMode />)

      expect(screen.getByTestId('stop-icon')).toBeInTheDocument()
    })

    it('should disable run button', () => {
      render(<RunMode />)

      const button = screen.getByText('pipeline.common.processing').closest('button')
      expect(button).toBeDisabled()
    })

    it('should call handleStopRun with task_id when stop clicked', () => {
      render(<RunMode />)

      fireEvent.click(screen.getByTestId('stop-icon').closest('button')!)

      expect(mockHandleStopRun).toHaveBeenCalledWith('task-1')
    })
  })

  describe('After run completed', () => {
    it('should show reRun text when previous run data exists', () => {
      mockWorkflowRunningData = {
        task_id: 'task-1',
        result: { status: 'succeeded' },
      }
      render(<RunMode />)

      expect(screen.getByText('pipeline.common.reRun')).toBeInTheDocument()
    })
  })

  describe('Preparing data source state', () => {
    beforeEach(() => {
      mockIsPreparingDataSource = true
    })

    it('should show preparing text', () => {
      render(<RunMode />)

      expect(screen.getByText('pipeline.common.preparingDataSource')).toBeInTheDocument()
    })

    it('should show database icon', () => {
      render(<RunMode />)

      expect(screen.getByTestId('database-icon')).toBeInTheDocument()
    })

    it('should show cancel button with close icon', () => {
      render(<RunMode />)

      expect(screen.getByTestId('close-icon')).toBeInTheDocument()
    })

    it('should cancel preparing when close clicked', () => {
      render(<RunMode />)

      fireEvent.click(screen.getByTestId('close-icon').closest('button')!)

      expect(mockSetIsPreparingDataSource).toHaveBeenCalledWith(false)
      expect(mockSetShowDebugAndPreviewPanel).toHaveBeenCalledWith(false)
    })
  })
})
