import type { ToolWithProvider } from '@/app/components/workflow/types'
import { describe, expect, it } from 'vitest'
import { CollectionType } from '@/app/components/tools/types'
import { getProviderCredentialType } from '../tool-provider-catalog'

const baseCollection = {
  name: 'provider',
  author: 'Author',
  description: { en_US: 'Desc', zh_Hans: '描述' },
  icon: '',
  label: { en_US: 'Provider', zh_Hans: '提供方' },
  team_credentials: {},
  is_team_authorization: false,
  allow_delete: false,
  labels: [],
  meta: { version: '0.0.1' },
  tools: [],
} satisfies Omit<ToolWithProvider, 'id' | 'type'>

const builtInProvider = {
  ...baseCollection,
  id: 'builtin/org/provider',
  type: CollectionType.builtIn,
} satisfies ToolWithProvider

const mcpProvider = {
  ...baseCollection,
  id: 'mcp-server-id',
  type: CollectionType.mcp,
} satisfies ToolWithProvider

describe('getProviderCredentialType', () => {
  it('returns api-key for a builtIn provider that has stored team credentials', () => {
    const provider = { ...builtInProvider, team_credentials: { api_key: 'secret' } }

    expect(getProviderCredentialType(provider)).toBe('api-key')
  })

  it('returns oauth2 for a builtIn provider that supports delete and has no team credentials', () => {
    const provider = { ...builtInProvider, allow_delete: true }

    expect(getProviderCredentialType(provider)).toBe('oauth2')
  })

  it('does not classify an MCP provider with stored team credentials as api-key', () => {
    const provider = { ...mcpProvider, team_credentials: { server_token: 'secret' } }

    expect(getProviderCredentialType(provider)).toBeUndefined()
  })

  it('returns undefined for an MCP provider without team credentials', () => {
    expect(getProviderCredentialType(mcpProvider)).toBeUndefined()
  })

  it('returns undefined when no provider is given', () => {
    expect(getProviderCredentialType(undefined)).toBeUndefined()
  })
})
