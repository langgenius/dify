import type { ToolProviderApiEntityResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { ReactNode } from 'react'
import type { AgentProviderTool } from '@/features/agent-v2/agent-composer/form-state'
import { createStore, Provider } from 'jotai'
import { queryClientAtom } from 'jotai-tanstack-query'
import { defaultAgentSoulConfigFormState } from '@/features/agent-v2/agent-composer/form-state'
import { agentComposerDraftAtom } from '@/features/agent-v2/agent-composer/store'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createToolProviderFixture } from '@/test/console/tool-provider-fixture'
import { seedToolProviders } from '@/test/console/tool-providers'
import { AgentConfigApiContextProvider } from '../orchestrate/config-context'

export const duckDuckGoProvider = createToolProviderFixture({
  id: 'duckduckgo',
  name: 'DuckDuckGo',
  label: { en_US: 'DuckDuckGo' },
  is_team_authorization: true,
  tools: ['search', 'translate'].map((action) => ({
    name: `ddg_${action}`,
    author: 'Dify',
    label: { en_US: `DuckDuckGo ${action === 'search' ? 'Search' : 'Translate'}` },
    description: { en_US: action },
    parameters: [],
    labels: [],
    output_schema: {},
  })),
})
export const duckDuckGoTool: AgentProviderTool = {
  id: 'duckduckgo',
  name: 'DuckDuckGo',
  kind: 'provider',
  providerType: 'builtin',
  iconClassName: 'i-simple-icons-duckduckgo',
  credentialVariant: 'authorized',
  actions: [
    {
      id: 'duckduckgo-search',
      name: 'DuckDuckGo Search',
      toolName: 'ddg_search',
      description: 'Search the web.',
    },
  ],
}
export const mondayProvider = createToolProviderFixture({
  id: '1e9b5c9c-0a3f-4a2b-8f6f-2f7a0d3c4b51',
  server_identifier: 'monday_mcp',
  name: 'Monday MCP',
  label: { en_US: 'Monday MCP' },
  type: 'mcp',
  is_team_authorization: true,
  tools: [
    {
      name: 'list_boards',
      author: 'Dify',
      label: { en_US: 'List Boards' },
      description: { en_US: 'List boards' },
      parameters: [],
      labels: [],
      output_schema: {},
    },
  ],
})

export function createAgentPromptEnvironment({
  draft = {},
  builtInTools = [duckDuckGoProvider],
  mcpTools = [],
}: {
  draft?: Partial<typeof defaultAgentSoulConfigFormState>
  builtInTools?: ToolProviderApiEntityResponse[]
  mcpTools?: ToolProviderApiEntityResponse[]
} = {}) {
  const store = createStore()
  store.set(agentComposerDraftAtom, {
    ...defaultAgentSoulConfigFormState,
    skills: [{ id: 'playwright', name: 'Playwright', skillMdKey: 'skills/playwright/SKILL.md' }],
    tools: [duckDuckGoTool],
    ...draft,
  })
  const { wrapper: QueryProvider, queryClient } = createConsoleQueryWrapper({
    features: { enable_skill: true },
  })
  store.set(queryClientAtom, queryClient)
  seedToolProviders(queryClient, { builtInTools, mcpTools, customTools: [], workflowTools: [] })
  queryClient.setQueryData(
    consoleQuery.workspaces.current.agents.byAgentId.skills.get.queryKey({
      input: { params: { agent_id: 'agent-prompt' } },
    }),
    {
      agent_id: 'agent-prompt',
      data: [
        {
          id: 'library-skill-id',
          name: 'library-skill',
          display_name: 'Library Skill',
          description: 'Workspace library skill.',
          file_count: 1,
          icon: '',
          priority: 0,
          status: 'published',
          updated_at: 0,
        },
      ],
    },
  )
  const wrap = (ui: ReactNode) => (
    <QueryProvider>
      <Provider store={store}>
        <AgentConfigApiContextProvider value={{ agentId: 'agent-prompt' }}>
          {ui}
        </AgentConfigApiContextProvider>
      </Provider>
    </QueryProvider>
  )
  return { store, queryClient, wrap }
}
