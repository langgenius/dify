import type { ToolNodeType } from '../types'
import { screen } from '@testing-library/react'
import { CollectionType } from '@/app/components/tools/types'
import { renderWorkflowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
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

function renderTool(data: ToolNodeType, authorized = true) {
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
  return renderWorkflowComponent(<Node id="tool-node-1" data={data} />, { queryClient })
}

describe('ToolNode', () => {
  it('keeps configuration rows visible for a provider that requires authorization', () => {
    renderTool(
      createNodeData({
        tool_configurations: { region: { value: 'us' } },
      }),
      false,
    )

    expect(screen.getByText('region')).toBeInTheDocument()
    expect(screen.getByText('us')).toBeInTheDocument()
    expect(screen.getByText('workflow.nodes.tool.authorizationRequired')).toBeInTheDocument()
  })

  it('renders multi-select configuration values', () => {
    renderTool(
      createNodeData({
        tool_configurations: { formats: { type: 'constant', value: ['png', 'svg'] } },
      }),
    )

    expect(screen.getByText('png, svg')).toBeInTheDocument()
  })
})
