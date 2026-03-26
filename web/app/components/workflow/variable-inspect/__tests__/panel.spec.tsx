import type { EnvironmentVariable } from '../../types'
import type { NodeWithVar, VarInInspect } from '@/types/workflow'
import { fireEvent, screen, waitFor } from '@testing-library/react'
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
  mockDownloadUrlOptions,
  mockTreeOptions,
  mockUseQuery,
  mockResetConversationVar,
  mockResetToLastRunVar,
  mockSetInputs,
  flatData,
  isLoading,
} = vi.hoisted(() => ({
  mockEditInspectVarValue: vi.fn(),
  mockEmit: vi.fn(),
  mockFetchInspectVarValue: vi.fn(),
  mockHandleNodeSelect: vi.fn(),
  mockDownloadUrlOptions: vi.fn().mockReturnValue({
    queryKey: ['sandboxFile', 'downloadFile'],
    queryFn: vi.fn(),
  }),
  mockTreeOptions: vi.fn().mockReturnValue({
    queryKey: ['sandboxFile', 'listFiles'],
    queryFn: vi.fn(),
  }),
  mockUseQuery: vi.fn(),
  mockResetConversationVar: vi.fn(),
  mockResetToLastRunVar: vi.fn(),
  mockSetInputs: vi.fn(),
  flatData: [] as unknown[],
  isLoading: false,
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

vi.mock('../../hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../hooks')>()
  return {
    ...actual,
    useNodesInteractions: () => ({
      handleNodeSelect: mockHandleNodeSelect,
    }),
    useToolIcon: () => '',
  }
})

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

vi.mock('../../hooks-store', () => ({
  useHooksStore: <T,>(selector: (state: { configsMap?: { flowId: string } }) => T) =>
    selector({
      configsMap: {
        flowId: 'flow-1',
      },
    }),
}))

vi.mock('@tanstack/react-query', async importOriginal => ({
  ...await importOriginal<typeof import('@tanstack/react-query')>(),
  useQuery: (options: { queryKey?: unknown }) => mockUseQuery(options),
}))

vi.mock('@/service/use-sandbox-file', async importOriginal => ({
  ...(await importOriginal<typeof import('@/service/use-sandbox-file')>()),
  sandboxFileDownloadUrlOptions: (...args: unknown[]) => mockDownloadUrlOptions(...args),
  sandboxFilesTreeOptions: (...args: unknown[]) => mockTreeOptions(...args),
  useDownloadSandboxFile: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}))

vi.mock('@/context/event-emitter', () => ({
  useEventEmitterContextContext: () => ({
    eventEmitter: {
      emit: mockEmit,
    },
  }),
}))

vi.mock('@/app/components/base/features/hooks', async importOriginal => ({
  ...(await importOriginal<typeof import('@/app/components/base/features/hooks')>()),
  useFeatures: (selector: (state: { features: { sandbox: { enabled: boolean } } }) => unknown) => selector({
    features: {
      sandbox: {
        enabled: true,
      },
    },
  }),
}))

const createEnvironmentVariable = (overrides: Partial<EnvironmentVariable> = {}): EnvironmentVariable => ({
  id: 'env-1',
  name: 'API_KEY',
  value: 'env-value',
  value_type: 'string',
  description: '',
  ...overrides,
})

const renderPanel = (initialStoreState: Record<string, unknown> = {}) => {
  return renderWorkflowFlowComponent(
    <Panel />,
    {
      nodes: [],
      edges: [],
      initialStoreState,
      historyStore: {
        nodes: [],
        edges: [],
      },
    },
  )
}

describe('VariableInspect Panel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseQuery.mockImplementation((options: { queryKey?: unknown }) => {
      const treeKey = mockTreeOptions.mock.results.at(-1)?.value?.queryKey
      if (treeKey && options.queryKey === treeKey) {
        return {
          data: flatData,
          isLoading,
        }
      }

      return {
        data: undefined,
        isLoading: false,
      }
    })
    inspectVarsState = {
      conversationVars: [],
      systemVars: [],
      nodesWithInspectVars: [],
    }
  })

  it('should render the listening state and stop the workflow on demand', () => {
    renderPanel({
      isListening: true,
      listeningTriggerType: BlockEnum.TriggerWebhook,
    })

    fireEvent.click(screen.getByRole('button', { name: 'workflow.debug.variableInspect.listening.stopButton' }))

    expect(screen.getByText('workflow.debug.variableInspect.listening.title')).toBeInTheDocument()
    expect(mockEmit).toHaveBeenCalledWith({
      type: EVENT_WORKFLOW_STOP,
    })
  })

  it('should render the empty state and close the panel from the header action', () => {
    const { store } = renderPanel({
      showVariableInspectPanel: true,
    })

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    expect(screen.getByText('workflow.debug.variableInspect.emptyTip')).toBeInTheDocument()
    expect(store.getState().showVariableInspectPanel).toBe(false)
  })

  it('should select an environment variable and show its details in the right panel', async () => {
    renderPanel({
      environmentVariables: [createEnvironmentVariable()],
      bottomPanelWidth: 560,
    })

    fireEvent.click(screen.getByText('API_KEY'))

    await waitFor(() => expect(screen.getAllByText('API_KEY').length).toBeGreaterThan(1))

    expect(screen.getByText('workflow.debug.variableInspect.envNode')).toBeInTheDocument()
    expect(screen.getAllByText('string').length).toBeGreaterThan(0)
    expect(screen.getByText('env-value')).toBeInTheDocument()
  })
})
