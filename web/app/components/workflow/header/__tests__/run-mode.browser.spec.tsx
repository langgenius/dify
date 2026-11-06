import type { WorkflowProviderOptions } from '../../__tests__/workflow-test-providers'
import type { TestRunOptions } from '../test-run-menu'
import { createContext, use } from 'react'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import {
  createStoresFromOptions,
  createWorkflowWrapper,
} from '../../__tests__/workflow-test-providers'
import { fullWorkflowAccessControl } from '../../hooks-store/store'
import { WorkflowRunningStatus } from '../../types'
import RunMode from '../run-mode'
import { TriggerType } from '../test-run-menu'

const { discovery, start, schedule, runAll, stop, unexpectedFetch } = vi.hoisted(() => ({
  discovery: vi.fn(),
  start: vi.fn(),
  schedule: vi.fn(),
  runAll: vi.fn(),
  stop: vi.fn(),
  unexpectedFetch: vi.fn<typeof fetch>(() => new Promise(() => {})),
}))

const ValidationContext = createContext({
  hasValidationErrors: true,
  warningNodes: [{ id: 'downstream-node' }],
})

// Graph validation and trigger discovery own separate suites; the menu and keyboard integration stay real.
vi.mock('../../hooks/use-checklist', () => ({
  useWorkflowRunValidation: () => use(ValidationContext),
}))
vi.mock('../../hooks/use-dynamic-test-run-options', () => ({
  useDynamicTestRunOptions: discovery,
}))
vi.mock('@/app/components/base/amplitude', () => ({ trackEvent: vi.fn() }))

const userInput = {
  id: 'start',
  type: TriggerType.UserInput,
  name: 'User input',
  nodeId: 'start-node',
  icon: null,
  enabled: true,
}

async function setup(initialStoreState: WorkflowProviderOptions['initialStoreState'] = {}) {
  const stores = createStoresFromOptions({
    initialStoreState,
    hooksStoreProps: {
      accessControl: fullWorkflowAccessControl,
      handleWorkflowStartRunInWorkflow: start,
      handleWorkflowTriggerScheduleRunInWorkflow: schedule,
      handleWorkflowRunAllTriggersInWorkflow: runAll,
      handleStopRun: stop,
    },
  })
  const Wrapper = createWorkflowWrapper(stores)
  const view = (hasValidationErrors: boolean) => (
    <ValidationContext
      value={{
        hasValidationErrors,
        warningNodes: hasValidationErrors ? [{ id: 'downstream-node' }] : [],
      }}
    >
      <Wrapper>
        <RunMode />
      </Wrapper>
    </ValidationContext>
  )
  const screen = await render(view(true))
  return { ...screen, resolveErrors: () => screen.rerender(view(false)) }
}

beforeEach(() => {
  discovery.mockReturnValue({ userInput, triggers: [] } satisfies TestRunOptions)
  vi.stubGlobal('fetch', unexpectedFetch)
})

afterEach(() => {
  vi.unstubAllGlobals()
  expect(unexpectedFetch).not.toHaveBeenCalled()
})

it('blocks downstream validation errors by button and shortcut, then runs once they are resolved', async () => {
  const screen = await setup()
  const run = screen.getByRole('button', { name: /workflow.common.run/ })
  await expect.element(run).toBeDisabled()
  // Native disabled controls cannot be clicked by browser locators; keyboard activation must also stay blocked.
  await userEvent.keyboard('{Alt>}r{/Alt}')
  expect(start).not.toHaveBeenCalled()
  await expect.element(page.getByRole('menu')).not.toBeInTheDocument()

  await screen.resolveErrors()
  await expect.element(run).toBeEnabled()
  await run.click()
  expect(start).toHaveBeenCalledOnce()
})

it('keeps trigger and run-all actions inaccessible until downstream validation passes', async () => {
  discovery.mockReturnValue({
    userInput,
    triggers: [
      {
        id: 'schedule',
        type: TriggerType.Schedule,
        name: 'Daily schedule',
        nodeId: 'schedule-node',
        icon: null,
        enabled: true,
      },
    ],
    runAll: {
      id: 'all',
      type: TriggerType.All,
      name: 'All triggers',
      relatedNodeIds: ['schedule-node'],
      icon: null,
      enabled: true,
    },
  } satisfies TestRunOptions)
  const screen = await setup()
  await expect.element(screen.getByRole('button', { name: /workflow.common.run/ })).toBeDisabled()
  await userEvent.keyboard('{Alt>}r{/Alt}')
  await expect.element(page.getByRole('menu')).not.toBeInTheDocument()
  expect(schedule).not.toHaveBeenCalled()
  expect(runAll).not.toHaveBeenCalled()

  await screen.resolveErrors()
  await userEvent.keyboard('{Alt>}r{/Alt}')
  await expect.element(page.getByRole('menu')).toBeVisible()
  await page.getByRole('menuitem', { name: /Daily schedule/ }).click()
  expect(schedule).toHaveBeenCalledExactlyOnceWith('schedule-node')
  await screen.getByRole('button', { name: /workflow.common.run/ }).click()
  await expect.element(page.getByRole('menu')).toBeVisible()
  await page.getByRole('menuitem', { name: /All triggers/ }).click()
  expect(runAll).toHaveBeenCalledExactlyOnceWith(['schedule-node'])
})

it('keeps Stop available with validation errors during an active run', async () => {
  const screen = await setup({
    workflowRunningData: {
      task_id: 'task-1',
      result: { status: WorkflowRunningStatus.Running },
    } as NonNullable<WorkflowProviderOptions['initialStoreState']>['workflowRunningData'],
  })
  await screen
    .getByRole('button', {
      name: 'workflowDebug.debug.variableInspect.trigger.stop',
    })
    .click()
  expect(stop).toHaveBeenCalledExactlyOnceWith('task-1')
})
