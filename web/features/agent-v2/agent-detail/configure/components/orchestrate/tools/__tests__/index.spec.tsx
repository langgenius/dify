import type { ToolProviderApiEntityResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { Credential } from '@/app/components/plugins/plugin-auth/types'
import type { AgentSoulConfigFormState } from '@/features/agent-v2/agent-composer/form-state'
import { QueryClient } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useAtomValue } from 'jotai'
import { CredentialTypeEnum } from '@/app/components/plugins/plugin-auth/types'
import { CollectionType } from '@/app/components/tools/types'
import { defaultAgentSoulConfigFormState } from '@/features/agent-v2/agent-composer/form-state'
import { AgentComposerProvider } from '@/features/agent-v2/agent-composer/provider'
import {
  agentComposerDraftAtom,
  isAgentComposerDirtyAtom,
} from '@/features/agent-v2/agent-composer/store'
import { consoleQuery } from '@/service/console'
import { seedAccountProfileQuery } from '@/test/console/account-profile'
import { seedSystemFeatures } from '@/test/console/query-data'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { seedToolProviders } from '@/test/console/tool-providers'
import { seedWorkspacePermissionsQuery } from '@/test/console/workspace-permissions'
import { createMarketplacePluginFixture } from '@/test/fixtures/plugin'
import {
  AgentOrchestrateReadOnlyContext,
  AgentOrchestrateViewingVersionContext,
} from '../../read-only-context'
import { AgentTools } from '../index'

const toolProviderState = vi.hoisted(() => ({
  builtInTools: [] as ToolProviderApiEntityResponse[] | undefined,
  customTools: [] as ToolProviderApiEntityResponse[] | undefined,
}))

const service = vi.hoisted(() => ({
  credentialInfo: vi.fn(),
  getMarketplace: vi.fn(),
  installPackage: vi.fn(),
  postMarketplace: vi.fn(),
}))

vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  get: service.credentialInfo,
  getMarketplace: service.getMarketplace,
  postMarketplace: service.postMarketplace,
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses, withConsoleClientResponses } =
    await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'workspaces.current.plugin.install.marketplace.post': service.installPackage,
    }),
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.plugin.list.installations.ids.post': async () => ({ plugins: [] }),
      'workspaces.current.toolProvider.builtin.byProvider.oauth.clientSchema.get': async () => ({
        schema: [],
        is_oauth_custom_client_enabled: false,
        is_system_oauth_params_exists: true,
        client_params: {},
        redirect_uri: '',
      }),
      'workspaces.current.tools.builtin.get': async () =>
        toolProviderState.builtInTools ?? new Promise<ToolProviderApiEntityResponse[]>(() => {}),
      'workspaces.current.tools.api.get': async () =>
        toolProviderState.customTools ?? new Promise<ToolProviderApiEntityResponse[]>(() => {}),
      'workspaces.current.tools.workflow.get': async () => [],
      'workspaces.current.tools.mcp.get': async () => [],
    }),
  }
})

const agentToolsDraft = {
  ...defaultAgentSoulConfigFormState,
  tools: [
    {
      id: 'duckduckgo',
      kind: 'provider',
      name: 'DuckDuckGo',
      iconClassName: 'i-simple-icons-duckduckgo',
      providerType: 'builtin',
      credentialKey: 'agentDetail.configure.tools.credential.authOne',
      credentialVariant: 'none',
      actions: [
        {
          id: 'duckduckgo-search',
          name: 'DuckDuckGo Search',
          toolName: 'search',
          description: 'Search the web.',
        },
        {
          id: 'duckduckgo-image-search',
          name: 'DuckDuckGo Image Search',
          toolName: 'image_search',
          description: 'Search images.',
        },
      ],
    },
    {
      id: 'lark-cli',
      kind: 'cli',
      name: 'Lark CLI',
    },
  ],
} satisfies AgentSoulConfigFormState

const reflectedAgentToolsDraft = {
  ...defaultAgentSoulConfigFormState,
  tools: [
    {
      id: 'google',
      kind: 'provider',
      name: 'google',
      iconClassName: 'i-custom-public-other-default-tool-icon',
      providerType: 'builtin',
      credentialVariant: 'none',
      actions: [
        {
          id: 'google-search',
          name: 'search',
          toolName: 'search',
          description: '',
        },
      ],
    },
  ],
} satisfies AgentSoulConfigFormState

const reflectedUnauthorizedNoCredentialDraft = {
  ...defaultAgentSoulConfigFormState,
  tools: [
    {
      id: 'duckduckgo',
      kind: 'provider',
      name: 'duckduckgo',
      iconClassName: 'i-custom-public-other-default-tool-icon',
      providerType: 'builtin',
      credentialType: 'unauthorized',
      credentialVariant: 'unauthorized',
      actions: [
        {
          id: 'duckduckgo-search',
          name: 'search',
          toolName: 'search',
          description: '',
        },
      ],
    },
  ],
} satisfies AgentSoulConfigFormState

const reflectedUninstalledPluginDraft = {
  ...defaultAgentSoulConfigFormState,
  tools: [
    {
      id: 'langgenius/google/google',
      kind: 'provider',
      name: 'langgenius/google/google',
      pluginId: 'langgenius/google',
      iconClassName: 'i-custom-public-other-default-tool-icon',
      providerType: 'plugin',
      credentialType: 'unauthorized',
      credentialVariant: 'unauthorized',
      actions: [
        {
          id: 'langgenius/google/google:search',
          name: 'search',
          toolName: 'search',
          description: '',
        },
      ],
    },
  ],
} satisfies AgentSoulConfigFormState

const reflectedUnauthorizedOAuthCredentialTypeDraft = {
  ...defaultAgentSoulConfigFormState,
  tools: [
    {
      id: 'google',
      kind: 'provider',
      name: 'google',
      iconClassName: 'i-custom-public-other-default-tool-icon',
      providerType: 'builtin',
      credentialType: 'unauthorized',
      credentialVariant: 'none',
      actions: [
        {
          id: 'google-search',
          name: 'search',
          toolName: 'search',
          description: '',
        },
      ],
    },
  ],
} satisfies AgentSoulConfigFormState

const reflectedAuthorizedSwaggerDraft = {
  ...defaultAgentSoulConfigFormState,
  tools: [
    {
      id: 'weather-api',
      kind: 'provider',
      name: 'weather-api',
      iconClassName: 'i-custom-public-other-default-tool-icon',
      providerType: CollectionType.custom,
      credentialType: 'unauthorized',
      credentialVariant: 'unauthorized',
      actions: [
        {
          id: 'weather-api:forecast',
          name: 'forecast',
          toolName: 'forecast',
          description: '',
        },
      ],
    },
  ],
} satisfies AgentSoulConfigFormState

const googleProvider = {
  id: 'google',
  name: 'google',
  author: 'Google',
  description: {
    en_US: 'Google tools.',
    zh_Hans: 'Google 工具。',
  },
  icon: 'https://example.com/google.svg',
  icon_dark: 'https://example.com/google-dark.svg',
  label: {
    en_US: 'Google Tools',
    zh_Hans: 'Google 工具',
  },
  type: CollectionType.builtIn,
  team_credentials: {},
  is_team_authorization: true,
  allow_delete: true,
  labels: [],
  tools: [
    {
      name: 'search',
      author: 'Google',
      label: {
        en_US: 'Google Search',
        zh_Hans: 'Google 搜索',
      },
      description: {
        en_US: 'Search the web with Google.',
        zh_Hans: '使用 Google 搜索网页。',
      },
      parameters: [],
      labels: [],
      output_schema: {},
    },
  ],
} satisfies ToolProviderApiEntityResponse

const duckDuckGoProvider = {
  ...googleProvider,
  id: 'duckduckgo',
  name: 'duckduckgo',
  author: 'DuckDuckGo',
  icon: 'https://example.com/duckduckgo.svg',
  icon_dark: 'https://example.com/duckduckgo-dark.svg',
  label: {
    en_US: 'DuckDuckGo',
    zh_Hans: 'DuckDuckGo',
  },
  team_credentials: {},
  is_team_authorization: true,
  allow_delete: false,
  tools: [
    {
      name: 'search',
      author: 'DuckDuckGo',
      label: {
        en_US: 'DuckDuckGo Search',
        zh_Hans: 'DuckDuckGo 搜索',
      },
      description: {
        en_US: 'Search the web with DuckDuckGo.',
        zh_Hans: '使用 DuckDuckGo 搜索网页。',
      },
      parameters: [
        {
          name: 'query',
          label: {
            en_US: 'Search Query',
            zh_Hans: '搜索查询',
          },
          human_description: {
            en_US: 'The query to search for.',
            zh_Hans: '要搜索的查询。',
          },
          type: 'string',
          form: 'form',
          llm_description: '',
          required: true,
          multiple: false,
          default: '',
        },
      ],
      labels: [],
      output_schema: {},
    },
  ],
} satisfies ToolProviderApiEntityResponse

const authorizedSwaggerProvider = {
  ...googleProvider,
  id: 'weather-api',
  name: 'weather-api',
  label: {
    en_US: 'Weather API',
    zh_Hans: '天气 API',
  },
  type: CollectionType.custom,
  team_credentials: {
    api_key: {
      type: 'secret-input',
    },
  },
  is_team_authorization: true,
  tools: [
    {
      name: 'forecast',
      author: 'Weather API',
      label: {
        en_US: 'Forecast',
        zh_Hans: '天气预报',
      },
      description: {
        en_US: 'Get the weather forecast.',
        zh_Hans: '获取天气预报。',
      },
      parameters: [],
      labels: [],
      output_schema: {},
    },
  ],
} satisfies ToolProviderApiEntityResponse

const marketplaceGooglePlugin = (identifier: string) =>
  createMarketplacePluginFixture({
    org: 'langgenius',
    name: 'google',
    plugin_id: 'langgenius/google',
    label: { en_US: 'Google Tools' },
    latest_package_identifier: identifier,
  })

const credentialInfo = (credentials: Credential[] = []) => ({
  credentials,
  supported_credential_types: [CredentialTypeEnum.OAUTH2],
  allow_custom_token: true,
  is_oauth_custom_client_enabled: false,
})

type ComposerState = {
  dirty: boolean
  tools: AgentSoulConfigFormState['tools']
}

function ComposerStateSubscriber() {
  const draft = useAtomValue(agentComposerDraftAtom)
  const dirty = useAtomValue(isAgentComposerDirtyAtom)
  return (
    <output aria-label="Composer state">{JSON.stringify({ dirty, tools: draft.tools })}</output>
  )
}

const readComposerState = (): ComposerState =>
  JSON.parse(screen.getByRole('status', { name: 'Composer state' }).textContent || '{}')

const createAgentToolsQueryClient = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })
  seedAccountProfileQuery(queryClient, { id: 'user-1' })
  seedWorkspacePermissionsQuery(queryClient, [
    'plugin.install',
    'credential.use',
    'credential.create',
    'credential.manage',
  ])
  seedSystemFeatures(queryClient, { enable_marketplace: false })
  queryClient.setQueryDefaults(consoleQuery.workspaces.current.rbac.myPermissions.get.queryKey(), {
    staleTime: Infinity,
  })
  seedToolProviders(queryClient, toolProviderState)
  return queryClient
}

function renderAgentTools(initialDraft: AgentSoulConfigFormState = agentToolsDraft) {
  const queryClient = createAgentToolsQueryClient()
  return render(
    <QueryClientTestProvider queryClient={queryClient}>
      <AgentComposerProvider initialDraft={initialDraft}>
        <AgentTools />
        <ComposerStateSubscriber />
      </AgentComposerProvider>
    </QueryClientTestProvider>,
  )
}

function renderReadonlyAgentTools({
  initialDraft = agentToolsDraft,
  viewingVersion = false,
}: {
  initialDraft?: AgentSoulConfigFormState
  viewingVersion?: boolean
} = {}) {
  const queryClient = createAgentToolsQueryClient()

  return render(
    <QueryClientTestProvider queryClient={queryClient}>
      <AgentComposerProvider initialDraft={initialDraft}>
        <AgentOrchestrateViewingVersionContext value={viewingVersion}>
          <AgentOrchestrateReadOnlyContext value>
            <AgentTools />
          </AgentOrchestrateReadOnlyContext>
        </AgentOrchestrateViewingVersionContext>
      </AgentComposerProvider>
    </QueryClientTestProvider>,
  )
}

describe('AgentTools', () => {
  let batchMarketplacePlugin: ReturnType<typeof marketplaceGooglePlugin> | undefined
  let fallbackMarketplacePlugin: ReturnType<typeof marketplaceGooglePlugin> | undefined

  beforeEach(() => {
    toolProviderState.builtInTools = []
    toolProviderState.customTools = []
    batchMarketplacePlugin = undefined
    fallbackMarketplacePlugin = undefined
    service.credentialInfo.mockReset().mockResolvedValue(credentialInfo())
    service.installPackage.mockReset().mockResolvedValue({ all_installed: true, task_id: '' })
    service.postMarketplace.mockReset().mockImplementation(async (path: string) => {
      if (path === '/plugins/versions/batch') {
        return {
          data: {
            list: batchMarketplacePlugin ? [{ plugin: batchMarketplacePlugin }] : [],
          },
        }
      }
      throw new Error(`Unexpected marketplace POST: ${path}`)
    })
    service.getMarketplace.mockReset().mockImplementation(async (path: string) => {
      if (path === '/plugins/langgenius/google' && fallbackMarketplacePlugin) {
        return {
          data: {
            plugin: fallbackMarketplacePlugin,
            version: { version: fallbackMarketplacePlugin.version },
          },
        }
      }
      throw new Error(`Unexpected marketplace GET: ${path}`)
    })
  })

  describe('User Interactions', () => {
    it('should remove a provider action when the remove button is clicked', async () => {
      const user = userEvent.setup()
      renderAgentTools()

      await user.click(screen.getByRole('button', { name: 'DuckDuckGo' }))
      await user.click(
        screen.getByRole('button', {
          name: 'agentV2.agentDetail.configure.tools.removeAction:{"name":"DuckDuckGo Image Search"}',
        }),
      )

      expect(screen.queryByText('DuckDuckGo Image Search')).not.toBeInTheDocument()
      expect(screen.getByText('DuckDuckGo Search')).toBeInTheDocument()
      expect(readComposerState().tools[0]).toMatchObject({
        actions: [{ id: 'duckduckgo-search' }],
      })
    })

    it('should remove all provider tools from the provider more-actions menu', async () => {
      const user = userEvent.setup()
      renderAgentTools()

      await user.click(
        screen.getByRole('button', {
          name: 'agentV2.agentDetail.configure.tools.moreActions:{"name":"DuckDuckGo"}',
        }),
      )
      await user.click(
        screen.getByRole('menuitem', {
          name: /agentV2\.agentDetail\.configure\.tools\.removeProvider/,
        }),
      )

      expect(screen.queryByText('DuckDuckGo')).not.toBeInTheDocument()
      expect(readComposerState().tools).toEqual([
        expect.objectContaining({ id: 'lark-cli', kind: 'cli' }),
      ])
    })

    it('should open the real tool picker directly from the add trigger', async () => {
      const user = userEvent.setup()
      renderAgentTools()

      await user.click(
        screen.getByRole('button', {
          name: 'agentV2.agentDetail.configure.tools.add',
        }),
      )

      expect(await screen.findByRole('dialog')).toBeInTheDocument()
      expect(
        screen.queryByRole('button', {
          name: /agentV2\.agentDetail\.configure\.tools\.addMenu\.cliTool\.label/,
        }),
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', {
          name: /agentV2\.agentDetail\.configure\.tools\.addMenu\.tool\.label/,
        }),
      ).not.toBeInTheDocument()
    })

    it('should hide add, edit, and remove actions when viewing a version', async () => {
      const user = userEvent.setup()
      renderReadonlyAgentTools({ viewingVersion: true })

      expect(
        screen.queryByRole('button', {
          name: 'agentV2.agentDetail.configure.tools.add',
        }),
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', {
          name: 'agentV2.agentDetail.configure.tools.moreActions:{"name":"DuckDuckGo"}',
        }),
      ).not.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'DuckDuckGo' }))

      expect(
        screen.queryByRole('button', {
          name: 'agentV2.agentDetail.configure.tools.editAction:{"name":"DuckDuckGo Search"}',
        }),
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', {
          name: 'agentV2.agentDetail.configure.tools.removeAction:{"name":"DuckDuckGo Image Search"}',
        }),
      ).not.toBeInTheDocument()
    })

    it('should hide the add action while a build draft is read-only', () => {
      renderReadonlyAgentTools()

      expect(
        screen.queryByRole('button', {
          name: 'agentV2.agentDetail.configure.tools.add',
        }),
      ).not.toBeInTheDocument()
    })

    it('should hide CLI tool rows while CLI tools are disabled', () => {
      renderAgentTools()

      expect(screen.queryByText('Lark CLI')).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', {
          name: 'agentV2.agentDetail.configure.tools.editAction:{"name":"Lark CLI"}',
        }),
      ).not.toBeInTheDocument()
    })
  })

  describe('Display Metadata', () => {
    it('should enrich reflected provider tools with provider metadata and localized names', async () => {
      const user = userEvent.setup()
      toolProviderState.builtInTools = [{ ...googleProvider, allow_delete: false }]
      renderAgentTools(reflectedAgentToolsDraft)

      await user.click(screen.getByRole('button', { name: 'Google Tools' }))

      expect(screen.getByText('Google Search')).toBeInTheDocument()
    })

    it('should install a missing provider through the marketplace and show the installed catalog', async () => {
      const user = userEvent.setup()
      batchMarketplacePlugin = marketplaceGooglePlugin('langgenius/google:1.0.0@checksum')
      renderAgentTools(reflectedUninstalledPluginDraft)

      expect(await screen.findByRole('button', { name: 'Google Tools' })).toBeInTheDocument()
      const installButton = await screen.findByRole('button', {
        name: 'workflowAgent.nodes.agent.pluginInstaller.install',
      })

      service.installPackage.mockImplementationOnce(async () => {
        toolProviderState.builtInTools = [{ ...googleProvider, id: 'langgenius/google/google' }]
        return { all_installed: true, task_id: '' }
      })
      await user.click(installButton)

      await waitFor(() =>
        expect(service.installPackage).toHaveBeenCalledExactlyOnceWith({
          body: { plugin_unique_identifiers: ['langgenius/google:1.0.0@checksum'] },
        }),
      )
      await waitFor(() => expect(installButton).not.toBeInTheDocument())
      await user.click(screen.getByRole('button', { name: 'Google Tools' }))
      expect(await screen.findByText('Google Search')).toBeInTheDocument()
    })

    it('should install the fallback manifest and show the installed catalog', async () => {
      const user = userEvent.setup()
      fallbackMarketplacePlugin = marketplaceGooglePlugin('langgenius/google:0.0.1@fallback')
      renderAgentTools(reflectedUninstalledPluginDraft)

      const installButton = await screen.findByRole('button', {
        name: 'workflowAgent.nodes.agent.pluginInstaller.install',
      })
      service.installPackage.mockImplementationOnce(async () => {
        toolProviderState.builtInTools = [{ ...googleProvider, id: 'langgenius/google/google' }]
        return { all_installed: true, task_id: '' }
      })
      await user.click(installButton)

      await waitFor(() =>
        expect(service.installPackage).toHaveBeenCalledExactlyOnceWith({
          body: { plugin_unique_identifiers: ['langgenius/google:0.0.1@fallback'] },
        }),
      )
      await waitFor(() => expect(installButton).not.toBeInTheDocument())
      await user.click(await screen.findByRole('button', { name: 'Google Tools' }))
      expect(await screen.findByText('Google Search')).toBeInTheDocument()
    })

    it('should wait for the provider catalog before showing an uninstalled status', () => {
      toolProviderState.builtInTools = undefined
      renderAgentTools(reflectedUnauthorizedNoCredentialDraft)

      expect(
        screen.queryByText('plugin.detailPanel.toolSelector.uninstalledTitle'),
      ).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'tools.notAuthorized' })).not.toBeInTheDocument()
    })

    it('should use current team authorization for reflected Swagger API tools', () => {
      toolProviderState.customTools = [authorizedSwaggerProvider]
      renderAgentTools(reflectedAuthorizedSwaggerDraft)

      expect(screen.getByRole('button', { name: 'Weather API' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'tools.notAuthorized' })).not.toBeInTheDocument()
    })

    it('should keep provider credential metadata display-only without dirtying the composer draft', () => {
      toolProviderState.builtInTools = [duckDuckGoProvider]
      renderAgentTools(reflectedUnauthorizedNoCredentialDraft)

      expect(screen.getByRole('button', { name: 'DuckDuckGo' })).toBeInTheDocument()
      const composerState = readComposerState()
      expect(composerState.tools[0]).toMatchObject({
        credentialType: 'unauthorized',
        credentialVariant: 'unauthorized',
      })
      expect(composerState.dirty).toBe(false)
    })

    it('should open real authorization actions for reflected OAuth provider tools', async () => {
      const user = userEvent.setup()
      toolProviderState.builtInTools = [
        {
          ...googleProvider,
          allow_delete: true,
          is_team_authorization: false,
          team_credentials: {},
        },
      ]
      renderAgentTools(reflectedUnauthorizedOAuthCredentialTypeDraft)

      await user.click(await screen.findByRole('button', { name: 'tools.notAuthorized' }))

      expect(await screen.findByRole('button', { name: 'plugin.auth.useOAuthAuth' })).toBeEnabled()
    })

    it('should bind an existing queried credential to the composer draft', async () => {
      const user = userEvent.setup()
      toolProviderState.builtInTools = [
        {
          ...googleProvider,
          allow_delete: true,
          is_team_authorization: false,
          team_credentials: {},
        },
      ]
      service.credentialInfo.mockImplementation(async (url: string) => {
        if (
          new URL(url, 'http://localhost').pathname !==
          '/workspaces/current/tool-provider/builtin/google/credential/info'
        )
          throw new Error(`Unexpected credential GET: ${url}`)
        return credentialInfo([
          {
            id: 'workspace-oauth',
            name: 'Workspace OAuth',
            provider: 'google',
            credential_type: CredentialTypeEnum.OAUTH2,
            is_default: true,
          },
        ])
      })
      renderAgentTools(reflectedUnauthorizedOAuthCredentialTypeDraft)

      await user.click(await screen.findByRole('button', { name: 'tools.notAuthorized' }))
      await user.click(await screen.findByText('Workspace OAuth'))

      await waitFor(() =>
        expect(readComposerState().tools[0]).toMatchObject({
          credentialId: 'workspace-oauth',
          credentialType: 'oauth2',
          credentialVariant: 'authorized',
        }),
      )
    })

    it('should open provider tool settings with the catalog parameter field', async () => {
      const user = userEvent.setup()
      toolProviderState.builtInTools = [duckDuckGoProvider]
      renderAgentTools()

      await user.click(screen.getByRole('button', { name: 'DuckDuckGo' }))
      await user.click(
        screen.getByRole('button', {
          name: 'agentV2.agentDetail.configure.tools.editAction:{"name":"DuckDuckGo Search"}',
        }),
      )

      expect(await screen.findByRole('textbox', { name: 'Search Query' })).toBeInTheDocument()
      expect(screen.getByText('Search the web with DuckDuckGo.')).toBeInTheDocument()
    })
  })
})
