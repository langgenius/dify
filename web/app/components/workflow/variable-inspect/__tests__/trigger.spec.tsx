import type { WorkflowDraftVariableResponse } from '@dify/contracts/api/console/apps/types.gen'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { VarInInspectType } from '@/types/workflow'
import { createNode } from '../../__tests__/fixtures'
import { InspectVarsProvider } from '../../__tests__/inspect-vars-provider'
import { baseRunningData, renderWorkflowFlowComponent } from '../../__tests__/workflow-test-env'
import { BlockEnum, NodeRunningStatus, VarType, WorkflowRunningStatus } from '../../types'
import VariableInspectTrigger from '../trigger'
import { EVENT_WORKFLOW_STOP } from '../types'

const mockEmit = vi.hoisted(() => vi.fn())
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses, withConsoleClientResponses } =
    await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'apps.byAppId.workflows.draft.variables.delete': async () => ({}),
    }),
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'apps.byAppId.workflows.draft.conversationVariables.get': async () => ({ items: [] }),
      'apps.byAppId.workflows.draft.systemVariables.get': async () => ({ items: [] }),
      'workspaces.current.tools.builtin.get': async () => [],
      'workspaces.current.tools.api.get': async () => [],
      'workspaces.current.tools.workflow.get': async () => [],
      'workspaces.current.tools.mcp.get': async () => [],
    }),
  }
})

vi.mock('@/context/event-emitter', () => ({
  useEventEmitterContextContext: () => ({
    eventEmitter: {
      emit: mockEmit,
    },
  }),
}))

const createVariable = (
  overrides: Partial<WorkflowDraftVariableResponse> = {},
): WorkflowDraftVariableResponse => ({
  id: 'var-1',
  type: VarInInspectType.conversation,
  name: 'result',
  description: '',
  selector: ['conversation', 'result'],
  value_type: VarType.string,
  value: 'cached',
  edited: false,
  visible: true,
  is_truncated: false,
  full_content: {
    size_bytes: 0,
    download_url: '',
    length: 0,
    value_type: VarType.string,
  },
  ...overrides,
})

const renderTrigger = ({
  nodes = [createNode()],
  initialStoreState = {},
  conversationVars = [],
}: {
  nodes?: Array<ReturnType<typeof createNode>>
  initialStoreState?: Record<string, unknown>
  conversationVars?: WorkflowDraftVariableResponse[]
} = {}) => {
  const { queryClient } = createConsoleQueryWrapper()
  queryClient.setQueryData(
    consoleQuery.apps.byAppId.workflows.draft.conversationVariables.get.queryKey({
      input: { params: { app_id: 'app-1' } },
    }),
    { items: conversationVars },
  )
  return renderWorkflowFlowComponent(
    <InspectVarsProvider>
      <VariableInspectTrigger />
    </InspectVarsProvider>,
    {
      queryClient,
      nodes,
      edges: [],
      initialStoreState,
    },
  )
}

describe('VariableInspectTrigger', () => {
  it('should stay hidden when the variable-inspect panel is already open', () => {
    renderTrigger({
      initialStoreState: {
        showVariableInspectPanel: true,
      },
    })

    expect(
      screen.queryByText('workflowDebug.debug.variableInspect.trigger.normal'),
    ).not.toBeInTheDocument()
  })

  it('should open the panel from the normal trigger state with the keyboard', async () => {
    const user = userEvent.setup()
    const { store } = renderTrigger()

    await user.tab()
    await user.tab()
    expect(
      screen.getByRole('button', { name: 'workflowDebug.debug.variableInspect.trigger.normal' }),
    ).toHaveFocus()
    await user.keyboard('{Enter}')

    expect(store.getState().showVariableInspectPanel).toBe(true)
  })

  it('should block opening while the workflow is read only', async () => {
    const user = userEvent.setup()
    const { store } = renderTrigger({
      initialStoreState: {
        isRestoring: true,
      },
    })

    await user.click(screen.getByText('workflowDebug.debug.variableInspect.trigger.normal'))

    expect(store.getState().showVariableInspectPanel).toBe(false)
  })

  it('should clear cached variables and reset the focused node with the keyboard', async () => {
    const user = userEvent.setup()
    const { store } = renderTrigger({
      conversationVars: [
        createVariable({ id: 'conversation-var', type: VarInInspectType.conversation }),
      ],
      initialStoreState: {
        currentFocusNodeId: 'node-2',
      },
    })

    await user.tab()
    await user.tab()
    await user.tab()
    expect(
      screen.getByRole('button', { name: 'workflowDebug.debug.variableInspect.trigger.clear' }),
    ).toHaveFocus()
    await user.keyboard(' ')

    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'workflowDebug.debug.variableInspect.trigger.clear' }),
      ).not.toBeInTheDocument(),
    )
    expect(
      screen.getByRole('button', { name: 'workflowDebug.debug.variableInspect.trigger.normal' }),
    ).toBeInTheDocument()
    expect(store.getState().currentFocusNodeId).toBe('')
  })

  it('exposes a named stop button that works from the keyboard', async () => {
    const user = userEvent.setup()
    renderTrigger({
      initialStoreState: {
        workflowRunningData: baseRunningData({ result: { status: WorkflowRunningStatus.Running } }),
      },
    })
    await user.tab()
    await user.tab()
    await user.tab()
    expect(
      screen.getByRole('button', { name: 'workflowDebug.debug.variableInspect.trigger.stop' }),
    ).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(mockEmit).toHaveBeenCalledWith({ type: EVENT_WORKFLOW_STOP })
  })

  it('should show the running state and open the panel while running', async () => {
    const user = userEvent.setup()
    const { store } = renderTrigger({
      nodes: [
        createNode({
          data: {
            type: BlockEnum.Code,
            title: 'Code',
            desc: '',
            _singleRunningStatus: NodeRunningStatus.Running,
          },
        }),
      ],
      initialStoreState: {
        workflowRunningData: baseRunningData({
          result: { status: WorkflowRunningStatus.Running },
        }),
      },
    })

    await user.click(screen.getByText('workflowDebug.debug.variableInspect.trigger.running'))

    expect(
      screen.queryByText('workflowDebug.debug.variableInspect.trigger.clear'),
    ).not.toBeInTheDocument()
    expect(store.getState().showVariableInspectPanel).toBe(true)
  })
})
