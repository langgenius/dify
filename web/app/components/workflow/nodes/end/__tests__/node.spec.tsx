import type { EndNodeType } from '../types'
import { screen } from '@testing-library/react'
import { useEdges, useNodes } from 'reactflow'
import {
  createEdge,
  createNode,
  createStartNode,
} from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import Node from '../node'

function EndNodePreview({ data }: { data: EndNodeType }) {
  const nodes = useNodes()
  const edges = useEdges()
  return nodes.length === 3 && edges.length === 2 ? <Node id="end" data={data} /> : null
}

it.each([
  { source: 'source-node', title: 'Source Node' },
  { source: 'missing-node', title: 'Start' },
])('resolves output labels from the graph with $source', async ({ source, title }) => {
  const data: EndNodeType = {
    title: 'End',
    desc: '',
    type: BlockEnum.End,
    outputs: [
      { variable: 'answer', value_selector: [source, 'answer'] },
      { variable: 'unconfigured', value_selector: [] },
    ],
  }
  const { queryClient } = createConsoleQueryWrapper()
  queryClient.setQueryData(consoleQuery.spec.schemaDefinitions.get.queryKey(), [])
  renderWorkflowFlowComponent(<EndNodePreview data={data} />, {
    queryClient,
    nodes: [
      createStartNode({
        id: 'start',
        data: { type: BlockEnum.Start, title: 'Start', desc: '', variables: [] },
      }),
      createNode({
        id: 'source-node',
        data: {
          title: 'Source Node',
          type: BlockEnum.Code,
          outputs: { answer: { type: VarType.string } },
        },
      }),
      createNode({ id: 'end', data }),
    ],
    edges: [
      createEdge({ source: 'start', target: 'source-node' }),
      createEdge({ source: 'source-node', target: 'end' }),
    ],
  })
  expect(await screen.findByText(title)).toBeInTheDocument()
  expect(screen.getByText('answer')).toBeInTheDocument()
  if (source === 'source-node') expect(screen.getByText('String')).toBeInTheDocument()
  expect(screen.queryByText('unconfigured')).not.toBeInTheDocument()
})

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'spec.schemaDefinitions.get': async () => [],
      'workspaces.current.tools.builtin.get': async () => [],
      'workspaces.current.tools.api.get': async () => [],
      'workspaces.current.tools.workflow.get': async () => [],
      'workspaces.current.tools.mcp.get': async () => [],
    }),
  }
})
