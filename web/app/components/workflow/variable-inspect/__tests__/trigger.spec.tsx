import type { NodeWithVar, VarInInspect } from '@/types/workflow'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { VarInInspectType } from '@/types/workflow'
import { createNode } from '../../__tests__/fixtures'
import { baseRunningData, renderWorkflowFlowComponent } from '../../__tests__/workflow-test-env'
import { BlockEnum, NodeRunningStatus, VarType, WorkflowRunningStatus } from '../../types'
import VariableInspectTrigger from '../trigger'
import { EVENT_WORKFLOW_STOP } from '../types'

type InspectVarsState = {
  conversationVars: VarInInspect[]
  systemVars: VarInInspect[]
  nodesWithInspectVars: NodeWithVar[]
}

const { mockDeleteAllInspectorVars, mockEmit } = vi.hoisted(() => ({
  mockDeleteAllInspectorVars: vi.fn(),
  mockEmit: vi.fn(),
}))

let inspectVarsState: InspectVarsState

vi.mock('../../hooks/use-inspect-vars-crud', () => ({
  default: () => ({
    ...inspectVarsState,
    deleteAllInspectorVars: mockDeleteAllInspectorVars,
  }),
}))

vi.mock('@/context/event-emitter', () => ({
  useEventEmitterContextContext: () => ({
    eventEmitter: {
      emit: mockEmit,
    },
  }),
}))

const createVariable = (overrides: Partial<VarInInspect> = {}): VarInInspect => ({
  id: 'var-1',
  type: VarInInspectType.node,
  name: 'result',
  description: '',
  selector: ['node-1', 'result'],
  value_type: VarType.string,
  value: 'cached',
  edited: false,
  visible: true,
  is_truncated: false,
  full_content: {
    size_bytes: 0,
    download_url: '',
  },
  ...overrides,
})

const renderTrigger = ({
  nodes = [createNode()],
  initialStoreState = {},
}: {
  nodes?: Array<ReturnType<typeof createNode>>
  initialStoreState?: Record<string, unknown>
} = {}) => {
  return renderWorkflowFlowComponent(<VariableInspectTrigger />, {
    nodes,
    edges: [],
    initialStoreState,
  })
}

describe('VariableInspectTrigger', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    inspectVarsState = {
      conversationVars: [],
      systemVars: [],
      nodesWithInspectVars: [],
    }
  })

  it('should stay hidden when the variable-inspect panel is already open', () => {
    renderTrigger({
      initialStoreState: {
        showVariableInspectPanel: true,
      },
    })

    expect(
      screen.queryByRole('button', {
        name: 'workflow.debug.variableInspect.trigger.normal',
      }),
    ).not.toBeInTheDocument()
  })

  it('should open the panel from the normal trigger state with the keyboard', async () => {
    const user = userEvent.setup()
    const { store } = renderTrigger()
    const trigger = screen.getByRole('button', {
      name: 'workflow.debug.variableInspect.trigger.normal',
    })

    trigger.focus()
    await user.keyboard('{Enter}')

    expect(store.getState().showVariableInspectPanel).toBe(true)
  })

  it('should disable opening while the workflow is read only', async () => {
    const user = userEvent.setup()
    const { store } = renderTrigger({
      initialStoreState: {
        isRestoring: true,
      },
    })
    const trigger = screen.getByRole('button', {
      name: 'workflow.debug.variableInspect.trigger.normal',
    })

    expect(trigger).toBeDisabled()
    await user.click(trigger)

    expect(store.getState().showVariableInspectPanel).toBe(false)
  })

  it('should clear cached variables and reset the focused node', async () => {
    const user = userEvent.setup()
    inspectVarsState = {
      conversationVars: [
        createVariable({
          id: 'conversation-var',
          type: VarInInspectType.conversation,
        }),
      ],
      systemVars: [],
      nodesWithInspectVars: [],
    }

    const { store } = renderTrigger({
      initialStoreState: {
        currentFocusNodeId: 'node-2',
      },
    })

    await user.click(
      screen.getByRole('button', {
        name: 'workflow.debug.variableInspect.trigger.clear',
      }),
    )

    expect(
      screen.getByRole('button', {
        name: 'workflow.debug.variableInspect.trigger.cached',
      }),
    ).toBeInTheDocument()
    expect(mockDeleteAllInspectorVars).toHaveBeenCalledTimes(1)
    expect(store.getState().currentFocusNodeId).toBe('')
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

    await user.click(
      screen.getByRole('button', {
        name: 'workflow.debug.variableInspect.trigger.running',
      }),
    )

    expect(
      screen.queryByRole('button', {
        name: 'workflow.debug.variableInspect.trigger.clear',
      }),
    ).not.toBeInTheDocument()
    expect(store.getState().showVariableInspectPanel).toBe(true)
  })

  it('should expose an accessible stop action while the preview is running', async () => {
    const user = userEvent.setup()
    renderTrigger({
      initialStoreState: {
        workflowRunningData: baseRunningData({
          result: { status: WorkflowRunningStatus.Running },
        }),
      },
    })

    await user.click(
      screen.getByRole('button', {
        name: 'workflow.debug.variableInspect.trigger.stop',
      }),
    )

    expect(mockEmit).toHaveBeenCalledWith({
      type: EVENT_WORKFLOW_STOP,
    })
  })
})
