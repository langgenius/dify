import type { Node as ReactFlowNode } from 'reactflow'
import type { CommonNodeType } from '../../types'
import type { NodeWithVar, VarInInspect } from '@/types/workflow'
import { fireEvent, screen } from '@testing-library/react'
import ReactFlow, { ReactFlowProvider } from 'reactflow'
import { VarInInspectType } from '@/types/workflow'
import { baseRunningData, renderWorkflowComponent } from '../../__tests__/workflow-test-env'
import { BlockEnum, NodeRunningStatus, VarType, WorkflowRunningStatus } from '../../types'
import VariableInspectTrigger from '../trigger'

type InspectVarsState = {
  conversationVars: VarInInspect[]
  systemVars: VarInInspect[]
  nodesWithInspectVars: NodeWithVar[]
}

const {
  mockDeleteAllInspectorVars,
  mockEmit,
} = vi.hoisted(() => ({
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

const createNode = (overrides: Partial<CommonNodeType> = {}): ReactFlowNode<CommonNodeType> => ({
  id: 'node-1',
  type: 'custom',
  position: { x: 0, y: 0 },
  data: {
    type: BlockEnum.Code,
    title: 'Code',
    desc: '',
    ...overrides,
  },
})

const renderTrigger = ({
  nodes = [createNode()],
  initialStoreState = {},
}: {
  nodes?: Array<ReactFlowNode<CommonNodeType>>
  initialStoreState?: Record<string, unknown>
} = {}) => {
  return renderWorkflowComponent(
    <div style={{ width: 800, height: 600 }}>
      <ReactFlowProvider>
        <ReactFlow fitView nodes={nodes} edges={[]} />
        <VariableInspectTrigger />
      </ReactFlowProvider>
    </div>,
    {
      initialStoreState,
    },
  )
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

    expect(screen.queryByText('workflow.debug.variableInspect.trigger.normal')).not.toBeInTheDocument()
  })

  it('should open the panel from the normal trigger state', () => {
    const { store } = renderTrigger()

    fireEvent.click(screen.getByText('workflow.debug.variableInspect.trigger.normal'))

    expect(store.getState().showVariableInspectPanel).toBe(true)
  })

  it('should block opening while the workflow is read only', () => {
    const { store } = renderTrigger({
      initialStoreState: {
        isRestoring: true,
      },
    })

    fireEvent.click(screen.getByText('workflow.debug.variableInspect.trigger.normal'))

    expect(store.getState().showVariableInspectPanel).toBe(false)
  })

  it('should clear cached variables and reset the focused node', () => {
    inspectVarsState = {
      conversationVars: [createVariable({
        id: 'conversation-var',
        type: VarInInspectType.conversation,
      })],
      systemVars: [],
      nodesWithInspectVars: [],
    }

    const { store } = renderTrigger({
      initialStoreState: {
        currentFocusNodeId: 'node-2',
      },
    })

    fireEvent.click(screen.getByText('workflow.debug.variableInspect.trigger.clear'))

    expect(screen.getByText('workflow.debug.variableInspect.trigger.cached')).toBeInTheDocument()
    expect(mockDeleteAllInspectorVars).toHaveBeenCalledTimes(1)
    expect(store.getState().currentFocusNodeId).toBe('')
  })

  it('should show the running state and open the panel while running', () => {
    const { store } = renderTrigger({
      nodes: [createNode({ _singleRunningStatus: NodeRunningStatus.Running })],
      initialStoreState: {
        workflowRunningData: baseRunningData({
          result: { status: WorkflowRunningStatus.Running },
        }),
      },
    })

    fireEvent.click(screen.getByText('workflow.debug.variableInspect.trigger.running'))

    expect(screen.queryByText('workflow.debug.variableInspect.trigger.clear')).not.toBeInTheDocument()
    expect(store.getState().showVariableInspectPanel).toBe(true)
  })
})
