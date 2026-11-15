import { describe, expect, it } from 'vite-plus/test'
import { CollectionType } from '@/app/components/tools/types'
import { getProviderReference, matchesProviderReference } from '../provider-reference'

const mcpProvider = {
  id: '0b2bd1e4-3a7d-4a0b-9f2a-9b2d6f3c1e55',
  type: CollectionType.mcp,
  server_identifier: 'monday_mcp',
}
const builtInProvider = {
  id: 'langgenius/google/google',
  type: CollectionType.builtIn,
}

describe('getProviderReference', () => {
  it('uses the server identifier for MCP providers', () => {
    expect(getProviderReference(mcpProvider)).toBe('monday_mcp')
  })

  it('falls back to the id when an MCP provider has no server identifier', () => {
    expect(getProviderReference({ ...mcpProvider, server_identifier: undefined })).toBe(
      mcpProvider.id,
    )
  })

  it('uses the id for every other provider type', () => {
    expect(getProviderReference(builtInProvider)).toBe('langgenius/google/google')
  })
})

describe('matchesProviderReference', () => {
  it('matches an MCP provider by server identifier', () => {
    expect(matchesProviderReference(mcpProvider, 'monday_mcp')).toBe(true)
  })

  it('matches an MCP provider by its primary key for references written before the convention', () => {
    expect(matchesProviderReference(mcpProvider, mcpProvider.id)).toBe(true)
  })

  it('does not match an unrelated reference', () => {
    expect(matchesProviderReference(mcpProvider, 'other_mcp')).toBe(false)
  })

  it('does not match an empty reference', () => {
    expect(matchesProviderReference(mcpProvider, undefined)).toBe(false)
    expect(matchesProviderReference(mcpProvider, '')).toBe(false)
  })

  it('keeps the legacy built-in provider id shorthands working', () => {
    expect(matchesProviderReference(builtInProvider, 'google')).toBe(true)
    expect(
      matchesProviderReference(
        { id: 'langgenius/jina_tool/jina', type: CollectionType.builtIn },
        'jina',
      ),
    ).toBe(true)
  })
})
