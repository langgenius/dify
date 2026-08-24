import type { AddOAuthButtonProps, Credential } from '@/app/components/plugins/plugin-auth/types'
import type { ToolWithProvider } from '@/app/components/workflow/types'
import type { AgentSoulConfigFormState } from '@/features/agent-v2/agent-composer/form-state'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createStore, Provider as JotaiProvider } from 'jotai'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { CredentialTypeEnum } from '@/app/components/plugins/plugin-auth/types'
import { CollectionType } from '@/app/components/tools/types'
import { defaultAgentSoulConfigFormState } from '@/features/agent-v2/agent-composer/form-state'
import { AgentComposerProvider } from '@/features/agent-v2/agent-composer/provider'
import {
  agentComposerDraftAtom,
  agentComposerSavedDraftAtom,
  isAgentComposerDirtyAtom,
} from '@/features/agent-v2/agent-composer/store'
import { seedAccountProfileQuery } from '@/test/console/account-profile'
import { AgentOrchestrateReadOnlyContext } from '../../read-only-context'
import { AgentTools } from '../index'

const toolProviderState = vi.hoisted(() => ({
  builtInTools: [] as ToolWithProvider[] | undefined,
}))
const pluginAuthState = vi.hoisted(() => ({
  canOAuth: true as boolean | undefined,
  canApiKey: false as boolean | undefined,
  credentials: [] as Credential[],
  notAllowCustomCredential: false,
  invalidPluginCredentialInfo: vi.fn(),
}))
const pluginInstallState = vi.hoisted(() => ({
  manifest: undefined as
    | {
        label: Record<string, string>
        latest_package_identifier: string
      }
    | undefined,
  fallbackManifest: undefined as
    | {
        latest_package_identifier: string
      }
    | undefined,
  invalidateBuiltInTools: vi.fn(),
  invalidateInstalledPluginList: vi.fn(),
}))

vi.mock('@/app/components/workflow/block-selector/tool-picker', () => ({
  ToolPickerContent: () => <div>Mock tool picker</div>,
}))

vi.mock('@/app/components/workflow/block-icon', () => ({
  default: ({ toolIcon }: { toolIcon?: string | { content: string; background: string } }) => (
    <span aria-hidden data-testid="tool-icon">
      {typeof toolIcon === 'string' ? toolIcon : toolIcon?.content}
    </span>
  ),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/install-plugin-button', () => ({
  InstallPluginButton: ({
    uniqueIdentifier,
    onSuccess,
  }: {
    uniqueIdentifier: string
    onSuccess?: () => void
  }) => (
    <button type="button" data-unique-identifier={uniqueIdentifier} onClick={onSuccess}>
      workflow.nodes.agent.pluginInstaller.install
    </button>
  ),
}))

vi.mock('@/service/use-plugins', () => ({
  useInvalidateInstalledPluginList: () => pluginInstallState.invalidateInstalledPluginList,
  useFetchPluginsInMarketPlaceByInfo: (infos: Array<{ organization: string; plugin: string }>) => ({
    data:
      infos.length > 0 && pluginInstallState.manifest
        ? {
            data: {
              list: infos.map(({ organization, plugin }) => ({
                plugin: {
                  ...pluginInstallState.manifest,
                  name: plugin,
                  plugin_id: `${organization}/${plugin}`,
                },
              })),
            },
          }
        : undefined,
  }),
  usePluginManifestInfo: (pluginId: string) => ({
    data:
      pluginId && pluginInstallState.fallbackManifest
        ? {
            data: {
              plugin: pluginInstallState.fallbackManifest,
            },
          }
        : undefined,
  }),
}))

vi.mock('@/utils/get-icon', () => ({
  getIconFromMarketPlace: (pluginId: string) => `https://marketplace.example.com/${pluginId}/icon`,
}))

vi.mock('@/app/components/plugins/plugin-auth/authorize/add-oauth-button', () => ({
  default: ({ buttonText, onUpdate, renderTrigger }: AddOAuthButtonProps) => {
    const trigger = (
      <button type="button" onClick={onUpdate}>
        {buttonText}
      </button>
    )

    if (renderTrigger) {
      return renderTrigger({
        isConfigured: false,
        onClick: () => onUpdate?.(),
        trigger,
      })
    }

    return trigger
  },
}))

vi.mock('@/app/components/plugins/plugin-auth/hooks/use-plugin-auth', () => ({
  usePluginAuth: () => ({
    ...pluginAuthState,
    isAuthorized: pluginAuthState.credentials.length > 0,
  }),
}))

vi.mock('@/hooks/use-credential-permissions', () => ({
  useCredentialPermissions: () => ({
    canUseCredential: true,
    canCreateCredential: true,
    canManageCredential: true,
  }),
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/model-modal/Form', () => ({
  default: ({
    formSchemas,
  }: {
    formSchemas: Array<{ label?: Record<string, string>; variable?: string }>
  }) => (
    <form aria-label="tool settings">
      {formSchemas.map((schema) => (
        <div key={schema.variable}>{schema.label?.en_US}</div>
      ))}
    </form>
  ),
}))

vi.mock('@/service/use-tools', () => ({
  useAllBuiltInTools: () => ({ data: toolProviderState.builtInTools }),
  useAllCustomTools: () => ({ data: [] }),
  useAllWorkflowTools: () => ({ data: [] }),
  useAllMCPTools: () => ({ data: [] }),
  useInvalidateAllBuiltInTools: () => pluginInstallState.invalidateBuiltInTools,
  useInvalidToolsByType: () => vi.fn(),
}))

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
  meta: {
    version: '0.0.1',
  },
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
} satisfies ToolWithProvider

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
} satisfies ToolWithProvider

function renderAgentTools(initialDraft: AgentSoulConfigFormState = agentToolsDraft) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })
  seedAccountProfileQuery(queryClient, { id: 'user-1' })

  return render(
    <QueryClientProvider client={queryClient}>
      <AgentComposerProvider initialDraft={initialDraft}>
        <AgentTools />
      </AgentComposerProvider>
    </QueryClientProvider>,
  )
}

function renderAgentToolsWithStore(initialDraft: AgentSoulConfigFormState = agentToolsDraft) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })
  seedAccountProfileQuery(queryClient, { id: 'user-1' })
  const store = createStore()
  store.set(agentComposerDraftAtom, initialDraft)
  store.set(agentComposerSavedDraftAtom, initialDraft)

  const view = render(
    <QueryClientProvider client={queryClient}>
      <JotaiProvider store={store}>
        <AgentTools />
      </JotaiProvider>
    </QueryClientProvider>,
  )

  return {
    ...view,
    store,
  }
}

function renderReadonlyAgentTools(initialDraft: AgentSoulConfigFormState = agentToolsDraft) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })
  seedAccountProfileQuery(queryClient, { id: 'user-1' })

  return render(
    <QueryClientProvider client={queryClient}>
      <AgentComposerProvider initialDraft={initialDraft}>
        <AgentOrchestrateReadOnlyContext value>
          <AgentTools />
        </AgentOrchestrateReadOnlyContext>
      </AgentComposerProvider>
    </QueryClientProvider>,
  )
}

describe('AgentTools', () => {
  beforeEach(() => {
    cleanup()
    vi.clearAllMocks()
    toolProviderState.builtInTools = []
    pluginAuthState.canOAuth = true
    pluginAuthState.canApiKey = false
    pluginAuthState.credentials = []
    pluginAuthState.notAllowCustomCredential = false
    pluginInstallState.manifest = undefined
    pluginInstallState.fallbackManifest = undefined
    pluginInstallState.invalidateBuiltInTools.mockResolvedValue(undefined)
    pluginInstallState.invalidateInstalledPluginList.mockResolvedValue(undefined)
  })

  describe('User Interactions', () => {
    it('should remove a provider action when the remove button is clicked', async () => {
      const user = userEvent.setup()
      renderAgentTools()

      await user.click(
        screen.getByRole('button', {
          name: 'DuckDuckGo',
        }),
      )

      await user.click(
        screen.getByRole('button', {
          name: 'agentV2.agentDetail.configure.tools.removeAction:{"name":"DuckDuckGo Image Search"}',
        }),
      )

      expect(screen.queryByText('DuckDuckGo Image Search')).not.toBeInTheDocument()
      expect(screen.getByText('DuckDuckGo Search')).toBeInTheDocument()
      expect(screen.getByText('DuckDuckGo')).toBeInTheDocument()
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
      expect(screen.queryByText('DuckDuckGo Search')).not.toBeInTheDocument()
      expect(screen.queryByText('Lark CLI')).not.toBeInTheDocument()
    })

    it('should open the tool picker directly from the add trigger', async () => {
      const user = userEvent.setup()
      renderAgentTools()

      await user.click(
        screen.getByRole('button', {
          name: 'agentV2.agentDetail.configure.tools.add',
        }),
      )

      expect(screen.getByText('Mock tool picker')).toBeInTheDocument()
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
      expect(
        screen.getByRole('button', {
          name: 'agentV2.agentDetail.configure.tools.add',
        }),
      ).toBeInTheDocument()
    })

    it('should hide add, edit, and remove actions when readonly', async () => {
      const user = userEvent.setup()
      renderReadonlyAgentTools()

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

      await user.click(
        screen.getByRole('button', {
          name: 'DuckDuckGo',
        }),
      )

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
      expect(
        screen.queryByRole('button', {
          name: 'agentV2.agentDetail.configure.tools.editAction:{"name":"Lark CLI"}',
        }),
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', {
          name: 'agentV2.agentDetail.configure.tools.removeAction:{"name":"Lark CLI"}',
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
      expect(
        screen.queryByRole('button', {
          name: 'agentV2.agentDetail.configure.tools.removeAction:{"name":"Lark CLI"}',
        }),
      ).not.toBeInTheDocument()
    })
  })

  describe('Display Metadata', () => {
    it('should enrich reflected provider tools with provider icon and localized names', async () => {
      const user = userEvent.setup()
      toolProviderState.builtInTools = [
        {
          ...googleProvider,
          allow_delete: false,
        },
      ]
      renderAgentTools(reflectedAgentToolsDraft)

      expect(
        screen.getByRole('button', {
          name: 'Google Tools',
        }),
      ).toBeInTheDocument()
      expect(screen.getByText('https://example.com/google.svg')).toBeInTheDocument()

      await user.click(
        screen.getByRole('button', {
          name: 'Google Tools',
        }),
      )

      expect(screen.getByText('Google Search')).toBeInTheDocument()
    })

    it('should let users install a missing provider and show its marketplace icon', async () => {
      const user = userEvent.setup()
      pluginInstallState.manifest = {
        label: {
          en_US: 'Google Tools',
        },
        latest_package_identifier: 'langgenius/google:1.0.0@checksum',
      }
      renderAgentTools(reflectedUninstalledPluginDraft)

      expect(screen.getByRole('button', { name: 'Google Tools' })).toBeInTheDocument()
      expect(
        screen.getByText('https://marketplace.example.com/langgenius/google/icon'),
      ).toBeInTheDocument()
      expect(
        screen.queryByRole('button', {
          name: 'tools.notAuthorized',
        }),
      ).not.toBeInTheDocument()

      const installButton = screen.getByRole('button', {
        name: 'workflow.nodes.agent.pluginInstaller.install',
      })
      expect(installButton).toHaveAttribute(
        'data-unique-identifier',
        'langgenius/google:1.0.0@checksum',
      )

      await user.click(installButton)

      await waitFor(() => {
        expect(pluginInstallState.invalidateBuiltInTools).toHaveBeenCalledTimes(1)
        expect(pluginInstallState.invalidateInstalledPluginList).toHaveBeenCalledTimes(1)
      })
    })

    it('should keep install actionable when batch marketplace metadata is unavailable', () => {
      pluginInstallState.fallbackManifest = {
        latest_package_identifier: 'langgenius/google:0.0.1@fallback',
      }
      renderAgentTools(reflectedUninstalledPluginDraft)

      expect(
        screen.getByRole('button', {
          name: 'google',
        }),
      ).toBeInTheDocument()
      expect(
        screen.getByText('https://marketplace.example.com/langgenius/google/icon'),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('button', {
          name: 'workflow.nodes.agent.pluginInstaller.install',
        }),
      ).toHaveAttribute('data-unique-identifier', 'langgenius/google:0.0.1@fallback')
    })

    it('should wait for the provider catalog before showing an uninstalled status', () => {
      toolProviderState.builtInTools = undefined
      renderAgentTools(reflectedUnauthorizedNoCredentialDraft)

      expect(
        screen.queryByText('plugin.detailPanel.toolSelector.uninstalledTitle'),
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', {
          name: 'tools.notAuthorized',
        }),
      ).not.toBeInTheDocument()
    })

    it('should hide unauthorized status when reflected provider tools do not require credentials', () => {
      toolProviderState.builtInTools = [duckDuckGoProvider]
      renderAgentTools(reflectedUnauthorizedNoCredentialDraft)

      expect(
        screen.getByRole('button', {
          name: 'DuckDuckGo',
        }),
      ).toBeInTheDocument()
      expect(screen.queryByText('tools.notAuthorized')).not.toBeInTheDocument()
    })

    it('should keep provider credential metadata display-only without dirtying the composer draft', () => {
      toolProviderState.builtInTools = [duckDuckGoProvider]
      const { store } = renderAgentToolsWithStore(reflectedUnauthorizedNoCredentialDraft)

      expect(
        screen.getByRole('button', {
          name: 'DuckDuckGo',
        }),
      ).toBeInTheDocument()
      expect(screen.queryByText('tools.notAuthorized')).not.toBeInTheDocument()
      expect(store.get(agentComposerDraftAtom).tools[0]).toMatchObject({
        credentialType: 'unauthorized',
        credentialVariant: 'unauthorized',
      })
      expect(store.get(isAgentComposerDirtyAtom)).toBe(false)
    })

    it('should open authorization actions for reflected OAuth provider tools', async () => {
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

      expect(
        screen.getByRole('button', {
          name: 'tools.notAuthorized',
        }),
      ).toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'plugin.auth.useOAuthAuth' }),
      ).not.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'tools.notAuthorized' }))

      expect(
        screen.getByRole('button', {
          name: 'plugin.auth.useOAuthAuth',
        }),
      ).toBeInTheDocument()
    })

    it('should bind an existing credential selected from the unauthorized status', async () => {
      const user = userEvent.setup()
      toolProviderState.builtInTools = [
        {
          ...googleProvider,
          allow_delete: true,
          is_team_authorization: false,
          team_credentials: {},
        },
      ]
      pluginAuthState.credentials = [
        {
          id: 'workspace-oauth',
          name: 'Workspace OAuth',
          provider: 'google',
          credential_type: CredentialTypeEnum.OAUTH2,
          is_default: true,
        },
      ]
      const { store } = renderAgentToolsWithStore(reflectedUnauthorizedOAuthCredentialTypeDraft)

      await user.click(screen.getByRole('button', { name: 'tools.notAuthorized' }))

      expect(store.get(agentComposerDraftAtom).tools[0]).toMatchObject({
        credentialType: 'unauthorized',
        credentialVariant: 'none',
      })

      await user.click(screen.getByText('Workspace OAuth'))

      expect(store.get(agentComposerDraftAtom).tools[0]).toMatchObject({
        credentialId: 'workspace-oauth',
        credentialType: 'oauth2',
        credentialVariant: 'authorized',
      })
    })

    it('should open provider tool settings with catalog icon and parameters', async () => {
      const user = userEvent.setup()
      toolProviderState.builtInTools = [duckDuckGoProvider]
      renderAgentTools()

      await user.click(
        screen.getByRole('button', {
          name: 'DuckDuckGo',
        }),
      )
      await user.click(
        screen.getByRole('button', {
          name: 'agentV2.agentDetail.configure.tools.editAction:{"name":"DuckDuckGo Search"}',
        }),
      )

      expect(screen.getByTestId('tool-icon')).toHaveTextContent(
        'https://example.com/duckduckgo.svg',
      )
      expect(screen.getByRole('form', { name: 'tool settings' })).toBeInTheDocument()
      expect(screen.getByText('Search Query')).toBeInTheDocument()
    })

    it('should close provider tool settings when the configured action leaves the draft', async () => {
      const user = userEvent.setup()
      toolProviderState.builtInTools = [duckDuckGoProvider]
      const { store } = renderAgentToolsWithStore(agentToolsDraft)

      await user.click(
        screen.getByRole('button', {
          name: 'DuckDuckGo',
        }),
      )
      await user.click(
        screen.getByRole('button', {
          name: 'agentV2.agentDetail.configure.tools.editAction:{"name":"DuckDuckGo Search"}',
        }),
      )

      expect(screen.getByRole('form', { name: 'tool settings' })).toBeInTheDocument()

      act(() => {
        store.set(agentComposerDraftAtom, {
          ...agentToolsDraft,
          tools: [],
        })
      })

      expect(screen.queryByRole('form', { name: 'tool settings' })).not.toBeInTheDocument()
    })
  })
})
