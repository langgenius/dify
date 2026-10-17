import type { EnvironmentVariable } from '../../types'
import type { NodeWithVar, VarInInspect } from '@/types/workflow'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWorkflowFlowComponent } from '../../__tests__/workflow-test-env'
import { BlockEnum } from '../../types'
import Panel from '../panel'
import { EVENT_WORKFLOW_STOP } from '../types'

type InspectVarsState = {
  conversationVars: VarInInspect[]
  systemVars: VarInInspect[]
  nodesWithInspectVars: NodeWithVar[]
}

const {
  mockEditInspectVarValue,
  mockEmit,
  mockFetchInspectVarValue,
  mockHandleNodeSelect,
  mockResetConversationVar,
  mockResetToLastRunVar,
  mockSetInputs,
} = vi.hoisted(() => ({
  mockEditInspectVarValue: vi.fn(),
  mockEmit: vi.fn(),
  mockFetchInspectVarValue: vi.fn(),
  mockHandleNodeSelect: vi.fn(),
  mockResetConversationVar: vi.fn(),
  mockResetToLastRunVar: vi.fn(),
  mockSetInputs: vi.fn(),
}))

let inspectVarsState: InspectVarsState

vi.mock('../../hooks/use-inspect-vars-crud', () => ({
  default: () => ({
    ...inspectVarsState,
    deleteAllInspectorVars: vi.fn(),
    deleteNodeInspectorVars: vi.fn(),
    editInspectVarValue: mockEditInspectVarValue,
    fetchInspectVarValue: mockFetchInspectVarValue,
    resetConversationVar: mockResetConversationVar,
    resetToLastRunVar: mockResetToLastRunVar,
  }),
}))

vi.mock('../../nodes/_base/components/variable/use-match-schema-type', () => ({
  default: () => ({
    isLoading: false,
    schemaTypeDefinitions: {},
  }),
}))

vi.mock('../../hooks/use-nodes-interactions', () => ({
  useNodesInteractions: () => ({
    handleNodeSelect: mockHandleNodeSelect,
  }),
}))

vi.mock('../../hooks/use-tool-icon', () => ({
  useToolIcon: () => '',
  useGetToolIcon: () => () => '',
}))

vi.mock('../../nodes/_base/hooks/use-node-crud', () => ({
  default: () => ({
    setInputs: mockSetInputs,
  }),
}))

vi.mock('../../nodes/_base/hooks/use-node-info', () => ({
  default: () => ({
    node: undefined,
  }),
}))

vi.mock('@/context/event-emitter', () => ({
  useEventEmitterContextContext: () => ({
    eventEmitter: {
      emit: mockEmit,
    },
  }),
}))

const createEnvironmentVariable = (
  overrides: Partial<EnvironmentVariable> = {},
): EnvironmentVariable => ({
  id: 'env-1',
  name: 'API_KEY',
  value: 'env-value',
  value_type: 'string',
  description: '',
  ...overrides,
})

const renderPanel = (initialStoreState: Record<string, unknown> = {}) => {
  return renderWorkflowFlowComponent(<Panel />, {
    nodes: [],
    edges: [],
    initialStoreState,
    historyStore: {
      nodes: [],
      edges: [],
    },
  })
}

describe('VariableInspect Panel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    inspectVarsState = {
      conversationVars: [],
      systemVars: [],
      nodesWithInspectVars: [],
    }
  })

  it('should render the listening state and stop the workflow on demand', async () => {
    const user = userEvent.setup()
    const { store } = renderPanel({
      isListening: true,
      listeningTriggerType: BlockEnum.TriggerWebhook,
      showVariableInspectPanel: true,
    })

    await user.click(
      screen.getByRole('button', {
        name: 'workflowDebug.debug.variableInspect.listening.stopButton',
      }),
    )

    expect(
      screen.getByText('workflowDebug.debug.variableInspect.listening.title'),
    ).toBeInTheDocument()
    expect(mockEmit).toHaveBeenCalledWith({
      type: EVENT_WORKFLOW_STOP,
    })

    await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
    expect(store.getState().showVariableInspectPanel).toBe(false)
  })

  it('should render the empty state and close the panel from the header action', async () => {
    const user = userEvent.setup()
    const { store } = renderPanel({
      showVariableInspectPanel: true,
    })

    await user.click(screen.getByRole('button', { name: 'common.operation.close' }))

    expect(screen.getByText('workflowDebug.debug.variableInspect.emptyTip')).toBeInTheDocument()
    expect(store.getState().showVariableInspectPanel).toBe(false)
  })

  it('should select an environment variable and show its details in the right panel', async () => {
    const user = userEvent.setup()
    renderPanel({
      environmentVariables: [createEnvironmentVariable()],
      bottomPanelWidth: 560,
    })

    await user.click(screen.getByText('API_KEY'))

    expect(screen.getByText('workflowDebug.debug.variableInspect.envNode')).toBeInTheDocument()
    expect(await screen.findByText('env-value')).toBeVisible()
  })
})
