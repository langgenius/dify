import { render, screen } from '@testing-library/react'
import { NULL_STRATEGY } from '@/app/components/workflow/nodes/_base/constants'
import { FlowType } from '@/types/common'
import SubGraphCanvas from '../sub-graph-canvas'

const mockSubGraph = vi.fn()

vi.mock('@/app/components/sub-graph', () => ({
  default: (props: Record<string, unknown>) => {
    mockSubGraph(props)
    return <div data-testid="sub-graph" />
  },
}))

describe('SubGraphCanvas', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should wrap SubGraph and forward every prop', () => {
    render(
      <SubGraphCanvas
        variant="assemble"
        isOpen
        toolNodeId="tool-node"
        paramKey="query"
        pendingSingleRun={false}
        onPendingSingleRunHandled={vi.fn()}
        title="Assemble variables"
        configsMap={{ flowId: 'flow-1', flowType: FlowType.appFlow }}
        nestedNodeConfig={{
          extractor_node_id: 'tool-node_ext_query',
          output_selector: ['result'],
          null_strategy: NULL_STRATEGY.RAISE_ERROR,
          default_value: '',
        }}
        onNestedNodeConfigChange={vi.fn()}
        extractorNode={undefined}
        toolParamValue="{{#tool-node_ext_query.result#}}"
        parentAvailableNodes={[]}
        parentAvailableVars={[]}
        onSave={vi.fn()}
        onSyncWorkflowDraft={vi.fn()}
      />,
    )

    expect(screen.getByTestId('sub-graph')).toBeInTheDocument()
    expect(mockSubGraph).toHaveBeenCalledWith(expect.objectContaining({
      variant: 'assemble',
      toolNodeId: 'tool-node',
      paramKey: 'query',
    }))
  })
})
