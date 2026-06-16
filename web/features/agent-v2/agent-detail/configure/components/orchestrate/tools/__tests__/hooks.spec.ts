import type { AgentProviderToolDefaultValue } from '../types'
import { addProviderTools } from '../hooks'

const noCredentialTool = {
  provider_id: 'duckduckgo',
  provider_type: 'builtin',
  provider_name: 'DuckDuckGo',
  provider_show_name: 'DuckDuckGo',
  tool_name: 'ddg_search',
  tool_label: 'DuckDuckGo Search',
  tool_description: 'Search the web.',
  title: 'DuckDuckGo Search',
  is_team_authorization: true,
  params: {},
  paramSchemas: [],
  allowDelete: false,
} satisfies AgentProviderToolDefaultValue

describe('addProviderTools', () => {
  it('should mark tools that do not need credentials as unauthorized', () => {
    const nextTools = addProviderTools([], [noCredentialTool])

    expect(nextTools).toEqual([
      expect.objectContaining({
        credentialId: undefined,
        credentialType: 'unauthorized',
        credentialVariant: 'none',
      }),
    ])
  })
})
