import type { DecisionNodeType } from '../types'
import { render, screen } from '@testing-library/react'
import { createNode } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { BlockEnum } from '@/app/components/workflow/types'
import { initialNodes } from '@/app/components/workflow/utils/workflow-init'
import WorkflowPreview from '@/app/components/workflow/workflow-preview'
import { consoleQuery } from '@/service/console'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import { createConsoleQueryWrapper, seedAppDslVersion } from '@/test/console/query-data'
import { seedToolProviders } from '@/test/console/tool-providers'
import Node from '../node'

// The backend accepts a Decision node that omits every field with a default
// (`otherwise`, `inputs`, `context`, `extras`, ...) and stores the graph as
// written, so the canvas can load node data in this shape.
const trimmedNode = () =>
  createNode({
    id: 'decision',
    type: 'custom',
    position: { x: 100, y: 100 },
    data: {
      type: BlockEnum.Decision,
      title: 'Route refunds',
      desc: '',
      decide_by: 'rules',
      outcomes: [
        { id: 'refund', label: 'Refund', when: { logical_operator: 'and', conditions: [] } },
      ],
    },
  })

describe('decision node loaded from a trimmed DSL', () => {
  it('renders on the canvas with the default fallback exit', () => {
    const [loaded] = initialNodes([trimmedNode()], [])
    // The exit handles open the block selector, which reads these catalogs.
    const { queryClient } = createConsoleQueryWrapper()
    seedAppDslVersion(queryClient)
    seedModelProviderQueries(queryClient)
    seedToolProviders(queryClient, {
      builtInTools: [],
      customTools: [],
      workflowTools: [],
      mcpTools: [],
    })
    queryClient.setQueryData(consoleQuery.spec.schemaDefinitions.get.queryKey(), [])
    queryClient.setQueryData(consoleQuery.workspaces.current.agentProviders.get.queryKey(), [])
    queryClient.setQueryData(
      consoleQuery.workspaces.current.triggers.get.queryKey({ input: {} }),
      [],
    )

    renderWorkflowFlowComponent(
      <Node
        id={loaded!.id}
        data={loaded!.data as DecisionNodeType}
        type="custom"
        selected={false}
        zIndex={0}
        isConnectable
        xPos={0}
        yPos={0}
        dragging={false}
      />,
      { queryClient, nodes: [loaded!] },
    )

    expect(screen.getByText('Refund')).toBeInTheDocument()
    expect(screen.getByText('workflow.nodes.decision.otherwiseDefault')).toBeInTheDocument()
  })

  it('renders in the read-only workflow preview', async () => {
    render(
      <div style={{ width: 800, height: 600 }}>
        <WorkflowPreview nodes={[trimmedNode()]} edges={[]} viewport={{ x: 0, y: 0, zoom: 1 }} />
      </div>,
    )

    expect(await screen.findByText('Route refunds')).toBeInTheDocument()
    expect(screen.getByText('workflow.nodes.decision.otherwiseDefault')).toBeInTheDocument()
  })
})
