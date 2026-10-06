import type { ReactNode } from 'react'
import type { TestRunMenuRef } from '../test-run-menu'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { WorkflowRunningStatus } from '@/app/components/workflow/types'
import RunMode from '../run-mode'
import { TriggerType } from '../test-run-menu'

const mockHandleWorkflowStartRunInWorkflow = vi.fn()
const mockHandleWorkflowTriggerScheduleRunInWorkflow = vi.fn()
const mockHandleWorkflowTriggerWebhookRunInWorkflow = vi.fn()
const mockHandleWorkflowTriggerPluginRunInWorkflow = vi.fn()
const mockHandleWorkflowRunAllTriggersInWorkflow = vi.fn()
const mockHandleStopRun = vi.fn()
const mockNotify = vi.fn()
const mockTrackEvent = vi.fn()
const mockToggleMenu = vi.fn()

let mockWarningNodes: Array<{ id: string }> = []
let mockWorkflowRunningData:
  | { result: { status: WorkflowRunningStatus }; task_id: string }
  | undefined
let mockIsListening = false
let mockCanRun = true
let mockDynamicOptions = [{ type: TriggerType.UserInput, nodeId: 'start-node' }]

vi.mock('../../hooks/use-checklist', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../hooks/use-checklist')>()

  return {
    ...actual,
    useWorkflowRunValidation: () => ({
      warningNodes: mockWarningNodes,
    }),
  }
})

vi.mock('../../hooks/use-workflow-run', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../hooks/use-workflow-run')>()

  return {
    ...actual,
    useWorkflowRun: () => ({
      handleStopRun: mockHandleStopRun,
    }),
  }
})

vi.mock('../../hooks/use-workflow-start-run', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../hooks/use-workflow-start-run')>()

  return {
    ...actual,
    useWorkflowStartRun: () => ({
      handleWorkflowStartRunInWorkflow: mockHandleWorkflowStartRunInWorkflow,
      handleWorkflowTriggerScheduleRunInWorkflow: mockHandleWorkflowTriggerScheduleRunInWorkflow,
      handleWorkflowTriggerWebhookRunInWorkflow: mockHandleWorkflowTriggerWebhookRunInWorkflow,
      handleWorkflowTriggerPluginRunInWorkflow: mockHandleWorkflowTriggerPluginRunInWorkflow,
      handleWorkflowRunAllTriggersInWorkflow: mockHandleWorkflowRunAllTriggersInWorkflow,
    }),
  }
})

vi.mock('@/app/components/workflow/store/workflow', () => ({
  useStore: (
    selector: (state: { workflowRunningData?: unknown; isListening: boolean }) => unknown,
  ) => selector({ workflowRunningData: mockWorkflowRunningData, isListening: mockIsListening }),
}))

vi.mock('@/app/components/workflow/hooks-store', () => ({
  useHooksStore: <T,>(selector: (state: { accessControl: { canRun: boolean } }) => T): T =>
    selector({
      accessControl: {
        canRun: mockCanRun,
      },
    }),
}))

vi.mock('../../hooks/use-dynamic-test-run-options', () => ({
  useDynamicTestRunOptions: () => mockDynamicOptions,
}))

vi.mock('@/app/notifications', () => ({
  toast: {
    success: (message: string) => mockNotify({ type: 'success', message }),
    error: (message: string) => mockNotify({ type: 'error', message }),
    warning: (message: string) => mockNotify({ type: 'warning', message }),
    info: (message: string) => mockNotify({ type: 'info', message }),
  },
}))

vi.mock('@/app/components/base/amplitude', () => ({
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
}))

vi.mock('@/context/event-emitter', () => ({
  useEventEmitterContextContext: () => ({
    eventEmitter: {
      useSubscription: vi.fn(),
    },
  }),
}))

vi.mock('../test-run-menu', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../test-run-menu')>()
  const TestRunMenuMock = ({
    children,
    options,
    onSelect,
    ref,
  }: {
    children: ReactNode
    options: Array<{ type: TriggerType; nodeId?: string; relatedNodeIds?: string[] }>
    onSelect: (option: { type: TriggerType; nodeId?: string; relatedNodeIds?: string[] }) => void
    ref?: React.Ref<TestRunMenuRef>
  }) => {
    React.useImperativeHandle(ref, () => ({
      toggle: mockToggleMenu,
    }))
    return (
      <div>
        <button data-testid="trigger-option" onClick={() => onSelect(options[0]!)}>
          Trigger option
        </button>
        {children}
      </div>
    )
  }

  return {
    ...actual,
    default: TestRunMenuMock,
  }
})

describe('RunMode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWarningNodes = []
    mockWorkflowRunningData = undefined
    mockIsListening = false
    mockCanRun = true
    mockDynamicOptions = [{ type: TriggerType.UserInput, nodeId: 'start-node' }]
  })

  it('should render the run trigger and start the workflow when a valid trigger is selected', () => {
    render(<RunMode />)

    expect(screen.getByText(/run/i))!.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('trigger-option'))

    expect(mockHandleWorkflowStartRunInWorkflow).toHaveBeenCalledTimes(1)
    expect(mockTrackEvent).toHaveBeenCalledWith('app_start_action_time', {
      action_type: 'user_input',
    })
  })

  it('should show an error toast instead of running when the selected trigger has checklist warnings', () => {
    mockWarningNodes = [{ id: 'start-node' }]

    render(<RunMode />)
    fireEvent.click(screen.getByTestId('trigger-option'))

    expect(mockNotify).toHaveBeenCalledWith({
      type: 'error',
      message: 'workflow.panel.checklistTip',
    })
    expect(mockHandleWorkflowStartRunInWorkflow).not.toHaveBeenCalled()
  })

  it('should render the running state and stop the workflow when it is already running', () => {
    mockWorkflowRunningData = {
      result: { status: WorkflowRunningStatus.Running },
      task_id: 'task-1',
    }

    render(<RunMode />)

    expect(screen.getByText(/running/i))!.toBeInTheDocument()
    fireEvent.click(
      screen.getByRole('button', { name: 'workflowDebug.debug.variableInspect.trigger.stop' }),
    )

    expect(mockHandleStopRun).toHaveBeenCalledWith('task-1')
  })

  it('should render the listening label when the workflow is listening', () => {
    mockIsListening = true

    render(<RunMode />)

    expect(screen.getByText(/listening/i))!.toBeInTheDocument()
  })

  it('opens the test run menu from the page but not an input, handled key, or disabled trigger', async () => {
    const user = userEvent.setup()
    const { rerender } = render(
      <>
        <RunMode />
        <input aria-label="Prompt" />
        <button onKeyDown={(event) => event.preventDefault()}>Local control</button>
      </>,
    )
    const runKeyEvents: KeyboardEvent[] = []
    const recordRunKeys = (event: KeyboardEvent) => {
      if (event.key === 'r') runKeyEvents.push(event)
    }
    document.addEventListener('keydown', recordRunKeys)
    await user.keyboard('{Alt>}{r>3/}{/Alt}')
    document.removeEventListener('keydown', recordRunKeys)
    expect(runKeyEvents).toHaveLength(3)
    expect(runKeyEvents.every((event) => event.defaultPrevented)).toBe(true)
    expect(mockToggleMenu).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('textbox', { name: 'Prompt' }))
    await user.keyboard('{Alt>}r{/Alt}')
    await user.click(screen.getByRole('button', { name: 'Local control' }))
    await user.keyboard('{Alt>}r{/Alt}')
    expect(mockToggleMenu).toHaveBeenCalledTimes(1)
    rerender(<RunMode disabled />)
    await user.keyboard('{Alt>}r{/Alt}')
    expect(mockToggleMenu).toHaveBeenCalledTimes(1)
  })

  it('should keep the run trigger visible and disabled when workflow run permission is denied', () => {
    mockCanRun = false
    mockWorkflowRunningData = {
      result: { status: WorkflowRunningStatus.Running },
      task_id: 'task-1',
    }

    render(<RunMode />)

    expect(screen.getByRole('button', { name: /run/i })).toBeDisabled()
    expect(screen.queryByTestId('trigger-option')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'workflowDebug.debug.variableInspect.trigger.stop' }),
    ).not.toBeInTheDocument()
    expect(mockHandleWorkflowStartRunInWorkflow).not.toHaveBeenCalled()
  })
})
