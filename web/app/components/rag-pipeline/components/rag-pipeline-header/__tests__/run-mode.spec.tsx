import type { ReactNode } from 'react'
import type { InjectWorkflowStoreSliceFn } from '@/app/components/workflow/store/workflow'
import { act, fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import {
  baseRunningData,
  renderWorkflowComponent,
} from '@/app/components/workflow/__tests__/workflow-test-env'
import { fullWorkflowAccessControl } from '@/app/components/workflow/hooks-store/store'
import { WorkflowRunningStatus } from '@/app/components/workflow/types'
import { EVENT_WORKFLOW_STOP } from '@/app/components/workflow/variable-inspect/types'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { EventEmitterContextProvider } from '@/context/event-emitter-provider'
import { createRagPipelineSliceSlice } from '../../../store'
import { RunMode } from '../run-mode'

// Start and stop are provided by the pipeline hooks through the hooks store.
const mockHandleWorkflowStartRunInWorkflow = vi.fn()
const mockHandleStopRun = vi.fn()

let emitWorkflowEvent: ((event: { type: string }) => void) | undefined
const EmitterProbe = ({ children }: { children: ReactNode }) => {
  const { eventEmitter } = useEventEmitterContextContext()
  emitWorkflowEvent = (event) => eventEmitter?.emit(event as never)
  return children
}

const pressRunShortcut = () => {
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
}

const renderRunMode = ({
  initialStoreState = {},
  canRun = true,
}: { initialStoreState?: Record<string, unknown>; canRun?: boolean } = {}) =>
  renderWorkflowComponent(
    <EventEmitterContextProvider>
      <EmitterProbe>
        <RunMode />
      </EmitterProbe>
    </EventEmitterContextProvider>,
    {
      resource: { kind: 'knowledge-pipeline', pipelineId: 'pipeline-1' },
      injectWorkflowStoreSliceFn: createRagPipelineSliceSlice as InjectWorkflowStoreSliceFn,
      initialStoreState,
      hooksStoreProps: {
        handleWorkflowStartRunInWorkflow: mockHandleWorkflowStartRunInWorkflow,
        handleStopRun: mockHandleStopRun,
        accessControl: { ...fullWorkflowAccessControl, canRun },
      },
    },
  )

describe('RunMode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Idle state', () => {
    it('starts a test run from the button', async () => {
      const user = userEvent.setup()
      renderRunMode()

      await user.click(screen.getByRole('button', { name: /pipeline.common.testRun/ }))

      expect(mockHandleWorkflowStartRunInWorkflow).toHaveBeenCalledOnce()
    })

    it('starts a test run through the application shortcut', () => {
      renderRunMode()

      pressRunShortcut()

      expect(mockHandleWorkflowStartRunInWorkflow).toHaveBeenCalledOnce()
    })

    it('ignores the run shortcut for users without run access', () => {
      renderRunMode({ canRun: false })

      expect(
        screen.queryByRole('button', { name: /pipeline.common.testRun/ }),
      ).not.toBeInTheDocument()
      pressRunShortcut()

      expect(mockHandleWorkflowStartRunInWorkflow).not.toHaveBeenCalled()
    })
  })

  describe('Running state', () => {
    const running = {
      workflowRunningData: baseRunningData({
        task_id: 'task-1',
        result: { status: WorkflowRunningStatus.Running },
      }),
    }

    it('stops the current task from the stop button', async () => {
      const user = userEvent.setup()
      renderRunMode({ initialStoreState: running })

      await user.click(
        screen.getByRole('button', { name: 'workflowDebug.debug.variableInspect.trigger.stop' }),
      )

      expect(screen.getByRole('button', { name: 'pipeline.common.processing' })).toBeDisabled()
      expect(mockHandleWorkflowStartRunInWorkflow).not.toHaveBeenCalled()
      expect(mockHandleStopRun).toHaveBeenCalledExactlyOnceWith('task-1')
    })

    it('stops the current task when another panel requests a workflow stop', () => {
      renderRunMode({ initialStoreState: running })

      act(() => emitWorkflowEvent?.({ type: EVENT_WORKFLOW_STOP }))

      expect(mockHandleStopRun).toHaveBeenCalledExactlyOnceWith('task-1')
    })
  })

  it('offers a rerun once a previous run has finished', async () => {
    const user = userEvent.setup()
    renderRunMode({
      initialStoreState: {
        workflowRunningData: baseRunningData({
          task_id: 'task-1',
          result: { status: WorkflowRunningStatus.Succeeded },
        }),
      },
    })

    await user.click(screen.getByRole('button', { name: /pipeline.common.reRun/ }))

    expect(mockHandleWorkflowStartRunInWorkflow).toHaveBeenCalledOnce()
  })

  it('closes datasource preparation and the run panel on cancel', async () => {
    const user = userEvent.setup()
    const { store } = renderRunMode({
      initialStoreState: { isPreparingDataSource: true, showDebugAndPreviewPanel: true },
    })

    expect(
      screen.getByRole('button', { name: 'pipeline.common.preparingDataSource' }),
    ).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))

    expect(store.getState()).toMatchObject({
      isPreparingDataSource: false,
      showDebugAndPreviewPanel: false,
    })
    expect(screen.getByRole('button', { name: /pipeline.common.testRun/ })).toBeEnabled()
  })
})
