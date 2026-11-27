import {
  zApiProviderDetailResponse,
  zToolApiEntity,
  zWorkflowToolDetailResponse,
} from '@dify/contracts/api/console/workspaces/zod.gen'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createToolProviderFixture } from '@/test/console/tool-provider-fixture'
import { apiError, hold, setupFakeApi } from '@/test/fake-api'
import { selectToolProvider } from '../../utils/query-select'
import ProviderDetail from '../detail'

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

const fake = setupFakeApi({
  console: {
    workspaces: {
      current: {
        toolProvider: {
          builtin: { byProvider: { tools: { get: () => [tool] } } },
          api: {
            tools: { get: () => [tool] },
            get: { get: () => customDetail },
            delete: { post: () => ({ result: 'success' }) },
          },
          workflow: {
            get: { get: () => workflowDetail },
            delete: { post: () => ({ result: 'success' }) },
          },
        },
      },
    },
  },
})
const toolProvider = () => fake.console.workspaces.current.toolProvider

it.each([
  { collection: custom, title: 'tools.createTool.editTitle', kind: 'custom' },
  { collection: workflow, title: 'navigation.common.workflowAsTool', kind: 'workflow' },
])(
  'keeps a $kind deletion pending and preserves the editor for retry',
  async ({ collection, title, kind }) => {
    const operation =
      kind === 'custom' ? toolProvider().api.delete.post : toolProvider().workflow.delete.post
    const pending =
      kind === 'custom'
        ? hold(toolProvider().api.delete.post)
        : hold(toolProvider().workflow.delete.post)
    const { wrapper: Wrapper, queryClient } = createConsoleQueryWrapper({
      workspacePermissionKeys: ['tool.manage'],
    })
    seedModelProviderQueries(queryClient)
    const onRefreshData = vi.fn()
    await render(
      <Wrapper>
        <ProviderDetail collection={collection} onHide={vi.fn()} onRefreshData={onRefreshData} />
      </Wrapper>,
    )
    await page.getByRole('button', { name: 'tools.createTool.editAction' }).click()
    const editor = page.getByRole('dialog', { name: title })
    const name = editor.getByRole('textbox', { name: /^tools.createTool.name\b/ })
    await name.fill('Unsaved tool name')
    await editor.getByRole('button', { name: 'common.operation.delete' }).click()
    const confirm = page.getByRole('alertdialog', {
      name: 'tools.createTool.deleteToolConfirmTitle',
    })
    const submit = confirm.getByRole('button', { name: 'common.operation.confirm' })
    await submit.click()
    await expect.element(submit).toHaveAttribute('aria-disabled', 'true')
    await userEvent.keyboard('{Enter}')
    await pending.arrived
    expect(operation).toHaveBeenCalledTimes(1)
    await userEvent.keyboard('{Escape}')
    await expect.element(confirm).toBeVisible()
    await expect
      .element(confirm.getByRole('button', { name: 'common.operation.cancel' }))
      .toBeDisabled()
    expect(onRefreshData).not.toHaveBeenCalled()
    pending.reject(apiError({ status: 500, message: 'Deletion failed' }))
    await expect.element(submit).not.toHaveAttribute('aria-disabled', 'true')
    await confirm.getByRole('button', { name: 'common.operation.cancel' }).click()
    await expect.element(confirm).not.toBeInTheDocument()
    await expect
      .element(editor.getByRole('button', { name: 'common.operation.delete' }))
      .toHaveFocus()
    await expect.element(name).toHaveValue('Unsaved tool name')
    await editor.getByRole('button', { name: 'common.operation.delete' }).click()
    await submit.click()
    await expect.element(confirm).not.toBeInTheDocument()
    await expect.element(editor).not.toBeInTheDocument()
    expect(operation).toHaveBeenCalledTimes(2)
    expect(onRefreshData).toHaveBeenCalledOnce()
  },
)
