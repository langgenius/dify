import type { SubGraphProps } from '../types'
import type { Shape as HooksStoreShape } from '@/app/components/workflow/hooks-store'
import type { NestedNodeConfig } from '@/app/components/workflow/nodes/_base/types'
import type { LLMNodeType } from '@/app/components/workflow/nodes/llm/types'
import type { Node, NodeOutPutVar, ValueSelector } from '@/app/components/workflow/types'
import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NULL_STRATEGY } from '@/app/components/workflow/nodes/_base/constants'
import { FlowType } from '@/types/common'
import SubGraph from '../index'

const mockSetParentAvailableVars = vi.fn()
const mockSetParentAvailableNodes = vi.fn()
const mockUseSubGraphNodes = vi.fn()
const mockSubGraphMain = vi.fn()

vi.mock('@/app/components/workflow', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="workflow-default-context">{children}</div>,
}))

vi.mock('@/app/components/workflow/context', () => ({
  WorkflowContextProvider: ({
    children,
    injectWorkflowStoreSliceFn,
  }: {
    children: React.ReactNode
    injectWorkflowStoreSliceFn: unknown
  }) => (
    <div data-testid="workflow-context-provider" data-has-slice={String(Boolean(injectWorkflowStoreSliceFn))}>
      {children}
    </div>
  ),
}))

vi.mock('@/app/components/workflow/store', () => ({
  useStore: (selector: (state: {
    setParentAvailableVars: typeof mockSetParentAvailableVars
    setParentAvailableNodes: typeof mockSetParentAvailableNodes
  }) => unknown) => selector({
    setParentAvailableVars: mockSetParentAvailableVars,
    setParentAvailableNodes: mockSetParentAvailableNodes,
  }),
}))

vi.mock('../hooks', () => ({
  useSubGraphNodes: (...args: unknown[]) => mockUseSubGraphNodes(...args),
}))

vi.mock('../components/sub-graph-main', () => ({
  default: (props: unknown) => {
    mockSubGraphMain(props)
    return <div data-testid="sub-graph-main" />
  },
}))

const nestedNodeConfig: NestedNodeConfig = {
  extractor_node_id: 'extractor-1',
  output_selector: ['extractor-1', 'output'],
  null_strategy: NULL_STRATEGY.RAISE_ERROR,
  default_value: '',
}

const parentAvailableNodes = [{ id: 'node-1' }] as Node[]
const parentAvailableVars: NodeOutPutVar[] = [{ nodeId: 'node-1', title: 'Node 1', vars: [] }]
const configsMap: HooksStoreShape['configsMap'] = {
  flowId: 'flow-1',
  flowType: FlowType.appFlow,
}
const sourceVariable = ['agent-1', 'context'] as ValueSelector
const extractorNode = {
  id: 'extractor-1',
  data: { prompt_template: { role: 'user', text: 'ignored' } },
} as Node<LLMNodeType>

const assembleProps: SubGraphProps = {
  variant: 'assemble',
  title: 'Assembler',
  isOpen: true,
  toolNodeId: 'tool-node',
  paramKey: 'question',
  parentAvailableNodes,
  parentAvailableVars,
  configsMap,
  nestedNodeConfig,
  onNestedNodeConfigChange: vi.fn(),
}

describe('SubGraph', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseSubGraphNodes.mockReturnValue({
      nodes: [{ id: 'render-node' }],
      edges: [{ id: 'render-edge' }],
    })
  })

  it('should inject the sub-graph slice and sync parent availability data', () => {
    render(<SubGraph {...assembleProps} />)

    expect(mockSetParentAvailableVars).toHaveBeenCalledWith(assembleProps.parentAvailableVars)
    expect(mockSetParentAvailableNodes).toHaveBeenCalledWith(assembleProps.parentAvailableNodes)
  })

  it('should render the assemble variant with the derived extractor node id', () => {
    render(<SubGraph {...assembleProps} />)

    expect(mockSubGraphMain).toHaveBeenCalledWith(expect.objectContaining({
      variant: 'assemble',
      title: 'Assembler',
      extractorNodeId: 'tool-node_ext_question',
      nodes: [{ id: 'render-node' }],
      edges: [{ id: 'render-edge' }],
    }))
  })

  it('should render the agent variant with forwarded nested node config props', () => {
    const onNestedNodeConfigChange = vi.fn()

    render(
      <SubGraph
        variant="agent"
        isOpen={true}
        toolNodeId="agent-tool"
        paramKey="context"
        toolParamValue="{{#agent-1.context#}}user prompt"
        agentNodeId="agent-1"
        agentName="Agent Runner"
        sourceVariable={sourceVariable}
        nestedNodeConfig={nestedNodeConfig}
        onNestedNodeConfigChange={onNestedNodeConfigChange}
        extractorNode={extractorNode}
      />,
    )

    expect(mockSubGraphMain).toHaveBeenCalledWith(expect.objectContaining({
      variant: 'agent',
      title: 'Agent Runner',
      extractorNodeId: 'agent-tool_ext_context',
      nestedNodeConfig,
      onNestedNodeConfigChange,
    }))
  })
})
