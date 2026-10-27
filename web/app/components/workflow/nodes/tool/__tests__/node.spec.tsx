import type { ToolNodeType } from '../types'
import { screen } from '@testing-library/react'
import { CollectionType } from '@/app/components/tools/types'
import { createNode } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { BlockEnum } from '@/app/components/workflow/types'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createToolProviderFixture } from '@/test/console/tool-provider-fixture'
import { seedToolProviders } from '@/test/console/tool-providers'
import Node from '../node'

const createNodeData = (overrides: Partial<ToolNodeType> = {}): ToolNodeType => ({
  title: 'Google Search',
  desc: '',
  type: BlockEnum.Tool,
  provider_id: 'google_search',
  provider_type: CollectionType.builtIn,
  provider_name: 'Google Search',
  tool_name: 'google_search',
  tool_label: 'Google Search',
  tool_parameters: {},
  tool_configurations: {},
  ...overrides,
})

function renderToolInCanvas(
  data: ToolNodeType,
  nodes: ReturnType<typeof createNode>[],
  authorized = true,
) {
  const { queryClient } = createConsoleQueryWrapper()
  seedToolProviders(queryClient, {
    builtInTools: [
      createToolProviderFixture({
        id: 'google_search',
        name: 'google_search',
        allow_delete: true,
        is_team_authorization: authorized,
      }),
    ],
    customTools: [],
    workflowTools: [],
    mcpTools: [],
  })
  return renderWorkflowFlowComponent(<Node id="tool-node-1" data={data} />, {
    queryClient,
    nodes,
    edges: [],
  })
}

describe('ToolNode', () => {
  it('keeps configuration rows visible for a provider that requires authorization', () => {
    renderToolInCanvas(
      createNodeData({
        tool_configurations: { region: { value: 'us' } },
      }),
      [],
      false,
    )

    expect(screen.getByText('region')).toBeInTheDocument()
    expect(screen.getByText('us')).toBeInTheDocument()
    expect(screen.getByText('workflow.nodes.tool.authorizationRequired')).toBeInTheDocument()
  })

  it('renders multi-select configuration values', () => {
    renderToolInCanvas(
      createNodeData({
        tool_configurations: { formats: { type: 'constant', value: ['png', 'svg'] } },
      }),
      [],
    )

    expect(screen.getByText('png, svg')).toBeInTheDocument()
  })

  it('renders a file param bound to an upstream variable with the source node label', () => {
    renderToolInCanvas(
      createNodeData({
        tool_configurations: {
          input_file: { type: 'variable', value: ['source-node', 'files'] },
        },
        paramSchemas: [{ name: 'input_file', type: 'file', form: 'form' }],
      }),
      [createNode({ id: 'source-node', data: { type: BlockEnum.Start, title: 'Input Files' } })],
    )

    expect(screen.getByText('Input Files')).toBeInTheDocument()
    expect(screen.queryByText('source-node, files')).not.toBeInTheDocument()
  })

  it('shows the picked model name for a model-selector param stored as a constant object', () => {
    renderToolInCanvas(
      createNodeData({
        tool_configurations: {
          model: {
            type: 'constant',
            value: {
              provider: 'zen',
              model: 'gemma4-31b',
              model_type: 'llm',
              mode: 'chat',
              completion_params: {},
            },
          },
        },
        paramSchemas: [{ name: 'model', type: 'model-selector', form: 'form' }],
      }),
      [],
    )

    expect(screen.getByText('gemma4-31b')).toBeInTheDocument()
  })
})
