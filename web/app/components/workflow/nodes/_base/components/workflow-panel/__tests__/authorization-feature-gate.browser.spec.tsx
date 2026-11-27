import type { GetFeaturesResponse } from '@dify/contracts/api/console/features/types.gen'
import type { ReactFlowInstance } from 'reactflow'
import type { ToolAuthorizationData } from '@/app/components/workflow/nodes/tool/authorization-config'
import type { ToolNodeType } from '@/app/components/workflow/nodes/tool/types'
import { TooltipProvider } from '@langgenius/dify-ui/tooltip'
import { Suspense, useEffect } from 'react'
import ReactFlow, { ReactFlowProvider, useReactFlow } from 'reactflow'
import { render } from 'vitest-browser-react'
import { CollectionType } from '@/app/components/tools/types'
import { createNode } from '@/app/components/workflow/__tests__/fixtures'
import {
  createStoresFromOptions,
  createWorkflowWrapper,
} from '@/app/components/workflow/__tests__/workflow-test-providers'
import { ToolCredentialSource } from '@/app/components/workflow/nodes/tool/types'
import { BlockEnum } from '@/app/components/workflow/types'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { setupFakeApi } from '@/test/fake-api'
import { createNuqsTestWrapper } from '@/test/nuqs-testing'
import ToolAuthorization from '../tool-authorization'

const features = vi.fn<() => Promise<GetFeaturesResponse>>()
let oauthSupported = false

beforeEach(() => {
  oauthSupported = false
})

setupFakeApi({
  console: {
    features: { get: () => features() },
    workspaces: {
      current: {
        toolProvider: {
          builtin: {
            byProvider: {
              credential: {
                info: {
                  get: () => ({
                    credentials: [
                      {
                        id: 'workspace-key',
                        name: 'Workspace connection',
                        provider: 'provider-a',
                        credential_type: 'api-key',
                        is_default: true,
                      },
                      {
                        id: 'replacement-key',
                        name: 'Replacement connection',
                        provider: 'provider-a',
                        credential_type: 'api-key',
                      },
                      {
                        id: 'saved-test-key',
                        name: 'Test connection',
                        provider: 'provider-a',
                        credential_type: 'api-key',
                      },
                    ],
                    supported_credential_types: oauthSupported
                      ? ['api-key', 'oauth2']
                      : ['api-key'],
                  }),
                },
                schema: { byCredentialType: { get: () => [] } },
              },
              oauth: {
                clientSchema: {
                  get: () => ({
                    schema: [],
                    is_oauth_custom_client_enabled: false,
                    is_system_oauth_params_exists: true,
                    client_params: {},
                    redirect_uri: 'https://example.com/oauth/callback',
                  }),
                },
              },
            },
          },
        },
      },
    },
  },
})

function authorizationData(data: Partial<ToolNodeType>): ToolAuthorizationData {
  return {
    credential_source: data.credential_source,
    credential_id: data.credential_id,
    end_user_auth: data.end_user_auth,
    reuse_node_id: data.reuse_node_id,
    test_credential_id: data.test_credential_id,
  }
}

async function setup(
  enabled: boolean,
  saved: Partial<ToolNodeType> = {},
  featureRequest?: Promise<GetFeaturesResponse>,
  readOnly = false,
) {
  const { queryClient, wrapper: ConsoleProviders } = createConsoleQueryWrapper({
    features: { end_user_auth_enabled: enabled },
    workspacePermissionKeys: ['credential.use', 'credential.create', 'credential.manage'],
  })
  onTestFinished(() => queryClient.clear())
  const stores = createStoresFromOptions({
    initialStoreState: { canvasReadOnly: readOnly },
    // boundary: the editor's draft transport is injected; graph mutation and synchronization hooks remain real.
    hooksStoreProps: { doSyncWorkflowDraft: vi.fn(async () => ({ hash: 'saved', updatedAt: 1 })) },
  })
  onTestFinished(() => stores.store.getState().debouncedSyncWorkflowDraft.cancel?.())
  const WorkflowProviders = createWorkflowWrapper(stores, undefined, queryClient)
  const { wrapper: UrlState } = createNuqsTestWrapper()
  const featureResponse = queryClient.getQueryData<GetFeaturesResponse>(
    consoleQuery.features.get.queryKey(),
  )
  if (!featureResponse) throw new Error('Expected the initial feature response fixture')
  features.mockResolvedValue(featureResponse)
  if (featureRequest) {
    features.mockReturnValue(featureRequest)
    queryClient.removeQueries({ queryKey: consoleQuery.features.get.queryKey(), exact: true })
  }
  let graph: ReactFlowInstance<ToolNodeType> | undefined
  function GraphBoundary() {
    const flow = useReactFlow<ToolNodeType>()
    useEffect(() => {
      graph = flow
    }, [flow])
    return null
  }
  const node = createNode({
    id: 'current-tool',
    type: 'default',
    data: {
      type: BlockEnum.Tool,
      title: 'Current tool',
      provider_id: 'provider-id-a',
      provider_name: 'provider-a',
      provider_type: CollectionType.builtIn,
      plugin_id: 'plugin-a',
      tool_name: 'search',
      tool_label: 'Search',
      tool_parameters: {},
      tool_configurations: {},
      ...saved,
    },
  })
  const sourceNode = createNode({
    id: 'available-source',
    type: 'default',
    data: {
      ...node.data,
      title: 'Source tool',
      credential_source: ToolCredentialSource.Workspace,
      credential_id: 'workspace-key',
      reuse_node_id: undefined,
    },
  })
  const screen = await render(
    <ConsoleProviders>
      <WorkflowProviders>
        <UrlState>
          <TooltipProvider>
            <ReactFlowProvider>
              <div style={{ width: 800, height: 1 }}>
                <ReactFlow defaultNodes={[node, sourceNode]} defaultEdges={[]} />
              </div>
              <GraphBoundary />
              <section aria-label="Current node authorization">
                <Suspense fallback={<p role="status">Loading authorization configuration</p>}>
                  <ToolAuthorization
                    nodeId={node.id}
                    providerId="provider-id-a"
                    pluginPayload={{ category: 'tool', provider: 'provider-a' }}
                    nodeAuth={{
                      providerName: 'Example provider',
                      onAuthorizationItemClick: vi.fn(),
                    }}
                    showAuthorizationTabs
                  />
                </Suspense>
              </section>
            </ReactFlowProvider>
          </TooltipProvider>
        </UrlState>
      </WorkflowProviders>
    </ConsoleProviders>,
  )
  return {
    screen,
    featureResponse,
    readAuthorization: () => {
      const current = graph?.getNode(node.id)
      if (!current) throw new Error('Expected the current workflow node')
      return authorizationData(current.data)
    },
  }
}

it.each([
  {
    mode: 'App user',
    saved: {
      credential_source: ToolCredentialSource.EndUser,
      end_user_auth: { allowed_credential_types: ['api-key' as const], purpose: 'Saved purpose' },
      test_credential_id: 'saved-test-key',
    },
  },
  {
    mode: 'Reuse from node',
    saved: { credential_source: ToolCredentialSource.ReuseNode, reuse_node_id: 'saved-source' },
  },
])(
  'shows only Workspace auth with the flag off while preserving saved $mode until selection',
  async ({ saved }) => {
    const { screen, readAuthorization } = await setup(false, saved)
    const panel = screen.getByRole('region', { name: 'Current node authorization' })
    await expect
      .element(panel.getByRole('heading', { name: 'plugin.auth.authorization' }))
      .toBeVisible()
    await expect.element(panel.getByRole('tablist')).not.toBeInTheDocument()
    await expect.element(panel.getByRole('button', { name: /Workspace connection/ })).toBeVisible()
    expect(readAuthorization()).toEqual(authorizationData(saved))

    await panel.getByRole('button', { name: /Workspace connection/ }).click()
    await screen
      .getByRole('dialog', { name: 'plugin.auth.authorization' })
      .getByRole('button', { name: /^Replacement connection/ })
      .click()
    await expect
      .element(panel.getByRole('button', { name: /Replacement connection/ }))
      .toBeVisible()
    await expect.poll(readAuthorization).toEqual({
      credential_source: ToolCredentialSource.Workspace,
      credential_id: 'replacement-key',
      end_user_auth: undefined,
      reuse_node_id: undefined,
      test_credential_id: undefined,
    })
  },
)

it('exposes all three authorization modes when the Console feature flag is enabled', async () => {
  const { screen, readAuthorization } = await setup(true, {
    credential_source: ToolCredentialSource.Workspace,
    credential_id: 'workspace-key',
  })
  const panel = screen.getByRole('region', { name: 'Current node authorization' })
  await expect.element(panel.getByRole('tab', { name: 'plugin.auth.workspaceAuth' })).toBeVisible()
  await expect.element(panel.getByRole('tab', { name: 'plugin.auth.appUserAuth' })).toBeVisible()
  await expect.element(panel.getByRole('tab', { name: 'plugin.auth.reuseFromNode' })).toBeVisible()
  await panel.getByRole('tab', { name: 'plugin.auth.appUserAuth' }).click()
  await expect
    .element(panel.getByRole('textbox', { name: 'plugin.auth.appUser.connectionDescription' }))
    .toBeVisible()
  await expect.poll(() => readAuthorization().credential_source).toBe(ToolCredentialSource.EndUser)
})

it('waits for the Console feature response before exposing any authorization controls', async () => {
  const response = createDeferred<GetFeaturesResponse>()
  const saved = {
    credential_source: ToolCredentialSource.EndUser,
    end_user_auth: { allowed_credential_types: ['api-key' as const], purpose: 'Existing purpose' },
    test_credential_id: 'saved-test-key',
  }
  const { screen, featureResponse, readAuthorization } = await setup(true, saved, response.promise)
  const panel = screen.getByRole('region', { name: 'Current node authorization' })
  try {
    await expect
      .element(panel.getByRole('status'))
      .toHaveTextContent('Loading authorization configuration')
    await expect.element(panel.getByRole('tablist')).not.toBeInTheDocument()
    await expect
      .element(panel.getByRole('button', { name: /Workspace connection/ }))
      .not.toBeInTheDocument()
    expect(readAuthorization()).toEqual(authorizationData(saved))
  } finally {
    response.resolve(featureResponse)
  }
  await expect.element(panel.getByRole('tab', { name: 'plugin.auth.appUserAuth' })).toBeVisible()
  await expect.element(panel.getByRole('status')).not.toBeInTheDocument()
  expect(readAuthorization()).toEqual(authorizationData(saved))
})

it('shows the available OAuth client without editing the draft until the author changes a field', async () => {
  oauthSupported = true
  const saved = {
    credential_source: ToolCredentialSource.EndUser,
    end_user_auth: { allowed_credential_types: ['oauth2' as const], purpose: 'Existing purpose' },
  }
  const { screen, readAuthorization } = await setup(true, saved)
  const panel = screen.getByRole('region', { name: 'Current node authorization' })
  await expect
    .element(panel.getByRole('button', { name: 'plugin.auth.appUser.defaultClient' }))
    .toBeEnabled()
  expect(readAuthorization()).toEqual(authorizationData(saved))

  await panel
    .getByRole('textbox', { name: 'plugin.auth.appUser.connectionDescription' })
    .fill('Updated purpose')
  await expect
    .poll(() => readAuthorization().end_user_auth)
    .toEqual({
      allowed_credential_types: ['oauth2'],
      purpose: 'Updated purpose',
      oauth_client_type: 'default',
    })
})

it('makes App User Auth fields read-only in a read-only workflow', async () => {
  oauthSupported = true
  const saved = {
    credential_source: ToolCredentialSource.EndUser,
    end_user_auth: {
      allowed_credential_types: ['api-key' as const, 'oauth2' as const],
      oauth_client_type: 'default' as const,
      purpose: 'Existing purpose',
    },
    test_credential_id: 'saved-test-key',
  }
  const { screen } = await setup(true, saved, undefined, true)
  const panel = screen.getByRole('region', { name: 'Current node authorization' })
  const description = panel.getByRole('textbox', {
    name: 'plugin.auth.appUser.connectionDescription',
  })
  await expect.element(description).toHaveAttribute('readonly')
  await expect.element(description).toHaveValue('Existing purpose')
  await expect
    .element(panel.getByRole('checkbox', { name: 'plugin.auth.appUser.oauth' }))
    .toBeDisabled()
  await expect
    .element(panel.getByRole('checkbox', { name: 'plugin.auth.connection.apiKey' }))
    .toBeDisabled()
  await expect
    .element(panel.getByRole('button', { name: 'plugin.auth.appUser.defaultClient' }))
    .toBeDisabled()
  await expect.element(panel.getByRole('button', { name: /^Test connection/ })).toBeDisabled()
})

it('shows the saved reuse source without allowing it to change in a read-only workflow', async () => {
  const { screen } = await setup(
    true,
    {
      credential_source: ToolCredentialSource.ReuseNode,
      reuse_node_id: 'available-source',
    },
    undefined,
    true,
  )
  const panel = screen.getByRole('region', { name: 'Current node authorization' })
  const source = panel.getByRole('combobox', { name: 'plugin.auth.reuse.selectNode' })
  await expect.element(source).toMatchTextContent(/Source tool/)
  await expect.element(source).toBeDisabled()
  await expect
    .element(panel.getByRole('button', { name: 'plugin.auth.reuse.locateSource' }))
    .toBeEnabled()
})
