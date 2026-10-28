import type { Collection } from '../../types'
import {
  zApiProviderDetailResponse,
  zToolApiEntity,
  zWorkflowToolDetailResponse,
} from '@dify/contracts/api/console/workspaces/zod.gen'
import { act, cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { createToolProviderFixture } from '@/test/console/tool-provider-fixture'
import { createDeferred } from '@/test/deferred'
import { selectToolProvider } from '../../utils/query-select'
import ProviderDetail from '../detail'

const api = vi.hoisted(() => ({
  builtinTools:
    vi.fn<
      typeof import('@/service/console').consoleClient.workspaces.current.toolProvider.builtin.byProvider.tools.get
    >(),
  customTools:
    vi.fn<
      typeof import('@/service/console').consoleClient.workspaces.current.toolProvider.api.tools.get
    >(),
  customDetail:
    vi.fn<
      typeof import('@/service/console').consoleClient.workspaces.current.toolProvider.api.get.get
    >(),
  customUpdate:
    vi.fn<
      typeof import('@/service/console').consoleClient.workspaces.current.toolProvider.api.update.post
    >(),
  customRemove:
    vi.fn<
      typeof import('@/service/console').consoleClient.workspaces.current.toolProvider.api.delete.post
    >(),
  workflowDetail:
    vi.fn<
      typeof import('@/service/console').consoleClient.workspaces.current.toolProvider.workflow.get.get
    >(),
  workflowUpdate:
    vi.fn<
      typeof import('@/service/console').consoleClient.workspaces.current.toolProvider.workflow.update.post
    >(),
  workflowRemove:
    vi.fn<
      typeof import('@/service/console').consoleClient.workspaces.current.toolProvider.workflow.delete.post
    >(),
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'workspaces.current.toolProvider.builtin.byProvider.tools.get': api.builtinTools,
      'workspaces.current.toolProvider.api.tools.get': api.customTools,
      'workspaces.current.toolProvider.api.get.get': api.customDetail,
      'workspaces.current.toolProvider.api.update.post': api.customUpdate,
      'workspaces.current.toolProvider.api.delete.post': api.customRemove,
      'workspaces.current.toolProvider.workflow.get.get': api.workflowDetail,
      'workspaces.current.toolProvider.workflow.update.post': api.workflowUpdate,
      'workspaces.current.toolProvider.workflow.delete.post': api.workflowRemove,
    }),
  }
})

const tool = zToolApiEntity.parse({
  name: 'search',
  author: 'Team',
  label: { en_US: 'Search' },
  description: { en_US: 'Search documents' },
  parameters: [
    {
      name: 'query',
      type: 'string',
      form: 'llm',
      required: true,
      label: { en_US: 'Query' },
      llm_description: 'Search query',
    },
  ],
})
const schema = JSON.stringify({
  openapi: '3.0.0',
  info: { title: 'Search', version: '1.0.0' },
  servers: [{ url: 'https://search.example.com' }],
  paths: {},
})
const customDetail = zApiProviderDetailResponse.parse({
  credentials: { auth_type: 'none' },
  icon: { content: '🔧', background: '#fff' },
  schema,
  schema_type: 'openapi',
  tools: [],
})
const workflowDetail = zWorkflowToolDetailResponse.parse({
  workflow_app_id: 'workflow-app',
  workflow_tool_id: 'workflow-id',
  name: 'search_workflow',
  label: 'Workflow Tool',
  description: 'Run search workflow',
  icon: { content: '🔧', background: '#fff' },
  synced: true,
  parameters: [{ name: 'query', description: 'Search query', form: 'llm' }],
  tool,
})
const builtin = selectToolProvider(
  createToolProviderFixture({
    id: 'time',
    name: 'time',
    label: { en_US: 'Time' },
    is_team_authorization: true,
    allow_delete: false,
  }),
)
const custom = selectToolProvider(
  createToolProviderFixture({
    id: 'api-id',
    name: 'Search API',
    type: 'api',
    label: { en_US: 'Search API' },
    author: 'Custom Author',
    labels: ['search'],
  }),
)
const workflow = selectToolProvider(
  createToolProviderFixture({
    id: 'workflow-id',
    name: 'search_workflow',
    type: 'workflow',
    label: { en_US: 'Workflow Tool' },
    author: 'Workflow Author',
  }),
)

const renderDetail = (collection: Collection, permissions = ['tool.manage']) => {
  const queryClient = createConsoleQueryClient()
  seedModelProviderQueries(queryClient)
  const onRefreshData = vi.fn()
  renderWithConsoleQuery(
    <ProviderDetail collection={collection} onHide={vi.fn()} onRefreshData={onRefreshData} />,
    {
      queryClient,
      workspacePermissionKeys: permissions,
    },
  )
  return { onRefreshData }
}

beforeEach(() => {
  api.builtinTools.mockReset().mockResolvedValue([tool])
  api.customTools.mockReset().mockResolvedValue([tool])
  api.customDetail.mockReset().mockResolvedValue(customDetail)
  api.customUpdate.mockReset().mockResolvedValue({ result: 'success' })
  api.customRemove.mockReset().mockResolvedValue({ result: 'success' })
  api.workflowDetail.mockReset().mockResolvedValue(workflowDetail)
  api.workflowUpdate.mockReset().mockResolvedValue({ result: 'success' })
  api.workflowRemove.mockReset().mockResolvedValue({ result: 'success' })
})
afterEach(async () => {
  await act(async () => cleanup())
})

it('shows builtin actions when their request completes without offering unnecessary authorization', async () => {
  const response = createDeferred<Awaited<ReturnType<typeof api.builtinTools>>>()
  api.builtinTools.mockReturnValue(response.promise)
  renderDetail(builtin)
  expect(screen.queryByRole('button', { name: 'Search' })).not.toBeInTheDocument()
  await act(async () => response.resolve([tool]))
  expect(await screen.findByRole('button', { name: 'Search' })).toHaveTextContent(
    'Search documents',
  )
  expect(api.builtinTools).toHaveBeenCalledWith({ params: { provider: 'time' } })
  expect(
    screen.queryByRole('button', { name: /tools.auth.(authorized|unauthorized)/ }),
  ).not.toBeInTheDocument()
})

it('lets a read-only user inspect custom tools without fetching editable credentials', async () => {
  renderDetail(custom, [])
  expect(await screen.findByRole('button', { name: 'Search' })).toBeInTheDocument()
  expect(screen.getByText('tools.author Custom Author')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'tools.createTool.editAction' })).toBeDisabled()
  expect(api.customTools).toHaveBeenCalledWith({ query: { provider: 'Search API' } })
  expect(api.customDetail).not.toHaveBeenCalled()
})

it('lets a read-only user inspect workflow inputs and open the owning app in Studio', async () => {
  renderDetail(workflow, [])
  expect(await screen.findByRole('link', { name: 'tools.openInStudio' })).toHaveAttribute(
    'href',
    '/app/workflow-app/workflow',
  )
  expect(screen.getByText('tools.author Workflow Author')).toBeInTheDocument()
  expect(screen.getByText('query')).toBeInTheDocument()
  expect(screen.getByText('Search query')).toBeInTheDocument()
  expect(screen.getByText('tools.createTool.toolInput.required')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'tools.createTool.editAction' })).toBeDisabled()
})

it('persists custom tool labels when the refreshed parent still has the old labels', async () => {
  const user = userEvent.setup()
  const { onRefreshData } = renderDetail(custom)
  await user.click(await screen.findByRole('button', { name: 'tools.createTool.editAction' }))
  const editor = await screen.findByRole('dialog', { name: 'tools.createTool.editTitle' })
  await user.click(within(editor).getByRole('button', { name: 'pluginTags.tags.search' }))
  await user.click(await screen.findByRole('checkbox', { name: 'pluginTags.tags.search' }))
  await user.click(screen.getByRole('checkbox', { name: 'pluginTags.tags.productivity' }))
  await user.keyboard('{Escape}')
  await user.click(within(editor).getByRole('button', { name: 'common.operation.save' }))
  await waitFor(() =>
    expect(api.customUpdate).toHaveBeenCalledWith({
      body: expect.objectContaining({
        provider: 'Search API',
        original_provider: 'Search API',
        labels: ['productivity'],
        schema,
        schema_type: 'openapi',
        credentials: { auth_type: 'none' },
      }),
    }),
  )
  await waitFor(() =>
    expect(
      screen.queryByRole('dialog', { name: 'tools.createTool.editTitle' }),
    ).not.toBeInTheDocument(),
  )
  expect(onRefreshData).toHaveBeenCalledOnce()
  await user.click(await screen.findByRole('button', { name: 'tools.createTool.editAction' }))
  const reopened = await screen.findByRole('dialog', { name: 'tools.createTool.editTitle' })
  expect(
    within(reopened).getByRole('button', { name: 'pluginTags.tags.productivity' }),
  ).toBeInTheDocument()
})

it.each([
  { collection: custom, title: 'tools.createTool.editTitle', name: 'Search API' },
  { collection: workflow, title: 'navigation.common.workflowAsTool', name: 'Workflow Tool' },
])('discards an unfinished edit of $name when cancelled', async ({ collection, title, name }) => {
  const user = userEvent.setup()
  renderDetail(collection)
  await user.click(await screen.findByRole('button', { name: 'tools.createTool.editAction' }))
  let editor = await screen.findByRole('dialog', { name: title })
  await user.clear(within(editor).getByRole('textbox', { name: /^tools.createTool.name\b/ }))
  await user.type(
    within(editor).getByRole('textbox', { name: /^tools.createTool.name\b/ }),
    'Unsaved',
  )
  await user.click(within(editor).getByRole('button', { name: 'common.operation.cancel' }))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: title })).not.toBeInTheDocument())
  await user.click(screen.getByRole('button', { name: 'tools.createTool.editAction' }))
  editor = await screen.findByRole('dialog', { name: title })
  expect(within(editor).getByRole('textbox', { name: /^tools.createTool.name\b/ })).toHaveValue(
    name,
  )
  expect(api.customUpdate).not.toHaveBeenCalled()
  expect(api.workflowUpdate).not.toHaveBeenCalled()
})

it('updates a workflow tool only after confirmation and reloads the saved configuration', async () => {
  const user = userEvent.setup()
  const { onRefreshData } = renderDetail(workflow)
  await user.click(await screen.findByRole('button', { name: 'tools.createTool.editAction' }))
  const editor = await screen.findByRole('dialog', { name: 'navigation.common.workflowAsTool' })
  expect(
    within(within(editor).getByRole('row', { name: /query/ })).getByRole('textbox'),
  ).toHaveValue('Search query')
  await user.clear(within(editor).getByRole('textbox', { name: /^tools.createTool.name\b/ }))
  await user.type(
    within(editor).getByRole('textbox', { name: /^tools.createTool.name\b/ }),
    'Renamed Workflow',
  )
  await user.click(within(editor).getByRole('button', { name: 'common.operation.save' }))
  const confirm = await screen.findByRole('dialog', { name: 'tools.createTool.confirmTitle' })
  expect(api.workflowUpdate).not.toHaveBeenCalled()
  api.workflowDetail.mockResolvedValue({ ...workflowDetail, label: 'Renamed Workflow' })
  await user.click(within(confirm).getByRole('button', { name: 'common.operation.confirm' }))
  await waitFor(() =>
    expect(api.workflowUpdate).toHaveBeenCalledWith({
      body: expect.objectContaining({
        workflow_tool_id: 'workflow-id',
        name: 'search_workflow',
        label: 'Renamed Workflow',
        parameters: [{ name: 'query', description: 'Search query', form: 'llm' }],
      }),
    }),
  )
  await waitFor(() =>
    expect(
      screen.queryByRole('dialog', { name: 'navigation.common.workflowAsTool' }),
    ).not.toBeInTheDocument(),
  )
  expect(onRefreshData).toHaveBeenCalledOnce()
  await user.click(await screen.findByRole('button', { name: 'tools.createTool.editAction' }))
  const reopened = await screen.findByRole('dialog', { name: 'navigation.common.workflowAsTool' })
  expect(within(reopened).getByRole('textbox', { name: /^tools.createTool.name\b/ })).toHaveValue(
    'Renamed Workflow',
  )
})

it.each([
  { collection: custom, title: 'tools.createTool.editTitle', kind: 'custom' },
  { collection: workflow, title: 'navigation.common.workflowAsTool', kind: 'workflow' },
])(
  'confirms deletion of a $kind tool and refreshes its owner',
  async ({ collection, title, kind }) => {
    const user = userEvent.setup()
    const { onRefreshData } = renderDetail(collection)
    await user.click(await screen.findByRole('button', { name: 'tools.createTool.editAction' }))
    const editor = await screen.findByRole('dialog', { name: title })
    await user.click(within(editor).getByRole('button', { name: 'common.operation.delete' }))
    let confirm = await screen.findByRole('alertdialog', {
      name: 'tools.createTool.deleteToolConfirmTitle',
    })
    await user.click(within(confirm).getByRole('button', { name: 'common.operation.cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(api.customRemove).not.toHaveBeenCalled()
    expect(api.workflowRemove).not.toHaveBeenCalled()
    await user.click(within(editor).getByRole('button', { name: 'common.operation.delete' }))
    confirm = await screen.findByRole('alertdialog', {
      name: 'tools.createTool.deleteToolConfirmTitle',
    })
    await user.click(within(confirm).getByRole('button', { name: 'common.operation.confirm' }))
    await waitFor(() => expect(onRefreshData).toHaveBeenCalledOnce())
    if (kind === 'custom')
      expect(api.customRemove).toHaveBeenCalledWith({ body: { provider: 'Search API' } })
    else
      expect(api.workflowRemove).toHaveBeenCalledWith({ body: { workflow_tool_id: 'workflow-id' } })
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: title })).not.toBeInTheDocument(),
    )
  },
)

it('opens an action with read-only parameter details and returns to its provider', async () => {
  const user = userEvent.setup()
  api.builtinTools.mockResolvedValue([
    zToolApiEntity.parse({
      ...tool,
      parameters: [
        ...tool.parameters!,
        {
          name: 'limit',
          label: { en_US: 'Limit' },
          type: 'number',
          form: 'form',
          human_description: { en_US: 'Maximum result count' },
          required: true,
        },
      ],
    }),
  ])
  renderDetail(builtin)
  await user.click(await screen.findByRole('button', { name: 'Search' }))
  const action = await screen.findByRole('dialog', { name: 'Search' })
  expect(within(action).getByText('Query')).toBeInTheDocument()
  await user.click(within(action).getByRole('tab', { name: 'tools.setBuiltInTools.setting' }))
  expect(within(action).getByText('Limit')).toBeInTheDocument()
  expect(within(action).getByText('Maximum result count')).toBeInTheDocument()
  expect(within(action).queryByRole('spinbutton')).not.toBeInTheDocument()
  expect(
    within(action).queryByRole('button', { name: 'common.operation.save' }),
  ).not.toBeInTheDocument()
  await user.click(
    within(action).getByRole('button', { name: 'plugin.detailPanel.operation.back' }),
  )
  await waitFor(() =>
    expect(screen.queryByRole('dialog', { name: 'Search' })).not.toBeInTheDocument(),
  )
  expect(screen.getByRole('button', { name: 'Search' })).toBeInTheDocument()
})
