import { describe, expect, it } from 'vitest'
import { AuthCategory, CredentialTypeEnum } from '../types'

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
