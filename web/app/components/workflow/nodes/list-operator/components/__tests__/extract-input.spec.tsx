import type { ComponentProps } from 'react'
import type PromptEditor from '@/app/components/base/prompt-editor'
import { screen } from '@testing-library/react'
import { useEdges, useNodes } from 'reactflow'
import { createEdge, createNode } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import ExtractInput from '../extract-input'

// The prompt editor has its own insertion tests; this boundary exposes the candidates supplied by extraction.
vi.mock('@/app/components/base/prompt-editor', () => ({
  default: ({ workflowVariableBlock }: ComponentProps<typeof PromptEditor>) => (
    <output aria-label="Extraction candidates">
      {workflowVariableBlock?.variables
        ?.flatMap((node) => node.vars.map((variable) => variable.variable))
        .join(',')}
    </output>
  ),
}))

function ExtractPanel() {
  const nodes = useNodes()
  const edges = useEdges()
  return nodes.length === 2 && edges.length === 1 ? (
    <ExtractInput nodeId="extract" value="5" readOnly={false} onChange={vi.fn()} />
  ) : null
}

it('offers numeric outputs from upstream nodes as extraction indices', async () => {
  renderWorkflowFlowComponent(<ExtractPanel />, {
    nodes: [
      createNode({
        id: 'source',
        data: {
          type: BlockEnum.Code,
          outputs: {
            count: { type: VarType.number },
            name: { type: VarType.string },
          },
        },
      }),
      createNode({ id: 'extract', data: { type: BlockEnum.ListFilter } }),
    ],
    edges: [createEdge({ source: 'source', target: 'extract' })],
  })
  expect(await screen.findByText('count')).toBeInTheDocument()
  expect(screen.getByLabelText('Extraction candidates')).not.toHaveTextContent('name')
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
