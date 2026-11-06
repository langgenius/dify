import type { EventEmitterValue } from '@/context/event-emitter'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { EventEmitterContextProvider } from '@/context/event-emitter-provider'
import { renderWorkflowEditor } from '@/test/workflow-editor'
import { BlockEnum } from '../../types'
import Panel from '../panel'
import { EVENT_WORKFLOW_STOP } from '../types'

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'workspaces.current.triggers.get': async () => [],
    }),
  }
})

function setup(
  initialStoreState: NonNullable<
    Parameters<typeof renderWorkflowEditor>[1]
  >['initialStoreState'] = {},
) {
  const onWorkflowEvent = vi.fn<(event: EventEmitterValue) => void>()
  function Observer() {
    const { eventEmitter } = useEventEmitterContextContext()
    eventEmitter?.useSubscription(onWorkflowEvent)
    return <Panel />
  }
  const rendered = renderWorkflowEditor(
    <EventEmitterContextProvider>
      <Observer />
    </EventEmitterContextProvider>,
    {
      nodes: [],
      edges: [],
      initialStoreState: { showVariableInspectPanel: true, ...initialStoreState },
      historyStore: { nodes: [], edges: [] },
    },
  )
  return { ...rendered, user: userEvent.setup(), onWorkflowEvent }
}

it('emits the workflow stop command while listening and closes the panel', async () => {
  const { user, store, onWorkflowEvent } = setup({
    isListening: true,
    listeningTriggerType: BlockEnum.TriggerWebhook,
  })
  expect(screen.getByText('workflowDebug.debug.variableInspect.listening.title')).toBeVisible()
  await user.click(
    screen.getByRole('button', {
      name: 'workflowDebug.debug.variableInspect.listening.stopButton',
    }),
  )
  expect(onWorkflowEvent).toHaveBeenCalledWith({ type: EVENT_WORKFLOW_STOP })
  await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
  expect(store.getState().showVariableInspectPanel).toBe(false)
})

it('shows the empty state and closes from the header', async () => {
  const { user, store } = setup()
  expect(await screen.findByText('workflowDebug.debug.variableInspect.emptyTip')).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
  expect(store.getState().showVariableInspectPanel).toBe(false)
})

it('selects an environment variable and shows its details', async () => {
  const { user } = setup({
    environmentVariables: [
      {
        id: 'env-1',
        name: 'API_KEY',
        value: 'env-value',
        value_type: 'string',
        description: '',
      },
    ],
    bottomPanelWidth: 560,
  })
  await user.click(screen.getByText('API_KEY'))
  expect(screen.getByText('workflowDebug.debug.variableInspect.envNode')).toBeVisible()
  expect(await screen.findByText('env-value')).toBeVisible()
})
