import { describe, expect, it } from 'vitest'
import { CollectionType } from '@/app/components/tools/types'
import { AuthCategory, CredentialTypeEnum } from '../../types'
import { useGetApi } from '../use-get-api'

describe('useGetApi', () => {
  const provider = 'test-provider'

  describe('tool category', () => {
    it('returns correct API paths for tool category', () => {
      const api = useGetApi({ category: AuthCategory.tool, provider })
      expect(api.getCredentialInfo).toBe(
        `/workspaces/current/tool-provider/builtin/${provider}/credential/info`,
      )
      expect(api.setDefaultCredential).toBe(
        `/workspaces/current/tool-provider/builtin/${provider}/default-credential`,
      )
      expect(api.getCredentials).toBe(
        `/workspaces/current/tool-provider/builtin/${provider}/credentials`,
      )
      expect(api.addCredential).toBe(`/workspaces/current/tool-provider/builtin/${provider}/add`)
      expect(api.updateCredential).toBe(
        `/workspaces/current/tool-provider/builtin/${provider}/update`,
      )
      expect(api.deleteCredential).toBe(
        `/workspaces/current/tool-provider/builtin/${provider}/delete`,
      )
      expect(api.getOauthUrl).toBe(`/oauth/plugin/${provider}/tool/authorization-url`)
    })

    it('returns a function for getCredentialSchema', () => {
      const api = useGetApi({ category: AuthCategory.tool, provider })
      expect(typeof api.getCredentialSchema).toBe('function')
      const schemaUrl = api.getCredentialSchema('api-key' as never)
      expect(schemaUrl).toBe(
        `/workspaces/current/tool-provider/builtin/${provider}/credential/schema/api-key`,
      )
    })

    it('includes OAuth client endpoints', () => {
      const api = useGetApi({ category: AuthCategory.tool, provider })
      expect(api.getOauthClientSchema).toBe(
        `/workspaces/current/tool-provider/builtin/${provider}/oauth/client-schema`,
      )
      expect(api.setCustomOauthClient).toBe(
        `/workspaces/current/tool-provider/builtin/${provider}/oauth/custom-client`,
      )
    })

    // Regression for langgenius/dify#39169. Custom (api) tool providers do
    // not have plugin-auth routes — their credentials live on the
    // `tool_api_providers` row, not the plugin daemon. Hitting the builtin
    // route with an api-type provider id raises `PluginNotFoundError` on the
    // api side and surfaces as a 500 toast on every /agents/<id>/configure
    // page load.
    describe('providerType gating (#39169)', () => {
      it('returns builtin URLs when providerType is "builtin"', () => {
        const api = useGetApi({
          category: AuthCategory.tool,
          provider,
          providerType: CollectionType.builtIn,
        })
        expect(api.getCredentialInfo).toBe(
          `/workspaces/current/tool-provider/builtin/${provider}/credential/info`,
        )
        expect(api.getCredentials).toBe(
          `/workspaces/current/tool-provider/builtin/${provider}/credentials`,
        )
      })

      it('returns empty URLs when providerType is "api" (custom)', () => {
        const api = useGetApi({
          category: AuthCategory.tool,
          provider,
          providerType: CollectionType.custom,
        })
        expect(api.getCredentialInfo).toBe('')
        expect(api.setDefaultCredential).toBe('')
        expect(api.getCredentials).toBe('')
        expect(api.addCredential).toBe('')
        expect(api.updateCredential).toBe('')
        expect(api.deleteCredential).toBe('')
        expect(api.getCredentialSchema(CredentialTypeEnum.API_KEY)).toBe('')
        expect(api.getCredentialSchema(CredentialTypeEnum.OAUTH2)).toBe('')
        expect(api.getOauthUrl).toBe('')
        expect(api.getOauthClientSchema).toBe('')
        expect(api.setCustomOauthClient).toBe('')
        expect(api.getCustomOAuthClientValues).toBe('')
        expect(api.deleteCustomOAuthClient).toBe('')
      })

      it('returns empty URLs for any non-builtin providerType (mcp/workflow/model/...)', () => {
        const api = useGetApi({
          category: AuthCategory.tool,
          provider,
          providerType: 'mcp',
        })
        expect(api.getCredentialInfo).toBe('')
        expect(api.getCredentials).toBe('')
        // getCredentialSchema must be callable and return '' so the
        // credential-schema query stays disabled (useQuery({ enabled: !!url }))
        expect(api.getCredentialSchema(CredentialTypeEnum.API_KEY)).toBe('')
      })

      it('preserves the original builtin behavior when providerType is omitted (legacy callers)', () => {
        // The `providerType` field on `PluginPayload` was added together
        // with this gate. Call sites that haven't been updated yet
        // (e.g. legacy direct callers, tests) continue to receive the
        // builtin URLs because passing `providerType: undefined` is treated
        // the same as not passing it at all. This matches the pre-#39169
        // behavior so we don't regress unrelated call sites.
        const api = useGetApi({ category: AuthCategory.tool, provider })
        expect(api.getCredentialInfo).toBe(
          `/workspaces/current/tool-provider/builtin/${provider}/credential/info`,
        )
      })
    })
  })

  describe('datasource category', () => {
    it('returns correct API paths for datasource category', () => {
      const api = useGetApi({ category: AuthCategory.datasource, provider })
      expect(api.getCredentials).toBe(`/auth/plugin/datasource/${provider}`)
      expect(api.addCredential).toBe(`/auth/plugin/datasource/${provider}`)
      expect(api.updateCredential).toBe(`/auth/plugin/datasource/${provider}/update`)
      expect(api.deleteCredential).toBe(`/auth/plugin/datasource/${provider}/delete`)
      expect(api.setDefaultCredential).toBe(`/auth/plugin/datasource/${provider}/default`)
      expect(api.getOauthUrl).toBe(`/oauth/plugin/${provider}/datasource/get-authorization-url`)
    })

    it('returns empty string for getCredentialInfo', () => {
      const api = useGetApi({ category: AuthCategory.datasource, provider })
      expect(api.getCredentialInfo).toBe('')
    })

    it('returns a function for getCredentialSchema that returns empty string', () => {
      const api = useGetApi({ category: AuthCategory.datasource, provider })
      expect(api.getCredentialSchema(CredentialTypeEnum.API_KEY)).toBe('')
    })
  })

  describe('other categories', () => {
    it('returns empty strings as fallback for unsupported category', () => {
      const api = useGetApi({ category: AuthCategory.model, provider })
      expect(api.getCredentialInfo).toBe('')
      expect(api.setDefaultCredential).toBe('')
      expect(api.getCredentials).toBe('')
      expect(api.addCredential).toBe('')
      expect(api.updateCredential).toBe('')
      expect(api.deleteCredential).toBe('')
      expect(api.getOauthUrl).toBe('')
    })

    it('returns a function for getCredentialSchema that returns empty string', () => {
      const api = useGetApi({ category: AuthCategory.model, provider })
      expect(api.getCredentialSchema(CredentialTypeEnum.API_KEY)).toBe('')
    })
  })

  describe('default category', () => {
    it('defaults to tool category when category is not specified', () => {
      const api = useGetApi({ provider } as { category: AuthCategory; provider: string })
      expect(api.getCredentialInfo).toContain('tool-provider')
    })
  })
})
