import type { ComponentType } from 'react'
import type { ReactFlowInstance } from 'reactflow'
import type { CommonNodeType, NodePanelProps } from '../../types'
import { useNodes, useReactFlow } from 'reactflow'
import { consoleQuery } from '@/service/console'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { seedToolProviders } from '@/test/console/tool-providers'
import { createNode } from '../../__tests__/fixtures'
import { renderWorkflowFlowComponent } from '../../__tests__/workflow-test-env'

type Options = NonNullable<Parameters<typeof renderWorkflowFlowComponent>[1]> & { nodeId?: string }

// Like the production panel, subscribe to node data so successive edits use the saved graph.
export function renderNodePanel<T extends CommonNodeType>(
  Panel: ComponentType<NodePanelProps<T>>,
  data: T,
  { nodeId = 'node', nodes, queryClient: suppliedClient, ...options }: Options = {},
) {
  const queryClient = createConsoleQueryWrapper({ queryClient: suppliedClient }).queryClient
  if (!suppliedClient) {
    seedToolProviders(queryClient, {
      builtInTools: [],
      customTools: [],
      workflowTools: [],
      mcpTools: [],
    })
    queryClient.setQueryData(consoleQuery.spec.schemaDefinitions.get.queryKey(), [])
  }
  seedModelProviderQueries(queryClient)
  let flow: ReactFlowInstance<T>
  function LivePanel() {
    flow = useReactFlow<T>()
    const node = useNodes<T>().find((node) => node.id === nodeId)
    return node ? (
      <Panel
        id={nodeId}
        data={node.data}
        panelProps={{
          getInputVars: () => [],
          toVarInputs: () => [],
          runInputData: {},
          runInputDataRef: { current: {} },
          setRunInputData: vi.fn(),
          runResult: null,
        }}
      />
    ) : null
  }
  const rendered = renderWorkflowFlowComponent(<LivePanel />, {
    resource: { kind: 'snippet', snippetId: 'snippet-1' },
    ...options,
    queryClient,
    nodes: nodes ?? [createNode({ id: nodeId, data })],
  })
  return {
    ...rendered,
    data: () => flow.getNode(nodeId)!.data,
    getNode: (id: string) => flow.getNode(id),
  }
}
