import type { TestCredentialPreflightResponse } from '@dify/contracts/api/console/apps/types.gen'
import type { Node } from '../../types'
import ReactFlow, { ReactFlowProvider } from 'reactflow'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { consoleQuery } from '@/service/console'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { seedToolProviders } from '@/test/console/tool-providers'
import { createNode, createStartNode } from '../../__tests__/fixtures'
import {
  createStoresFromOptions,
  createWorkflowWrapper,
} from '../../__tests__/workflow-test-providers'
import { BlockEnum } from '../../types'
import WorkflowPreview from '../workflow-preview'

const { preflight, credentialInfo, unexpectedFetch } = vi.hoisted(() => ({
  preflight: vi.fn<() => Promise<TestCredentialPreflightResponse>>(),
  credentialInfo: vi.fn(),
  unexpectedFetch: vi.fn<typeof fetch>(() => new Promise(() => {})),
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'apps.byAppId.workflows.draft.testCredentials.preflight.post': preflight,
    }),
  }
})

vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  get: credentialInfo,
}))

const createConnectionTool = (id: string, data: Record<string, unknown> = {}) =>
  createNode({
    id,
    data: {
      type: BlockEnum.Tool,
      title: `Tool ${id}`,
      provider_id: 'provider',
      provider_name: 'Test Provider',
      provider_type: 'builtin',
      tool_name: 'search',
      tool_parameters: {},
      tool_configurations: {},
      credential_source: 'end_user',
      end_user_auth: { allowed_credential_types: ['api-key'] },
      ...data,
    },
  })

const connected = (nodeIds: string[]): TestCredentialPreflightResponse => ({
  ready: true,
  credentials: nodeIds.map((id) => ({
    node_id: id,
    node_ids: [id],
    credential_id: 'key-1',
    status: 'connected',
    check: null,
  })),
})

async function setup(nodes: Node[]) {
  const handleRun = vi.fn()
  const { queryClient } = createConsoleQueryWrapper({
    workspacePermissionKeys: ['credential.use', 'credential.create', 'credential.manage'],
  })
  seedModelProviderQueries(queryClient)
  seedToolProviders(queryClient, {
    builtInTools: [],
    customTools: [],
    workflowTools: [],
    mcpTools: [],
  })
  queryClient.setQueryData(consoleQuery.spec.schemaDefinitions.get.queryKey(), [])
  queryClient.setQueryData(
    consoleQuery.workspaces.current.toolProvider.builtin.byProvider.credential.schema.byCredentialType.get.queryKey(
      { input: { params: { provider: 'provider', credential_type: 'api-key' } } },
    ),
    [],
  )
  const stores = createStoresFromOptions({
    initialStoreState: { showDebugAndPreviewPanel: true, showInputsPanel: true },
    hooksStoreProps: {
      handleRun,
      doSyncWorkflowDraft: vi.fn(async () => ({ hash: 'saved', updatedAt: 1 })),
    },
  })
  const Wrapper = createWorkflowWrapper(stores, undefined, queryClient)
  const screen = await render(
    <Wrapper>
      <ReactFlowProvider>
        <div style={{ width: 800, height: 1 }}>
          <ReactFlow defaultNodes={[createStartNode(), ...nodes]} defaultEdges={[]} />
        </div>
        <div style={{ height: 700 }}>
          <WorkflowPreview />
        </div>
      </ReactFlowProvider>
    </Wrapper>,
  )
  return { screen, handleRun }
}

beforeEach(() => {
  vi.stubGlobal('fetch', unexpectedFetch)
  preflight.mockReset()
  credentialInfo.mockReset().mockResolvedValue({
    credentials: [
      {
        id: 'key-1',
        name: 'Workspace key',
        provider: 'provider',
        credential_type: 'api-key',
        is_default: true,
      },
    ],
    supported_credential_types: ['api-key'],
    allow_custom_token: true,
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  expect(unexpectedFetch).not.toHaveBeenCalled()
})

it('enables Run only after every independent test connection is selected and validated', async () => {
  preflight
    .mockResolvedValueOnce({
      ready: false,
      credentials: [
        ...connected(['tool-1']).credentials,
        {
          node_id: 'tool-2',
          node_ids: ['tool-2'],
          credential_id: null,
          status: 'disconnected',
          check: null,
        },
      ],
    })
    .mockResolvedValue(connected(['tool-1', 'tool-2']))
  const { screen, handleRun } = await setup([
    createConnectionTool('tool-1'),
    createConnectionTool('tool-2'),
    createConnectionTool('reuse', {
      credential_source: 'reuse_node',
      reuse_node_id: 'tool-1',
    }),
    createConnectionTool('workspace', { credential_source: 'workspace' }),
  ])
  const run = screen.getByRole('button', { name: 'workflow.singleRun.startRun' })
  const setupRegion = screen.getByRole('region', { name: 'share.connections.configure.title' })
  await expect.element(run).toBeDisabled()
  const rows = setupRegion.getByRole('listitem', { name: 'Test Provider' })
  await expect.element(rows).toHaveLength(2)
  await rows
    .nth(0)
    .getByRole('button', { name: /selectConnection/ })
    .click()
  await page
    .getByRole('dialog', { name: 'plugin.auth.authorization' })
    .getByRole('button', { name: /^Workspace key/ })
    .click()
  await expect.poll(() => preflight.mock.calls.length).toBe(1)
  await expect.element(run).toBeDisabled()
  expect(handleRun).not.toHaveBeenCalled()

  await rows
    .nth(1)
    .getByRole('button', { name: /selectConnection/ })
    .click()
  await page
    .getByRole('dialog', { name: 'plugin.auth.authorization' })
    .getByRole('button', { name: /^Workspace key/ })
    .click()
  await expect.element(run).toBeEnabled()
  await run.click()
  await expect.poll(() => handleRun.mock.calls.length).toBe(1)
  expect(handleRun).toHaveBeenCalledWith({ inputs: {}, files: [] })
  expect(preflight).toHaveBeenCalledTimes(3)
})

it('keeps Run disabled after a connection check fails until retry succeeds', async () => {
  preflight
    .mockRejectedValueOnce(new Error('preflight unavailable'))
    .mockResolvedValue(connected(['tool-1']))
  const { screen, handleRun } = await setup([
    createConnectionTool('tool-1', { test_credential_id: 'key-1' }),
  ])
  const run = screen.getByRole('button', { name: 'workflow.singleRun.startRun' })
  await run.click()
  await expect.element(screen.getByRole('alert')).toHaveTextContent('common.api.actionFailed')
  await expect.element(run).toBeDisabled()
  expect(handleRun).not.toHaveBeenCalled()
  await screen.getByRole('button', { name: 'common.operation.retry' }).click()
  await expect.element(run).toBeEnabled()
  await run.click()
  await expect.poll(() => handleRun.mock.calls.length).toBe(1)
})
