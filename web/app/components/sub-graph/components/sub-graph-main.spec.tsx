import type { NestedNodeConfig } from '@/app/components/workflow/nodes/_base/types'
import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NULL_STRATEGY } from '@/app/components/workflow/nodes/_base/constants'
import { FlowType } from '@/types/common'
import SubGraphMain from './sub-graph-main'

const mockUseAvailableNodesMetaData = vi.fn()
const mockUseSetWorkflowVarsWithValue = vi.fn()
const mockUseInspectVarsCrudCommon = vi.fn()
const mockSetPendingSingleRun = vi.fn()

vi.mock('@/app/components/workflow', () => ({
  InteractionMode: {
    Subgraph: 'subgraph',
  },
  WorkflowWithInnerContext: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="workflow-with-inner-context">{children}</div>
  ),
}))

vi.mock('reactflow', () => ({
  useStoreApi: () => ({
    getState: () => ({
      getNodes: () => [],
      edges: [],
    }),
  }),
}))

vi.mock('@/app/components/workflow/hooks', () => ({
  useNodesInteractions: () => ({
    handleNodeSelect: vi.fn(),
  }),
}))

vi.mock('@/app/components/workflow/hooks/use-fetch-workflow-inspect-vars', () => ({
  useSetWorkflowVarsWithValue: (params: unknown) => mockUseSetWorkflowVarsWithValue(params),
}))

vi.mock('@/app/components/workflow/hooks/use-inspect-vars-crud-common', () => ({
  useInspectVarsCrudCommon: (params: unknown) => mockUseInspectVarsCrudCommon(params),
}))

vi.mock('@/app/components/workflow/store', () => ({
  useWorkflowStore: () => ({
    getState: () => ({
      setPendingSingleRun: mockSetPendingSingleRun,
    }),
  }),
}))

vi.mock('../hooks', () => ({
  useAvailableNodesMetaData: (flowType: FlowType) => mockUseAvailableNodesMetaData(flowType),
}))

vi.mock('./sub-graph-children', () => ({
  default: () => <div data-testid="sub-graph-children" />,
}))

const nestedNodeConfig: NestedNodeConfig = {
  extractor_node_id: 'extractor-1',
  output_selector: ['extractor-1', 'output'],
  null_strategy: NULL_STRATEGY.RAISE_ERROR,
  default_value: '',
}

describe('SubGraphMain flowType wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseAvailableNodesMetaData.mockReturnValue({
      nodes: [],
      nodesMap: {},
    })
    mockUseSetWorkflowVarsWithValue.mockReturnValue({
      fetchInspectVars: vi.fn(),
    })
    mockUseInspectVarsCrudCommon.mockReturnValue({})
  })

  it('should pass configs map flow type to useAvailableNodesMetaData', () => {
    render(
      <SubGraphMain
        variant="assemble"
        nodes={[]}
        edges={[]}
        viewport={{ x: 0, y: 0, zoom: 1 }}
        title="Subgraph"
        extractorNodeId="extractor-1"
        configsMap={{
          flowId: 'pipeline-1',
          flowType: FlowType.ragPipeline,
        }}
        isOpen={false}
        nestedNodeConfig={nestedNodeConfig}
        onNestedNodeConfigChange={vi.fn()}
      />,
    )

    expect(mockUseAvailableNodesMetaData).toHaveBeenCalledWith(FlowType.ragPipeline)
    expect(mockUseSetWorkflowVarsWithValue).toHaveBeenCalledWith({
      flowType: FlowType.ragPipeline,
      flowId: 'pipeline-1',
      interactionMode: 'subgraph',
    })
  })

  it('should fall back to app flow when configs map is missing', () => {
    render(
      <SubGraphMain
        variant="assemble"
        nodes={[]}
        edges={[]}
        viewport={{ x: 0, y: 0, zoom: 1 }}
        title="Subgraph"
        extractorNodeId="extractor-1"
        isOpen={false}
        nestedNodeConfig={nestedNodeConfig}
        onNestedNodeConfigChange={vi.fn()}
      />,
    )

    expect(mockUseAvailableNodesMetaData).toHaveBeenCalledWith(FlowType.appFlow)
    expect(mockUseSetWorkflowVarsWithValue).toHaveBeenCalledWith({
      flowType: FlowType.appFlow,
      flowId: '',
      interactionMode: 'subgraph',
    })
  })
})
