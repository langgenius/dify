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
  credentialRequired: false,
} satisfies AgentProviderToolDefaultValue

const unauthorizedCredentialTool = {
  ...noCredentialTool,
  provider_id: 'google',
  provider_name: 'google',
  provider_show_name: 'Google',
  tool_name: 'search',
  tool_label: 'Google Search',
  title: 'Google Search',
  is_team_authorization: false,
  credentialRequired: true,
} satisfies AgentProviderToolDefaultValue

describe('addProviderTools', () => {
  it('should not mark tools that do not need credentials as unauthorized', () => {
    const nextTools = addProviderTools([], [noCredentialTool])

    expect(nextTools).toEqual([
      expect.objectContaining({
        credentialId: undefined,
        credentialType: undefined,
        credentialVariant: 'none',
      }),
    ])
  })

  it('should mark credential-required tools without credentials as unauthorized', () => {
    const nextTools = addProviderTools([], [unauthorizedCredentialTool])

    expect(nextTools).toEqual([
      expect.objectContaining({
        credentialId: undefined,
        credentialType: 'unauthorized',
        credentialVariant: 'unauthorized',
      }),
    ])
  })
})
