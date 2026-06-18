import type { ToolWithProvider } from '@/app/components/workflow/types'
import type { AgentSoulConfigFormState } from '@/features/agent-v2/agent-composer/form-state'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CollectionType } from '@/app/components/tools/types'
import { defaultAgentSoulConfigFormState } from '@/features/agent-v2/agent-composer/form-state'
import { AgentComposerProvider } from '@/features/agent-v2/agent-composer/provider'
import { AgentOrchestrateReadOnlyContext } from '../../read-only-context'
import { AgentTools } from '../index'

const toolProviderState = vi.hoisted(() => ({
  builtInTools: [] as ToolWithProvider[],
}))

vi.mock('@/app/components/workflow/block-selector/tool-picker', () => ({
  ToolPickerContent: () => (
    <div>
      Mock tool picker
    </div>
  ),
}))

vi.mock('@/app/components/workflow/block-icon', () => ({
  default: ({ toolIcon }: { toolIcon?: string | { content: string, background: string } }) => (
    <span aria-hidden data-testid="tool-icon">
      {typeof toolIcon === 'string' ? toolIcon : toolIcon?.content}
    </span>
  ),
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/model-modal/Form', () => ({
  default: ({ formSchemas }: { formSchemas: Array<{ label?: Record<string, string>, variable?: string }> }) => (
    <div data-testid="tool-setting-form">
      {formSchemas.map(schema => (
        <div key={schema.variable}>{schema.label?.en_US}</div>
      ))}
    </div>
  ),
}))

vi.mock('@/service/use-tools', () => ({
  useAllBuiltInTools: () => ({ data: toolProviderState.builtInTools }),
  useAllCustomTools: () => ({ data: [] }),
  useAllWorkflowTools: () => ({ data: [] }),
  useAllMCPTools: () => ({ data: [] }),
}))

const agentToolsDraft = {
  ...defaultAgentSoulConfigFormState,
  tools: [
    {
      id: 'duckduckgo',
      kind: 'provider',
      name: 'DuckDuckGo',
      iconClassName: 'i-simple-icons-duckduckgo',
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

  return render(
    <QueryClientProvider client={queryClient}>
      <AgentComposerProvider initialDraft={initialDraft}>
        <AgentTools />
      </AgentComposerProvider>
    </QueryClientProvider>,
  )
}

function renderReadonlyAgentTools(initialDraft: AgentSoulConfigFormState = agentToolsDraft) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })

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
  })

  describe('User Interactions', () => {
    it('should remove a provider action when the remove button is clicked', async () => {
      const user = userEvent.setup()
      renderAgentTools()

      await user.click(screen.getByRole('button', {
        name: 'DuckDuckGo',
      }))

      await user.click(screen.getByRole('button', {
        name: 'agentV2.agentDetail.configure.tools.removeAction:{"name":"DuckDuckGo Image Search"}',
      }))

      expect(screen.queryByText('DuckDuckGo Image Search')).not.toBeInTheDocument()
      expect(screen.getByText('DuckDuckGo Search')).toBeInTheDocument()
      expect(screen.getByText('DuckDuckGo')).toBeInTheDocument()
    })

    it('should remove all provider tools from the provider more-actions menu', async () => {
      const user = userEvent.setup()
      renderAgentTools()

      await user.click(screen.getByRole('button', {
        name: 'agentV2.agentDetail.configure.tools.moreActions:{"name":"DuckDuckGo"}',
      }))
      await user.click(screen.getByRole('menuitem', {
        name: /agentV2\.agentDetail\.configure\.tools\.removeProvider/,
      }))

      expect(screen.queryByText('DuckDuckGo')).not.toBeInTheDocument()
      expect(screen.queryByText('DuckDuckGo Search')).not.toBeInTheDocument()
      expect(screen.getByText('Lark CLI')).toBeInTheDocument()
    })

    it('should keep the add trigger mounted while the tool picker is open', async () => {
      const user = userEvent.setup()
      renderAgentTools()

      await user.click(screen.getByRole('button', {
        name: 'agentV2.agentDetail.configure.tools.add',
      }))
      await user.click(screen.getByRole('button', {
        name: /agentV2\.agentDetail\.configure\.tools\.addMenu\.tool\.label/,
      }))

      expect(screen.getByText('Mock tool picker')).toBeInTheDocument()
      expect(screen.getByRole('button', {
        name: 'agentV2.agentDetail.configure.tools.add',
      })).toBeInTheDocument()
    })

    it('should hide add, edit, and remove actions when readonly', async () => {
      const user = userEvent.setup()
      renderReadonlyAgentTools()

      expect(screen.queryByRole('button', {
        name: 'agentV2.agentDetail.configure.tools.add',
      })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', {
        name: 'agentV2.agentDetail.configure.tools.moreActions:{"name":"DuckDuckGo"}',
      })).not.toBeInTheDocument()

      await user.click(screen.getByRole('button', {
        name: 'DuckDuckGo',
      }))

      expect(screen.queryByRole('button', {
        name: 'agentV2.agentDetail.configure.tools.editAction:{"name":"DuckDuckGo Search"}',
      })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', {
        name: 'agentV2.agentDetail.configure.tools.removeAction:{"name":"DuckDuckGo Image Search"}',
      })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', {
        name: 'agentV2.agentDetail.configure.tools.editAction:{"name":"Lark CLI"}',
      })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', {
        name: 'agentV2.agentDetail.configure.tools.removeAction:{"name":"Lark CLI"}',
      })).not.toBeInTheDocument()
    })
  })

  describe('Display Metadata', () => {
    it('should enrich reflected provider tools with provider icon and localized names', async () => {
      const user = userEvent.setup()
      toolProviderState.builtInTools = [googleProvider]
      renderAgentTools(reflectedAgentToolsDraft)

      expect(screen.getByRole('button', {
        name: 'Google Tools',
      })).toBeInTheDocument()
      expect(screen.getByText('https://example.com/google.svg')).toBeInTheDocument()

      await user.click(screen.getByRole('button', {
        name: 'Google Tools',
      }))

      expect(screen.getByText('Google Search')).toBeInTheDocument()
    })

    it('should hide unauthorized status when reflected provider tools do not require credentials', () => {
      toolProviderState.builtInTools = [duckDuckGoProvider]
      renderAgentTools(reflectedUnauthorizedNoCredentialDraft)

      expect(screen.getByRole('button', {
        name: 'DuckDuckGo',
      })).toBeInTheDocument()
      expect(screen.queryByText('tools.notAuthorized')).not.toBeInTheDocument()
    })

    it('should open provider tool settings with catalog icon and parameters', async () => {
      const user = userEvent.setup()
      toolProviderState.builtInTools = [duckDuckGoProvider]
      const { baseElement } = renderAgentTools()

      await user.click(screen.getByRole('button', {
        name: 'DuckDuckGo',
      }))
      await user.click(screen.getByRole('button', {
        name: 'agentV2.agentDetail.configure.tools.editAction:{"name":"DuckDuckGo Search"}',
      }))

      expect(baseElement.querySelector('[style*="duckduckgo.svg"]')).toBeInTheDocument()
      expect(screen.getByTestId('tool-setting-form')).toBeInTheDocument()
      expect(screen.getByText('Search Query')).toBeInTheDocument()
    })
  })
})
