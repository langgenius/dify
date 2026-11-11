import type { HumanInputV2NodeType } from '../human-input-v2/types'
import type { HumanInputNodeType } from '../human-input/types'
import { ORPCError } from '@orpc/client'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import ReactFlow, { useNodes } from 'reactflow'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { consoleQuery } from '@/service/console'
import { seedAccountProfileQuery } from '@/test/console/account-profile'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { seedToolProviders } from '@/test/console/tool-providers'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { createNode } from '../../__tests__/fixtures'
import {
  createStoresFromOptions,
  createWorkflowWrapper,
} from '../../__tests__/workflow-test-providers'
import { CUSTOM_NODE } from '../../constants'
import DatasetsDetailProvider from '../../datasets-detail-store/provider'
import { BlockEnum } from '../../types'
import { createChannelsQueryClient } from '../human-input-v2/__tests__/channel-fixtures'
import Panel from '../panel'

vi.mock('@/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/config')>()),
  ENABLE_HITL_IM: true,
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.humanInput.v2.contacts.get': async () => ({
        data: [],
        total: 0,
        page: 1,
        limit: 1,
      }),
      'workspaces.current.humanInput.v2.contactOptions.get': async () => ({
        data: [],
        total: 0,
        page: 1,
        limit: 20,
      }),
      'snippets.bySnippetId.workflows.draft.nodes.byNodeId.lastRun.get': async () => {
        throw new ORPCError('NOT_FOUND', { status: 404 })
      },
    }),
  }
})

const legacy: HumanInputNodeType = {
  title: 'Approval',
  desc: '',
  type: BlockEnum.HumanInput,
  delivery_methods: [],
  form_content: 'Legacy approval instructions',
  inputs: [],
  user_actions: [],
  timeout: 3,
  timeout_unit: 'day',
}
const migrated: HumanInputV2NodeType = {
  title: 'Approval',
  desc: '',
  type: BlockEnum.HumanInput,
  version: '2',
  recipients_spec: [],
  message_template: { subject: 'Converted approval', body: 'Review {{#url#}}' },
  debug_mode: { enabled: false, channels: [] },
  form_content: 'Converted approval instructions',
  inputs: [],
  user_actions: [],
  timeout: 36,
  timeout_unit: 'hour',
}
function SelectedPanel() {
  const node = useNodes<HumanInputNodeType | HumanInputV2NodeType>().find(
    (node) => node.id === 'approval',
  )
  return node && <Panel id={node.id} type={CUSTOM_NODE} data={node.data} />
}

it('replaces the visible panel configuration on migration and undo without closing the selected node', async () => {
  await page.viewport(1400, 1000)
  onTestFinished(guardUnexpectedFetch())
  const { queryClient } = createConsoleQueryWrapper({
    queryClient: createChannelsQueryClient([]),
    appDslVersion: '0.6.0',
  })
  onTestFinished(() => queryClient.clear())
  seedAccountProfileQuery(queryClient)
  seedModelProviderQueries(queryClient)
  queryClient.setQueryData(consoleQuery.workspaces.current.triggers.get.queryKey({ input: {} }), [])
  queryClient.setQueryData(consoleQuery.workspaces.current.agentProviders.get.queryKey(), [])
  seedToolProviders(queryClient, {
    builtInTools: [],
    customTools: [],
    workflowTools: [],
    mcpTools: [],
  })
  queryClient.setQueryData(consoleQuery.spec.schemaDefinitions.get.queryKey(), [])
  const stores = createStoresFromOptions({
    initialStoreState: { workflowCanvasWidth: 1400, nodePanelWidth: 520 },
  })
  const Wrapper = createWorkflowWrapper(stores, undefined, queryClient, {
    kind: 'snippet',
    snippetId: 'approval-test',
  })
  const owner = (data: HumanInputNodeType | HumanInputV2NodeType) => (
    <NuqsTestingAdapter>
      <Wrapper>
        <div style={{ width: 1400, height: 950 }}>
          <ReactFlow nodes={[createNode({ id: 'approval', data })]}>
            <DatasetsDetailProvider nodes={[]}>
              <SelectedPanel />
            </DatasetsDetailProvider>
          </ReactFlow>
        </div>
      </Wrapper>
    </NuqsTestingAdapter>
  )
  const view = await render(owner(legacy))
  const panel = page.getByRole('region', { name: 'Approval workflow.panel.nodePanel' })
  const settings = page.getByRole('tab', { name: 'WORKFLOWDEBUG.DEBUG.SETTINGSTAB' })
  const lastRun = page.getByRole('tab', { name: 'WORKFLOWDEBUG.DEBUG.LASTRUNTAB' })
  await expect.element(panel).toBeVisible()
  await expect
    .element(panel.getByRole('textbox', { name: 'workflow.nodes.humanInput.timeout.title' }))
    .toHaveValue('3')
  await lastRun.click()
  await expect.element(lastRun).toHaveAttribute('aria-selected', 'true')

  // Document replacement is a public prop transition, keeping the owner and selection mounted.
  await view.rerender(owner(migrated))
  await expect.element(settings).toHaveAttribute('aria-selected', 'true')
  await expect
    .element(panel.getByRole('textbox', { name: 'workflow.nodes.humanInput.timeout.title' }))
    .toHaveValue('36')
  await panel.getByRole('button', { name: 'workflow.common.configure' }).click()
  const subject = page.getByRole('textbox', {
    name: 'workflow.nodes.humanInputV2.template.subject',
  })
  await expect.poll(() => subject.element().textContent).toBe('Converted approval')
  await page.getByRole('button', { name: 'common.operation.cancel' }).click()
  await expect.element(subject).not.toBeInTheDocument()
  await lastRun.click()
  await expect.element(lastRun).toHaveAttribute('aria-selected', 'true')

  await view.rerender(owner(legacy))
  await expect.element(settings).toHaveAttribute('aria-selected', 'true')
  await expect
    .element(panel.getByRole('textbox', { name: 'workflow.nodes.humanInput.timeout.title' }))
    .toHaveValue('3')
  await expect
    .element(panel.getByRole('button', { name: 'workflow.common.configure' }))
    .not.toBeInTheDocument()
  await expect
    .element(panel.getByText('workflow.nodes.humanInputMigration.oldVersion'))
    .toBeVisible()
})
