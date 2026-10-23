import type { ToolApiEntity } from '@dify/contracts/api/console/workspaces/types.gen'
import type { ToolNodeType } from '../types'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CollectionType } from '@/app/components/tools/types'
import { VarKindType } from '@/app/components/workflow/nodes/_base/types'
import { BlockEnum } from '@/app/components/workflow/types'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient } from '@/test/console/query-data'
import { createToolProviderFixture } from '@/test/console/tool-provider-fixture'
import { seedToolProviders } from '@/test/console/tool-providers'
import { renderNodePanel } from '../../__tests__/render-node-panel'
import Panel from '../panel'

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

const createTool = (output_schema: ToolApiEntity['output_schema'] = {}): ToolApiEntity => ({
  name: 'google_search',
  author: 'Dify',
  label: { en_US: 'Google Search' },
  description: { en_US: 'Search' },
  parameters: [
    { name: 'count', form: 'llm', type: 'number', label: { en_US: 'count' }, required: false },
    { name: 'limit', form: 'form', type: 'number', label: { en_US: 'limit' }, required: false },
  ],
  output_schema,
})
const renderPanel = ({
  tool = createTool(),
  authorized = true,
  definitions = [] as { name: string; schema: Record<string, unknown> }[],
} = {}) => {
  const queryClient = createConsoleQueryClient()
  seedToolProviders(queryClient, {
    builtInTools: [
      createToolProviderFixture({
        id: 'google_search',
        name: 'google_search',
        allow_delete: true,
        is_team_authorization: authorized,
        tools: [tool],
      }),
    ],
    customTools: [],
    workflowTools: [],
    mcpTools: [],
  })
  queryClient.setQueryData(
    consoleQuery.spec.schemaDefinitions.get.queryKey(),
    definitions.map((definition) => ({ label: definition.name, ...definition })),
  )
  return renderNodePanel(
    Panel,
    createNodeData({
      tool_parameters: { count: { type: VarKindType.constant, value: 2 } },
      tool_configurations: { limit: { type: VarKindType.constant, value: 10 } },
    }),
    { queryClient, resource: { kind: 'knowledge-pipeline', pipelineId: 'pipeline-1' } },
  )
}

describe('ToolPanel', () => {
  it('saves input and settings independently and collapses the real settings form', async () => {
    const user = userEvent.setup()
    const { data } = renderPanel()
    const count = screen.getByRole<HTMLInputElement>('textbox', { name: 'count' })
    await user.click(count)
    count.select()
    await user.paste('3')
    expect(data()).toMatchObject({
      tool_parameters: { count: { type: VarKindType.constant, value: 3 } },
      tool_configurations: { limit: { type: VarKindType.constant, value: 10 } },
    })
    const limit = screen.getByRole<HTMLInputElement>('textbox', { name: 'limit' })
    await user.click(limit)
    limit.select()
    await user.paste('20')
    expect(data()).toMatchObject({
      tool_parameters: { count: { type: VarKindType.constant, value: 3 } },
      tool_configurations: { limit: { type: VarKindType.constant, value: 20 } },
    })
    await user.click(
      screen.getByRole('button', { name: 'workflow.nodes.tool.settings', expanded: true }),
    )
    expect(screen.queryByRole('textbox', { name: 'limit' })).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'count' })).toHaveValue('3')
  })

  it('hides editable forms when authorization is required and keeps output variables visible', async () => {
    const user = userEvent.setup()
    renderPanel({ authorized: false })
    await user.click(screen.getByRole('button', { name: 'workflow.nodes.common.outputVars' }))
    expect(screen.queryByText('workflow.nodes.tool.inputVars')).not.toBeInTheDocument()
    expect(screen.queryByText('workflow.nodes.tool.settings')).not.toBeInTheDocument()
    for (const name of ['text', 'files', 'json']) expect(screen.getByText(name)).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('renders scalar outputs and matches structured outputs to schema definitions', async () => {
    const user = userEvent.setup()
    renderPanel({
      tool: createTool({
        properties: {
          summary: { type: 'string', description: 'Summary field' },
          details: { type: 'object', properties: {} },
        },
      }),
      definitions: [{ name: 'object_structured', schema: { type: 'object', properties: {} } }],
    })
    await user.click(screen.getByRole('button', { name: 'workflow.nodes.common.outputVars' }))
    expect(screen.getByText('summary')).toBeInTheDocument()
    expect(screen.getByText('Summary field')).toBeInTheDocument()
    expect(screen.getByText('details')).toBeInTheDocument()
    expect(screen.getByText('object (object_structured)')).toBeInTheDocument()
  })

  it('renders scalar outputs without a schema suffix when no schema matches', async () => {
    const user = userEvent.setup()
    renderPanel({
      tool: createTool({
        properties: { summary: { type: 'string', description: 'Summary field' } },
      }),
    })
    await user.click(screen.getByRole('button', { name: 'workflow.nodes.common.outputVars' }))
    expect(screen.getByText('summary')).toBeInTheDocument()
    expect(screen.queryByText(/qa_structured/)).not.toBeInTheDocument()
  })
})
