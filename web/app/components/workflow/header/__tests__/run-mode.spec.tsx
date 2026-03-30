import type { ReactNode } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
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

let mockWarningNodes: Array<{ id: string }> = []
let mockWorkflowRunningData: { result: { status: WorkflowRunningStatus }, task_id: string } | undefined
let mockIsListening = false
let mockDynamicOptions = [
  { type: TriggerType.UserInput, nodeId: 'start-node' },
]

vi.mock('@/app/components/workflow/hooks', () => ({
  useWorkflowStartRun: () => ({
    handleWorkflowStartRunInWorkflow: mockHandleWorkflowStartRunInWorkflow,
    handleWorkflowTriggerScheduleRunInWorkflow: mockHandleWorkflowTriggerScheduleRunInWorkflow,
    handleWorkflowTriggerWebhookRunInWorkflow: mockHandleWorkflowTriggerWebhookRunInWorkflow,
    handleWorkflowTriggerPluginRunInWorkflow: mockHandleWorkflowTriggerPluginRunInWorkflow,
    handleWorkflowRunAllTriggersInWorkflow: mockHandleWorkflowRunAllTriggersInWorkflow,
  }),
  useWorkflowRun: () => ({
    handleStopRun: mockHandleStopRun,
  }),
  useWorkflowRunValidation: () => ({
    warningNodes: mockWarningNodes,
  }),
}))

vi.mock('@/app/components/workflow/store', () => ({
  useStore: (selector: (state: { workflowRunningData?: unknown, isListening: boolean }) => unknown) =>
    selector({ workflowRunningData: mockWorkflowRunningData, isListening: mockIsListening }),
}))

vi.mock('../../hooks/use-dynamic-test-run-options', () => ({
  useDynamicTestRunOptions: () => mockDynamicOptions,
}))

vi.mock('@/app/components/base/ui/toast', () => ({
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

vi.mock('@/app/components/workflow/shortcuts-name', () => ({
  default: () => <span data-testid="shortcuts-name">Shortcut</span>,
}))

vi.mock('@/app/components/base/icons/src/vender/line/mediaAndDevices', () => ({
  StopCircle: () => <span data-testid="stop-circle" />,
}))

vi.mock('../test-run-menu', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../test-run-menu')>()
  return {
    ...actual,
    default: React.forwardRef(({ children, options, onSelect }: { children: ReactNode, options: Array<{ type: TriggerType, nodeId?: string, relatedNodeIds?: string[] }>, onSelect: (option: { type: TriggerType, nodeId?: string, relatedNodeIds?: string[] }) => void }, ref) => {
      React.useImperativeHandle(ref, () => ({
        toggle: vi.fn(),
      }))
      return (
        <div>
          <button data-testid="trigger-option" onClick={() => onSelect(options[0])}>
            Trigger option
          </button>
          {children}
        </div>
      )
    }),
  }
})

describe('RunMode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWarningNodes = []
    mockWorkflowRunningData = undefined
    mockIsListening = false
    mockDynamicOptions = [
      { type: TriggerType.UserInput, nodeId: 'start-node' },
    ]
  })

  it('should render the run trigger and start the workflow when a valid trigger is selected', () => {
    render(<RunMode />)

    expect(screen.getByText(/run/i)).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('trigger-option'))

    expect(mockHandleWorkflowStartRunInWorkflow).toHaveBeenCalledTimes(1)
    expect(mockTrackEvent).toHaveBeenCalledWith('app_start_action_time', { action_type: 'user_input' })
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

    expect(screen.getByText(/running/i)).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('stop-circle').closest('button') as HTMLButtonElement)

    expect(mockHandleStopRun).toHaveBeenCalledWith('task-1')
  })

  it('should render the listening label when the workflow is listening', () => {
    mockIsListening = true

    render(<RunMode />)

    expect(screen.getByText(/listening/i)).toBeInTheDocument()
  })
})
