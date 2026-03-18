import { describe, expect, it } from 'vitest'
import { AuthCategory, CredentialTypeEnum } from '../types'

vi.mock('../authorize/add-api-key-button', () => ({ default: () => null }))
vi.mock('../authorize/add-oauth-button', () => ({ default: () => null }))
vi.mock('../authorize/api-key-modal', () => ({ default: () => null }))
vi.mock('../authorized', () => ({ default: () => null }))
vi.mock('../authorized-in-data-source-node', () => ({ default: () => null }))
vi.mock('../authorized-in-node', () => ({ default: () => null }))
vi.mock('../plugin-auth', () => ({ default: () => null }))
vi.mock('../plugin-auth-in-agent', () => ({ default: () => null }))
vi.mock('../plugin-auth-in-datasource-node', () => ({ default: () => null }))
vi.mock('../hooks/use-plugin-auth', () => ({ usePluginAuth: () => ({}) }))
vi.mock('../hooks/use-plugin-auth-action', () => ({}))

describe('plugin-auth index exports', () => {
  it('should export all required components and hooks', async () => {
    const exports = await import('../index')

    expect(exports.AddApiKeyButton).toBeDefined()
    expect(exports.AddOAuthButton).toBeDefined()
    expect(exports.ApiKeyModal).toBeDefined()
    expect(exports.Authorized).toBeDefined()
    expect(exports.AuthorizedInDataSourceNode).toBeDefined()
    expect(exports.AuthorizedInNode).toBeDefined()
    expect(exports.PluginAuth).toBeDefined()
    expect(exports.PluginAuthInAgent).toBeDefined()
    expect(exports.PluginAuthInDataSourceNode).toBeDefined()
    expect(exports.usePluginAuth).toBeDefined()
  })

  it('should re-export AuthCategory enum with correct values', () => {
    expect(Object.values(AuthCategory)).toHaveLength(4)
    expect(AuthCategory.tool).toBe('tool')
    expect(AuthCategory.datasource).toBe('datasource')
    expect(AuthCategory.model).toBe('model')
    expect(AuthCategory.trigger).toBe('trigger')
  })

  it('should re-export CredentialTypeEnum with correct values', () => {
    expect(Object.values(CredentialTypeEnum)).toHaveLength(2)
    expect(CredentialTypeEnum.OAUTH2).toBe('oauth2')
    expect(CredentialTypeEnum.API_KEY).toBe('api-key')
  })
})
