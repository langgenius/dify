import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { RunMode } from '../run-mode'

const mockHandleWorkflowStartRunInWorkflow = vi.fn()
const mockHandleStopRun = vi.fn()
const mockSetIsPreparingDataSource = vi.fn()
const mockSetShowDebugAndPreviewPanel = vi.fn()

let mockWorkflowRunningData: { task_id: string; result: { status: string } } | undefined
let mockIsPreparingDataSource = false
vi.mock('@/app/components/workflow/hooks/use-workflow-run', () => ({
  useWorkflowRun: () => ({ handleStopRun: mockHandleStopRun }),
}))

vi.mock('@/app/components/workflow/hooks/use-workflow-start-run', () => ({
  useWorkflowStartRun: () => ({
    handleWorkflowStartRunInWorkflow: mockHandleWorkflowStartRunInWorkflow,
  }),
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

vi.mock('@/app/components/workflow/hooks-store', () => ({
  useHooksStore: (selector: (state: { accessControl: { canRun: boolean } }) => unknown) =>
    selector({
      accessControl: { canRun: true },
    }),
}))

vi.mock('@/context/event-emitter', () => ({
  useEventEmitterContextContext: () => ({
    eventEmitter: { useSubscription: vi.fn() },
  }),
}))

describe('RunMode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWorkflowRunningData = undefined
    mockIsPreparingDataSource = false
  })

  describe('Idle state', () => {
    it('should call start run when button clicked', async () => {
      render(<RunMode />)

      await userEvent.setup().click(screen.getByRole('button', { name: /pipeline.common.testRun/ }))

      expect(mockHandleWorkflowStartRunInWorkflow).toHaveBeenCalled()
    })

    it('should run through the enabled application shortcut', () => {
      render(<RunMode />)

      const event = new KeyboardEvent('keydown', {
        key: 'r',
        code: 'KeyR',
        altKey: true,
        bubbles: true,
      })
      // Happy DOM treats Alt as AltGraph; this event represents the plain Alt key.
      vi.spyOn(event, 'getModifierState').mockImplementation((key) => key === 'Alt')
      fireEvent(document.body, event)
      fireEvent.keyUp(document.body, { key: 'r', code: 'KeyR', altKey: true })

      expect(mockHandleWorkflowStartRunInWorkflow).toHaveBeenCalledOnce()
    })
  })

  describe('Running state', () => {
    beforeEach(() => {
      mockWorkflowRunningData = {
        task_id: 'task-1',
        result: { status: 'running' },
      }
    })

    it('should call handleStopRun with task_id when stop clicked', async () => {
      render(<RunMode />)

      await userEvent
        .setup()
        .click(
          screen.getByRole('button', { name: 'workflowDebug.debug.variableInspect.trigger.stop' }),
        )

      expect(screen.getByRole('button', { name: 'pipeline.common.processing' })).toBeDisabled()
      expect(mockHandleWorkflowStartRunInWorkflow).not.toHaveBeenCalled()
      expect(mockHandleStopRun).toHaveBeenCalledWith('task-1')
    })
  })

  describe('After run completed', () => {
    it('should show reRun text when previous run data exists', async () => {
      mockWorkflowRunningData = {
        task_id: 'task-1',
        result: { status: 'succeeded' },
      }
      render(<RunMode />)

      await userEvent.setup().click(screen.getByRole('button', { name: /pipeline.common.reRun/ }))
      expect(mockHandleWorkflowStartRunInWorkflow).toHaveBeenCalledOnce()
    })
  })

  describe('Preparing data source state', () => {
    beforeEach(() => {
      mockIsPreparingDataSource = true
    })

    it('should cancel preparing when close clicked', async () => {
      render(<RunMode />)

      await userEvent.setup().click(screen.getByRole('button', { name: 'common.operation.cancel' }))

      expect(
        screen.getByRole('button', { name: 'pipeline.common.preparingDataSource' }),
      ).toBeDisabled()
      expect(mockSetIsPreparingDataSource).toHaveBeenCalledWith(false)
      expect(mockSetShowDebugAndPreviewPanel).toHaveBeenCalledWith(false)
    })
  })
})
