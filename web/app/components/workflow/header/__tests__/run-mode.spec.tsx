import type { TestRunOptions } from '../test-run-menu'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { trackEvent } from '@/app/components/base/amplitude'
import { toast } from '@/app/notifications'
import { baseRunningData, renderWorkflowComponent } from '../../__tests__/workflow-test-env'
import { fullWorkflowAccessControl } from '../../hooks-store/store'
import RunMode from '../run-mode'
import { TriggerType } from '../test-run-menu'

const mockHandleWorkflowStartRunInWorkflow = vi.fn()
const mockHandleWorkflowTriggerScheduleRunInWorkflow = vi.fn()
const mockHandleWorkflowTriggerWebhookRunInWorkflow = vi.fn()
const mockHandleWorkflowTriggerPluginRunInWorkflow = vi.fn()
const mockHandleWorkflowRunAllTriggersInWorkflow = vi.fn()
const mockHandleStopRun = vi.fn()
let mockWarningNodes: Array<{ id: string }> = []
let mockDynamicOptions: TestRunOptions

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

vi.mock('../../hooks/use-dynamic-test-run-options', () => ({
  useDynamicTestRunOptions: () => mockDynamicOptions,
}))
vi.mock('@/app/components/base/amplitude', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/components/base/amplitude')>()),
  trackEvent: vi.fn(),
}))

beforeEach(() => {
  vi.clearAllMocks()
  mockWarningNodes = []
  mockDynamicOptions = {
    userInput: {
      id: 'start',
      type: TriggerType.UserInput,
      name: 'User input',
      nodeId: 'start-node',
      icon: null,
      enabled: true,
    },
    triggers: [],
  }
})

it('starts the sole user-input option from the real run button', async () => {
  const user = userEvent.setup()
  renderWorkflowComponent(<RunMode />)
  await user.click(screen.getByRole('button', { name: /workflow.common.run/ }))
  expect(mockHandleWorkflowStartRunInWorkflow).toHaveBeenCalledOnce()
  expect(trackEvent).toHaveBeenCalledWith('app_start_action_time', { action_type: 'user_input' })
})

it('reports checklist warnings without starting the selected trigger', async () => {
  const user = userEvent.setup()
  const error = vi.spyOn(toast, 'error')
  mockWarningNodes = [{ id: 'start-node' }]
  renderWorkflowComponent(<RunMode />)
  await user.click(screen.getByRole('button', { name: /workflow.common.run/ }))
  expect(error).toHaveBeenCalledWith('workflow.panel.checklistTip')
  expect(mockHandleWorkflowStartRunInWorkflow).not.toHaveBeenCalled()
})

it.each([false, true])('stops the active task while listening=%s', async (isListening) => {
  const user = userEvent.setup()
  renderWorkflowComponent(<RunMode />, {
    initialStoreState: { workflowRunningData: baseRunningData(), isListening },
  })
  expect(screen.getByRole('button', { name: isListening ? /listening/ : /running/ })).toBeDisabled()
  await user.click(
    screen.getByRole('button', { name: 'workflowDebug.debug.variableInspect.trigger.stop' }),
  )
  expect(mockHandleStopRun).toHaveBeenCalledExactlyOnceWith('task-1')
})

it('opens the real menu with the page shortcut, ignores repeats and inputs, and runs the chosen trigger', async () => {
  const user = userEvent.setup()
  mockDynamicOptions.triggers = [
    {
      id: 'schedule',
      type: TriggerType.Schedule,
      name: 'Daily schedule',
      nodeId: 'schedule-node',
      icon: null,
      enabled: true,
    },
  ]
  const { rerender } = renderWorkflowComponent(
    <>
      <RunMode />
      <input aria-label="Prompt" />
      <button onKeyDown={(event) => event.preventDefault()}>Local control</button>
    </>,
  )
  await user.keyboard('{Alt>}{r>3/}{/Alt}')
  expect(screen.getByRole('menu')).toBeInTheDocument()
  await user.click(screen.getByRole('menuitem', { name: /Daily schedule/ }))
  expect(mockHandleWorkflowTriggerScheduleRunInWorkflow).toHaveBeenCalledExactlyOnceWith(
    'schedule-node',
  )
  expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  await user.click(screen.getByRole('textbox', { name: 'Prompt' }))
  await user.keyboard('{Alt>}r{/Alt}')
  await user.click(screen.getByRole('button', { name: 'Local control' }))
  await user.keyboard('{Alt>}r{/Alt}')
  expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  rerender(<RunMode disabled />)
  await user.keyboard('{Alt>}r{/Alt}')
  expect(screen.queryByRole('menu')).not.toBeInTheDocument()
})

it('blocks clicks and shortcuts when run permission is denied, including during an active run', async () => {
  const user = userEvent.setup()
  renderWorkflowComponent(<RunMode />, {
    initialStoreState: { workflowRunningData: baseRunningData() },
    hooksStoreProps: { accessControl: { ...fullWorkflowAccessControl, canRun: false } },
  })
  const run = screen.getByRole('button', { name: /workflow.common.run/ })
  expect(run).toBeDisabled()
  await user.click(run)
  await user.keyboard('{Alt>}r{/Alt}')
  expect(
    screen.queryByRole('button', { name: 'workflowDebug.debug.variableInspect.trigger.stop' }),
  ).not.toBeInTheDocument()
  expect(mockHandleWorkflowStartRunInWorkflow).not.toHaveBeenCalled()
  expect(mockHandleStopRun).not.toHaveBeenCalled()
})
