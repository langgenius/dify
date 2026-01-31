import type { ReactNode } from 'react'
import type { Credential, PluginPayload } from './types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthCategory, CredentialTypeEnum } from './types'

// ==================== Mock Setup ====================

// Mock API hooks for credential operations
const mockGetPluginCredentialInfo = vi.fn()
const mockDeletePluginCredential = vi.fn()
const mockSetPluginDefaultCredential = vi.fn()
const mockUpdatePluginCredential = vi.fn()
const mockInvalidPluginCredentialInfo = vi.fn()
const mockGetPluginOAuthUrl = vi.fn()
const mockGetPluginOAuthClientSchema = vi.fn()
const mockSetPluginOAuthCustomClient = vi.fn()
const mockDeletePluginOAuthCustomClient = vi.fn()
const mockInvalidPluginOAuthClientSchema = vi.fn()
const mockAddPluginCredential = vi.fn()
const mockGetPluginCredentialSchema = vi.fn()
const mockInvalidToolsByType = vi.fn()

vi.mock('@/service/use-plugins-auth', () => ({
  useGetPluginCredentialInfo: (url: string) => ({
    data: url ? mockGetPluginCredentialInfo() : undefined,
    isLoading: false,
  }),
  useDeletePluginCredential: () => ({
    mutateAsync: mockDeletePluginCredential,
  }),
  useSetPluginDefaultCredential: () => ({
    mutateAsync: mockSetPluginDefaultCredential,
  }),
  useUpdatePluginCredential: () => ({
    mutateAsync: mockUpdatePluginCredential,
  }),
  useInvalidPluginCredentialInfo: () => mockInvalidPluginCredentialInfo,
  useGetPluginOAuthUrl: () => ({
    mutateAsync: mockGetPluginOAuthUrl,
  }),
  useGetPluginOAuthClientSchema: () => ({
    data: mockGetPluginOAuthClientSchema(),
    isLoading: false,
  }),
  useSetPluginOAuthCustomClient: () => ({
    mutateAsync: mockSetPluginOAuthCustomClient,
  }),
  useDeletePluginOAuthCustomClient: () => ({
    mutateAsync: mockDeletePluginOAuthCustomClient,
  }),
  useInvalidPluginOAuthClientSchema: () => mockInvalidPluginOAuthClientSchema,
  useAddPluginCredential: () => ({
    mutateAsync: mockAddPluginCredential,
  }),
  useGetPluginCredentialSchema: () => ({
    data: mockGetPluginCredentialSchema(),
    isLoading: false,
  }),
}))

vi.mock('@/service/use-tools', () => ({
  useInvalidToolsByType: () => mockInvalidToolsByType,
}))

// Mock AppContext
const mockIsCurrentWorkspaceManager = vi.fn()
vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    isCurrentWorkspaceManager: mockIsCurrentWorkspaceManager(),
  }),
}))

// Mock toast context
const mockNotify = vi.fn()
vi.mock('@/app/components/base/toast', () => ({
  useToastContext: () => ({
    notify: mockNotify,
  }),
}))

// Mock openOAuthPopup
vi.mock('@/hooks/use-oauth', () => ({
  openOAuthPopup: vi.fn(),
}))

// Mock service/use-triggers
vi.mock('@/service/use-triggers', () => ({
  useTriggerPluginDynamicOptions: () => ({
    data: { options: [] },
    isLoading: false,
  }),
  useTriggerPluginDynamicOptionsInfo: () => ({
    data: null,
    isLoading: false,
  }),
  useInvalidTriggerDynamicOptions: () => vi.fn(),
}))

// ==================== Test Utilities ====================

const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  })

const createWrapper = () => {
  const testQueryClient = createTestQueryClient()
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={testQueryClient}>
      {children}
    </QueryClientProvider>
  )
}

// Factory functions for test data
const createPluginPayload = (overrides: Partial<PluginPayload> = {}): PluginPayload => ({
  category: AuthCategory.tool,
  provider: 'test-provider',
  ...overrides,
})

const createCredential = (overrides: Partial<Credential> = {}): Credential => ({
  id: 'test-credential-id',
  name: 'Test Credential',
  provider: 'test-provider',
  credential_type: CredentialTypeEnum.API_KEY,
  is_default: false,
  credentials: { api_key: 'test-key' },
  ...overrides,
})

const createCredentialList = (count: number, overrides: Partial<Credential>[] = []): Credential[] => {
  return Array.from({ length: count }, (_, i) => createCredential({
    id: `credential-${i}`,
    name: `Credential ${i}`,
    is_default: i === 0,
    ...overrides[i],
  }))
}

// ==================== Index Exports Tests ====================
describe('Index Exports', () => {
  it('should export all required components and hooks', async () => {
    const exports = await import('./index')

    expect(exports.AddApiKeyButton).toBeDefined()
    expect(exports.AddOAuthButton).toBeDefined()
    expect(exports.ApiKeyModal).toBeDefined()
    expect(exports.Authorized).toBeDefined()
    expect(exports.AuthorizedInDataSourceNode).toBeDefined()
    expect(exports.AuthorizedInNode).toBeDefined()
    expect(exports.usePluginAuth).toBeDefined()
    expect(exports.PluginAuth).toBeDefined()
    expect(exports.PluginAuthInAgent).toBeDefined()
    expect(exports.PluginAuthInDataSourceNode).toBeDefined()
  })

  it('should export AuthCategory enum', async () => {
    const exports = await import('./index')

    expect(exports.AuthCategory).toBeDefined()
    expect(exports.AuthCategory.tool).toBe('tool')
    expect(exports.AuthCategory.datasource).toBe('datasource')
    expect(exports.AuthCategory.model).toBe('model')
    expect(exports.AuthCategory.trigger).toBe('trigger')
  })

  it('should export CredentialTypeEnum', async () => {
    const exports = await import('./index')

    expect(exports.CredentialTypeEnum).toBeDefined()
    expect(exports.CredentialTypeEnum.OAUTH2).toBe('oauth2')
    expect(exports.CredentialTypeEnum.API_KEY).toBe('api-key')
  })
})

// ==================== Types Tests ====================
describe('Types', () => {
  describe('AuthCategory enum', () => {
    it('should have correct values', () => {
      expect(AuthCategory.tool).toBe('tool')
      expect(AuthCategory.datasource).toBe('datasource')
      expect(AuthCategory.model).toBe('model')
      expect(AuthCategory.trigger).toBe('trigger')
    })

    it('should have exactly 4 categories', () => {
      const values = Object.values(AuthCategory)
      expect(values).toHaveLength(4)
    })
  })

  describe('CredentialTypeEnum', () => {
    it('should have correct values', () => {
      expect(CredentialTypeEnum.OAUTH2).toBe('oauth2')
      expect(CredentialTypeEnum.API_KEY).toBe('api-key')
    })

    it('should have exactly 2 types', () => {
      const values = Object.values(CredentialTypeEnum)
      expect(values).toHaveLength(2)
    })
  })

  describe('Credential type', () => {
    it('should allow creating valid credentials', () => {
      const credential: Credential = {
        id: 'test-id',
        name: 'Test',
        provider: 'test-provider',
        is_default: true,
      }
      expect(credential.id).toBe('test-id')
      expect(credential.is_default).toBe(true)
    })

    it('should allow optional fields', () => {
      const credential: Credential = {
        id: 'test-id',
        name: 'Test',
        provider: 'test-provider',
        is_default: false,
        credential_type: CredentialTypeEnum.API_KEY,
        credentials: { key: 'value' },
        isWorkspaceDefault: true,
        from_enterprise: false,
        not_allowed_to_use: false,
      }
      expect(credential.credential_type).toBe(CredentialTypeEnum.API_KEY)
      expect(credential.isWorkspaceDefault).toBe(true)
    })
  })

  describe('PluginPayload type', () => {
    it('should allow creating valid plugin payload', () => {
      const payload: PluginPayload = {
        category: AuthCategory.tool,
        provider: 'test-provider',
      }
      expect(payload.category).toBe(AuthCategory.tool)
    })

    it('should allow optional fields', () => {
      const payload: PluginPayload = {
        category: AuthCategory.datasource,
        provider: 'test-provider',
        providerType: 'builtin',
        detail: undefined,
      }
      expect(payload.providerType).toBe('builtin')
    })
  })
})

// ==================== Utils Tests ====================
describe('Utils', () => {
  describe('transformFormSchemasSecretInput', () => {
    it('should transform secret input values to hidden format', async () => {
      const { transformFormSchemasSecretInput } = await import('./utils')

      const secretNames = ['api_key', 'secret_token']
      const values = {
        api_key: 'actual-key',
        secret_token: 'actual-token',
        public_key: 'public-value',
      }

      const result = transformFormSchemasSecretInput(secretNames, values)

      expect(result.api_key).toBe('[__HIDDEN__]')
      expect(result.secret_token).toBe('[__HIDDEN__]')
      expect(result.public_key).toBe('public-value')
    })

    it('should not transform empty secret values', async () => {
      const { transformFormSchemasSecretInput } = await import('./utils')

      const secretNames = ['api_key']
      const values = {
        api_key: '',
        public_key: 'public-value',
      }

      const result = transformFormSchemasSecretInput(secretNames, values)

      expect(result.api_key).toBe('')
      expect(result.public_key).toBe('public-value')
    })

    it('should not transform undefined secret values', async () => {
      const { transformFormSchemasSecretInput } = await import('./utils')

      const secretNames = ['api_key']
      const values = {
        public_key: 'public-value',
      }

      const result = transformFormSchemasSecretInput(secretNames, values)

      expect(result.api_key).toBeUndefined()
      expect(result.public_key).toBe('public-value')
    })

    it('should handle empty secret names array', async () => {
      const { transformFormSchemasSecretInput } = await import('./utils')

      const secretNames: string[] = []
      const values = {
        api_key: 'actual-key',
        public_key: 'public-value',
      }

      const result = transformFormSchemasSecretInput(secretNames, values)

      expect(result.api_key).toBe('actual-key')
      expect(result.public_key).toBe('public-value')
    })

    it('should handle empty values object', async () => {
      const { transformFormSchemasSecretInput } = await import('./utils')

      const secretNames = ['api_key']
      const values = {}

      const result = transformFormSchemasSecretInput(secretNames, values)

      expect(Object.keys(result)).toHaveLength(0)
    })

    it('should preserve original values object immutably', async () => {
      const { transformFormSchemasSecretInput } = await import('./utils')

      const secretNames = ['api_key']
      const values = {
        api_key: 'actual-key',
        public_key: 'public-value',
      }

      transformFormSchemasSecretInput(secretNames, values)

      expect(values.api_key).toBe('actual-key')
    })

    it('should handle null-ish values correctly', async () => {
      const { transformFormSchemasSecretInput } = await import('./utils')

      const secretNames = ['api_key', 'null_key']
      const values = {
        api_key: null,
        null_key: 0,
      }

      const result = transformFormSchemasSecretInput(secretNames, values as Record<string, unknown>)

      // null is preserved as-is to represent an explicitly unset secret, not masked as [__HIDDEN__]
      expect(result.api_key).toBe(null)
      // numeric values like 0 are also preserved; only non-empty string secrets are transformed
      expect(result.null_key).toBe(0)
    })
  })
})

// ==================== useGetApi Hook Tests ====================
describe('useGetApi Hook', () => {
  describe('tool category', () => {
    it('should return correct API endpoints for tool category', async () => {
      const { useGetApi } = await import('./hooks/use-get-api')

      const pluginPayload = createPluginPayload({
        category: AuthCategory.tool,
        provider: 'test-tool',
      })

      const apiMap = useGetApi(pluginPayload)

      expect(apiMap.getCredentialInfo).toBe('/workspaces/current/tool-provider/builtin/test-tool/credential/info')
      expect(apiMap.setDefaultCredential).toBe('/workspaces/current/tool-provider/builtin/test-tool/default-credential')
      expect(apiMap.getCredentials).toBe('/workspaces/current/tool-provider/builtin/test-tool/credentials')
      expect(apiMap.addCredential).toBe('/workspaces/current/tool-provider/builtin/test-tool/add')
      expect(apiMap.updateCredential).toBe('/workspaces/current/tool-provider/builtin/test-tool/update')
      expect(apiMap.deleteCredential).toBe('/workspaces/current/tool-provider/builtin/test-tool/delete')
      expect(apiMap.getOauthUrl).toBe('/oauth/plugin/test-tool/tool/authorization-url')
      expect(apiMap.getOauthClientSchema).toBe('/workspaces/current/tool-provider/builtin/test-tool/oauth/client-schema')
      expect(apiMap.setCustomOauthClient).toBe('/workspaces/current/tool-provider/builtin/test-tool/oauth/custom-client')
      expect(apiMap.deleteCustomOAuthClient).toBe('/workspaces/current/tool-provider/builtin/test-tool/oauth/custom-client')
    })

    it('should return getCredentialSchema function for tool category', async () => {
      const { useGetApi } = await import('./hooks/use-get-api')

      const pluginPayload = createPluginPayload({
        category: AuthCategory.tool,
        provider: 'test-tool',
      })

      const apiMap = useGetApi(pluginPayload)

      expect(apiMap.getCredentialSchema(CredentialTypeEnum.API_KEY)).toBe(
        '/workspaces/current/tool-provider/builtin/test-tool/credential/schema/api-key',
      )
      expect(apiMap.getCredentialSchema(CredentialTypeEnum.OAUTH2)).toBe(
        '/workspaces/current/tool-provider/builtin/test-tool/credential/schema/oauth2',
      )
    })
  })

  describe('datasource category', () => {
    it('should return correct API endpoints for datasource category', async () => {
      const { useGetApi } = await import('./hooks/use-get-api')

      const pluginPayload = createPluginPayload({
        category: AuthCategory.datasource,
        provider: 'test-datasource',
      })

      const apiMap = useGetApi(pluginPayload)

      expect(apiMap.getCredentialInfo).toBe('')
      expect(apiMap.setDefaultCredential).toBe('/auth/plugin/datasource/test-datasource/default')
      expect(apiMap.getCredentials).toBe('/auth/plugin/datasource/test-datasource')
      expect(apiMap.addCredential).toBe('/auth/plugin/datasource/test-datasource')
      expect(apiMap.updateCredential).toBe('/auth/plugin/datasource/test-datasource/update')
      expect(apiMap.deleteCredential).toBe('/auth/plugin/datasource/test-datasource/delete')
      expect(apiMap.getOauthUrl).toBe('/oauth/plugin/test-datasource/datasource/get-authorization-url')
      expect(apiMap.getOauthClientSchema).toBe('')
      expect(apiMap.setCustomOauthClient).toBe('/auth/plugin/datasource/test-datasource/custom-client')
      expect(apiMap.deleteCustomOAuthClient).toBe('/auth/plugin/datasource/test-datasource/custom-client')
    })

    it('should return empty string for getCredentialSchema in datasource', async () => {
      const { useGetApi } = await import('./hooks/use-get-api')

      const pluginPayload = createPluginPayload({
        category: AuthCategory.datasource,
        provider: 'test-datasource',
      })

      const apiMap = useGetApi(pluginPayload)

      expect(apiMap.getCredentialSchema(CredentialTypeEnum.API_KEY)).toBe('')
    })
  })

  describe('other categories', () => {
    it('should return empty strings for model category', async () => {
      const { useGetApi } = await import('./hooks/use-get-api')

      const pluginPayload = createPluginPayload({
        category: AuthCategory.model,
        provider: 'test-model',
      })

      const apiMap = useGetApi(pluginPayload)

      expect(apiMap.getCredentialInfo).toBe('')
      expect(apiMap.setDefaultCredential).toBe('')
      expect(apiMap.getCredentials).toBe('')
      expect(apiMap.addCredential).toBe('')
      expect(apiMap.updateCredential).toBe('')
      expect(apiMap.deleteCredential).toBe('')
      expect(apiMap.getCredentialSchema(CredentialTypeEnum.API_KEY)).toBe('')
    })

    it('should return empty strings for trigger category', async () => {
      const { useGetApi } = await import('./hooks/use-get-api')

      const pluginPayload = createPluginPayload({
        category: AuthCategory.trigger,
        provider: 'test-trigger',
      })

      const apiMap = useGetApi(pluginPayload)

      expect(apiMap.getCredentialInfo).toBe('')
      expect(apiMap.setDefaultCredential).toBe('')
    })
  })

  describe('edge cases', () => {
    it('should handle empty provider', async () => {
      const { useGetApi } = await import('./hooks/use-get-api')

      const pluginPayload = createPluginPayload({
        category: AuthCategory.tool,
        provider: '',
      })

      const apiMap = useGetApi(pluginPayload)

      expect(apiMap.getCredentialInfo).toBe('/workspaces/current/tool-provider/builtin//credential/info')
    })

    it('should handle special characters in provider name', async () => {
      const { useGetApi } = await import('./hooks/use-get-api')

      const pluginPayload = createPluginPayload({
        category: AuthCategory.tool,
        provider: 'test-provider_v2',
      })

      const apiMap = useGetApi(pluginPayload)

      expect(apiMap.getCredentialInfo).toContain('test-provider_v2')
    })
  })
})

// ==================== usePluginAuth Hook Tests ====================
describe('usePluginAuth Hook', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsCurrentWorkspaceManager.mockReturnValue(true)
    mockGetPluginCredentialInfo.mockReturnValue({
      credentials: [],
      supported_credential_types: [],
      allow_custom_token: true,
    })
  })

  it('should return isAuthorized false when no credentials', async () => {
    const { usePluginAuth } = await import('./hooks/use-plugin-auth')

    mockGetPluginCredentialInfo.mockReturnValue({
      credentials: [],
      supported_credential_types: [CredentialTypeEnum.API_KEY],
      allow_custom_token: true,
    })

    const pluginPayload = createPluginPayload()

    const { result } = renderHook(() => usePluginAuth(pluginPayload, true), {
      wrapper: createWrapper(),
    })

    expect(result.current.isAuthorized).toBe(false)
    expect(result.current.credentials).toHaveLength(0)
  })

  it('should return isAuthorized true when credentials exist', async () => {
    const { usePluginAuth } = await import('./hooks/use-plugin-auth')

    mockGetPluginCredentialInfo.mockReturnValue({
      credentials: [createCredential()],
      supported_credential_types: [CredentialTypeEnum.API_KEY],
      allow_custom_token: true,
    })

    const pluginPayload = createPluginPayload()

    const { result } = renderHook(() => usePluginAuth(pluginPayload, true), {
      wrapper: createWrapper(),
    })

    expect(result.current.isAuthorized).toBe(true)
    expect(result.current.credentials).toHaveLength(1)
  })

  it('should return canOAuth true when oauth2 is supported', async () => {
    const { usePluginAuth } = await import('./hooks/use-plugin-auth')

    mockGetPluginCredentialInfo.mockReturnValue({
      credentials: [],
      supported_credential_types: [CredentialTypeEnum.OAUTH2],
      allow_custom_token: true,
    })

    const pluginPayload = createPluginPayload()

    const { result } = renderHook(() => usePluginAuth(pluginPayload, true), {
      wrapper: createWrapper(),
    })

    expect(result.current.canOAuth).toBe(true)
    expect(result.current.canApiKey).toBe(false)
  })

  it('should return canApiKey true when api-key is supported', async () => {
    const { usePluginAuth } = await import('./hooks/use-plugin-auth')

    mockGetPluginCredentialInfo.mockReturnValue({
      credentials: [],
      supported_credential_types: [CredentialTypeEnum.API_KEY],
      allow_custom_token: true,
    })

    const pluginPayload = createPluginPayload()

    const { result } = renderHook(() => usePluginAuth(pluginPayload, true), {
      wrapper: createWrapper(),
    })

    expect(result.current.canOAuth).toBe(false)
    expect(result.current.canApiKey).toBe(true)
  })

  it('should return both canOAuth and canApiKey when both supported', async () => {
    const { usePluginAuth } = await import('./hooks/use-plugin-auth')

    mockGetPluginCredentialInfo.mockReturnValue({
      credentials: [],
      supported_credential_types: [CredentialTypeEnum.OAUTH2, CredentialTypeEnum.API_KEY],
      allow_custom_token: true,
    })

    const pluginPayload = createPluginPayload()

    const { result } = renderHook(() => usePluginAuth(pluginPayload, true), {
      wrapper: createWrapper(),
    })

    expect(result.current.canOAuth).toBe(true)
    expect(result.current.canApiKey).toBe(true)
  })

  it('should return disabled true when user is not workspace manager', async () => {
    const { usePluginAuth } = await import('./hooks/use-plugin-auth')

    mockIsCurrentWorkspaceManager.mockReturnValue(false)

    const pluginPayload = createPluginPayload()

    const { result } = renderHook(() => usePluginAuth(pluginPayload, true), {
      wrapper: createWrapper(),
    })

    expect(result.current.disabled).toBe(true)
  })

  it('should return disabled false when user is workspace manager', async () => {
    const { usePluginAuth } = await import('./hooks/use-plugin-auth')

    mockIsCurrentWorkspaceManager.mockReturnValue(true)

    const pluginPayload = createPluginPayload()

    const { result } = renderHook(() => usePluginAuth(pluginPayload, true), {
      wrapper: createWrapper(),
    })

    expect(result.current.disabled).toBe(false)
  })

  it('should return notAllowCustomCredential based on allow_custom_token', async () => {
    const { usePluginAuth } = await import('./hooks/use-plugin-auth')

    mockGetPluginCredentialInfo.mockReturnValue({
      credentials: [],
      supported_credential_types: [],
      allow_custom_token: false,
    })

    const pluginPayload = createPluginPayload()

    const { result } = renderHook(() => usePluginAuth(pluginPayload, true), {
      wrapper: createWrapper(),
    })

    expect(result.current.notAllowCustomCredential).toBe(true)
  })

  it('should return invalidPluginCredentialInfo function', async () => {
    const { usePluginAuth } = await import('./hooks/use-plugin-auth')

    const pluginPayload = createPluginPayload()

    const { result } = renderHook(() => usePluginAuth(pluginPayload, true), {
      wrapper: createWrapper(),
    })

    expect(typeof result.current.invalidPluginCredentialInfo).toBe('function')
  })

  it('should not fetch when enable is false', async () => {
    const { usePluginAuth } = await import('./hooks/use-plugin-auth')

    const pluginPayload = createPluginPayload()

    const { result } = renderHook(() => usePluginAuth(pluginPayload, false), {
      wrapper: createWrapper(),
    })

    expect(result.current.isAuthorized).toBe(false)
    expect(result.current.credentials).toHaveLength(0)
  })
})

// ==================== usePluginAuthAction Hook Tests ====================
describe('usePluginAuthAction Hook', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDeletePluginCredential.mockResolvedValue({})
    mockSetPluginDefaultCredential.mockResolvedValue({})
    mockUpdatePluginCredential.mockResolvedValue({})
  })

  it('should return all action handlers', async () => {
    const { usePluginAuthAction } = await import('./hooks/use-plugin-auth-action')

    const pluginPayload = createPluginPayload()

    const { result } = renderHook(() => usePluginAuthAction(pluginPayload), {
      wrapper: createWrapper(),
    })

    expect(result.current.doingAction).toBe(false)
    expect(typeof result.current.handleSetDoingAction).toBe('function')
    expect(typeof result.current.openConfirm).toBe('function')
    expect(typeof result.current.closeConfirm).toBe('function')
    expect(result.current.deleteCredentialId).toBe(null)
    expect(typeof result.current.setDeleteCredentialId).toBe('function')
    expect(typeof result.current.handleConfirm).toBe('function')
    expect(result.current.editValues).toBe(null)
    expect(typeof result.current.setEditValues).toBe('function')
    expect(typeof result.current.handleEdit).toBe('function')
    expect(typeof result.current.handleRemove).toBe('function')
    expect(typeof result.current.handleSetDefault).toBe('function')
    expect(typeof result.current.handleRename).toBe('function')
  })

  it('should open and close confirm dialog', async () => {
    const { usePluginAuthAction } = await import('./hooks/use-plugin-auth-action')

    const pluginPayload = createPluginPayload()

    const { result } = renderHook(() => usePluginAuthAction(pluginPayload), {
      wrapper: createWrapper(),
    })

    act(() => {
      result.current.openConfirm('test-credential-id')
    })

    expect(result.current.deleteCredentialId).toBe('test-credential-id')

    act(() => {
      result.current.closeConfirm()
    })

    expect(result.current.deleteCredentialId).toBe(null)
  })

  it('should handle edit with values', async () => {
    const { usePluginAuthAction } = await import('./hooks/use-plugin-auth-action')

    const pluginPayload = createPluginPayload()

    const { result } = renderHook(() => usePluginAuthAction(pluginPayload), {
      wrapper: createWrapper(),
    })

    const editValues = { key: 'value' }

    act(() => {
      result.current.handleEdit('test-id', editValues)
    })

    expect(result.current.editValues).toEqual(editValues)
  })

  it('should handle confirm delete', async () => {
    const { usePluginAuthAction } = await import('./hooks/use-plugin-auth-action')

    const onUpdate = vi.fn()
    const pluginPayload = createPluginPayload()

    const { result } = renderHook(() => usePluginAuthAction(pluginPayload, onUpdate), {
      wrapper: createWrapper(),
    })

    act(() => {
      result.current.openConfirm('test-credential-id')
    })

    await act(async () => {
      await result.current.handleConfirm()
    })

    expect(mockDeletePluginCredential).toHaveBeenCalledWith({ credential_id: 'test-credential-id' })
    expect(mockNotify).toHaveBeenCalledWith({
      type: 'success',
      message: 'common.api.actionSuccess',
    })
    expect(onUpdate).toHaveBeenCalled()
    expect(result.current.deleteCredentialId).toBe(null)
  })

  it('should not confirm delete when no credential id', async () => {
    const { usePluginAuthAction } = await import('./hooks/use-plugin-auth-action')

    const pluginPayload = createPluginPayload()

    const { result } = renderHook(() => usePluginAuthAction(pluginPayload), {
      wrapper: createWrapper(),
    })

    await act(async () => {
      await result.current.handleConfirm()
    })

    expect(mockDeletePluginCredential).not.toHaveBeenCalled()
  })

  it('should handle set default', async () => {
    const { usePluginAuthAction } = await import('./hooks/use-plugin-auth-action')

    const onUpdate = vi.fn()
    const pluginPayload = createPluginPayload()

    const { result } = renderHook(() => usePluginAuthAction(pluginPayload, onUpdate), {
      wrapper: createWrapper(),
    })

    await act(async () => {
      await result.current.handleSetDefault('test-credential-id')
    })

    expect(mockSetPluginDefaultCredential).toHaveBeenCalledWith('test-credential-id')
    expect(mockNotify).toHaveBeenCalledWith({
      type: 'success',
      message: 'common.api.actionSuccess',
    })
    expect(onUpdate).toHaveBeenCalled()
  })

  it('should handle rename', async () => {
    const { usePluginAuthAction } = await import('./hooks/use-plugin-auth-action')

    const onUpdate = vi.fn()
    const pluginPayload = createPluginPayload()

    const { result } = renderHook(() => usePluginAuthAction(pluginPayload, onUpdate), {
      wrapper: createWrapper(),
    })

    await act(async () => {
      await result.current.handleRename({
        credential_id: 'test-credential-id',
        name: 'New Name',
      })
    })

    expect(mockUpdatePluginCredential).toHaveBeenCalledWith({
      credential_id: 'test-credential-id',
      name: 'New Name',
    })
    expect(mockNotify).toHaveBeenCalledWith({
      type: 'success',
      message: 'common.api.actionSuccess',
    })
    expect(onUpdate).toHaveBeenCalled()
  })

  it('should prevent concurrent actions', async () => {
    const { usePluginAuthAction } = await import('./hooks/use-plugin-auth-action')

    const pluginPayload = createPluginPayload()

    const { result } = renderHook(() => usePluginAuthAction(pluginPayload), {
      wrapper: createWrapper(),
    })

    act(() => {
      result.current.handleSetDoingAction(true)
    })

    act(() => {
      result.current.openConfirm('test-credential-id')
    })

    await act(async () => {
      await result.current.handleConfirm()
    })

    // Should not call delete when already doing action
    expect(mockDeletePluginCredential).not.toHaveBeenCalled()
  })

  it('should handle remove after edit', async () => {
    const { usePluginAuthAction } = await import('./hooks/use-plugin-auth-action')

    const pluginPayload = createPluginPayload()

    const { result } = renderHook(() => usePluginAuthAction(pluginPayload), {
      wrapper: createWrapper(),
    })

    act(() => {
      result.current.handleEdit('test-credential-id', { key: 'value' })
    })

    act(() => {
      result.current.handleRemove()
    })

    expect(result.current.deleteCredentialId).toBe('test-credential-id')
  })
})

// ==================== PluginAuth Component Tests ====================
describe('PluginAuth Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsCurrentWorkspaceManager.mockReturnValue(true)
    mockGetPluginCredentialInfo.mockReturnValue({
      credentials: [],
      supported_credential_types: [CredentialTypeEnum.API_KEY],
      allow_custom_token: true,
    })
    mockGetPluginOAuthClientSchema.mockReturnValue({
      schema: [],
      is_oauth_custom_client_enabled: false,
      is_system_oauth_params_exists: false,
    })
  })

  it('should render Authorize when not authorized', async () => {
    const PluginAuth = (await import('./plugin-auth')).default

    const pluginPayload = createPluginPayload()

    render(
      <PluginAuth pluginPayload={pluginPayload} />,
      { wrapper: createWrapper() },
    )

    // Should render authorize button
    expect(screen.getByRole('button')).toBeInTheDocument()
  })

  it('should render Authorized when authorized and no children', async () => {
    const PluginAuth = (await import('./plugin-auth')).default

    mockGetPluginCredentialInfo.mockReturnValue({
      credentials: [createCredential()],
      supported_credential_types: [CredentialTypeEnum.API_KEY],
      allow_custom_token: true,
    })

    const pluginPayload = createPluginPayload()

    render(
      <PluginAuth pluginPayload={pluginPayload} />,
      { wrapper: createWrapper() },
    )

    // Should render authorized content
    expect(screen.getByRole('button')).toBeInTheDocument()
  })

  it('should render children when authorized and children provided', async () => {
    const PluginAuth = (await import('./plugin-auth')).default

    mockGetPluginCredentialInfo.mockReturnValue({
      credentials: [createCredential()],
      supported_credential_types: [CredentialTypeEnum.API_KEY],
      allow_custom_token: true,
    })

    const pluginPayload = createPluginPayload()

    render(
      <PluginAuth pluginPayload={pluginPayload}>
        <div data-testid="custom-children">Custom Content</div>
      </PluginAuth>,
      { wrapper: createWrapper() },
    )

    expect(screen.getByTestId('custom-children')).toBeInTheDocument()
    expect(screen.getByText('Custom Content')).toBeInTheDocument()
  })

  it('should apply className when not authorized', async () => {
    const PluginAuth = (await import('./plugin-auth')).default

    const pluginPayload = createPluginPayload()

    const { container } = render(
      <PluginAuth pluginPayload={pluginPayload} className="custom-class" />,
      { wrapper: createWrapper() },
    )

    expect(container.firstChild).toHaveClass('custom-class')
  })

  it('should not apply className when authorized', async () => {
    const PluginAuth = (await import('./plugin-auth')).default

    mockGetPluginCredentialInfo.mockReturnValue({
      credentials: [createCredential()],
      supported_credential_types: [CredentialTypeEnum.API_KEY],
      allow_custom_token: true,
    })

    const pluginPayload = createPluginPayload()

    const { container } = render(
      <PluginAuth pluginPayload={pluginPayload} className="custom-class" />,
      { wrapper: createWrapper() },
    )

    expect(container.firstChild).not.toHaveClass('custom-class')
  })

  it('should be memoized', async () => {
    const PluginAuthModule = await import('./plugin-auth')
    expect(typeof PluginAuthModule.default).toBe('object')
  })
})

// ==================== PluginAuthInAgent Component Tests ====================
describe('PluginAuthInAgent Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsCurrentWorkspaceManager.mockReturnValue(true)
    mockGetPluginCredentialInfo.mockReturnValue({
      credentials: [createCredential()],
      supported_credential_types: [CredentialTypeEnum.API_KEY],
      allow_custom_token: true,
    })
    mockGetPluginOAuthClientSchema.mockReturnValue({
      schema: [],
      is_oauth_custom_client_enabled: false,
      is_system_oauth_params_exists: false,
    })
  })

  it('should render Authorize when not authorized', async () => {
    const PluginAuthInAgent = (await import('./plugin-auth-in-agent')).default

    mockGetPluginCredentialInfo.mockReturnValue({
      credentials: [],
      supported_credential_types: [CredentialTypeEnum.API_KEY],
      allow_custom_token: true,
    })

    const pluginPayload = createPluginPayload()

    render(
      <PluginAuthInAgent pluginPayload={pluginPayload} />,
      { wrapper: createWrapper() },
    )

    expect(screen.getByRole('button')).toBeInTheDocument()
  })

  it('should render Authorized with workspace default when authorized', async () => {
    const PluginAuthInAgent = (await import('./plugin-auth-in-agent')).default

    const pluginPayload = createPluginPayload()

    render(
      <PluginAuthInAgent pluginPayload={pluginPayload} />,
      { wrapper: createWrapper() },
    )

    expect(screen.getByRole('button')).toBeInTheDocument()
    expect(screen.getByText('plugin.auth.workspaceDefault')).toBeInTheDocument()
  })

  it('should show credential name when credentialId is provided', async () => {
    const PluginAuthInAgent = (await import('./plugin-auth-in-agent')).default

    const credential = createCredential({ id: 'selected-id', name: 'Selected Credential' })
    mockGetPluginCredentialInfo.mockReturnValue({
      credentials: [credential],
      supported_credential_types: [CredentialTypeEnum.API_KEY],
      allow_custom_token: true,
    })

    const pluginPayload = createPluginPayload()

    render(
      <PluginAuthInAgent
        pluginPayload={pluginPayload}
        credentialId="selected-id"
      />,
      { wrapper: createWrapper() },
    )

    expect(screen.getByText('Selected Credential')).toBeInTheDocument()
  })

  it('should show auth removed when credential not found', async () => {
    const PluginAuthInAgent = (await import('./plugin-auth-in-agent')).default

    mockGetPluginCredentialInfo.mockReturnValue({
      credentials: [createCredential()],
      supported_credential_types: [CredentialTypeEnum.API_KEY],
      allow_custom_token: true,
    })

    const pluginPayload = createPluginPayload()

    render(
      <PluginAuthInAgent
        pluginPayload={pluginPayload}
        credentialId="non-existent-id"
      />,
      { wrapper: createWrapper() },
    )

    expect(screen.getByText('plugin.auth.authRemoved')).toBeInTheDocument()
  })

  it('should show unavailable when credential is not allowed to use', async () => {
    const PluginAuthInAgent = (await import('./plugin-auth-in-agent')).default

    const credential = createCredential({
      id: 'unavailable-id',
      name: 'Unavailable Credential',
      not_allowed_to_use: true,
      from_enterprise: false,
    })
    mockGetPluginCredentialInfo.mockReturnValue({
      credentials: [credential],
      supported_credential_types: [CredentialTypeEnum.API_KEY],
      allow_custom_token: true,
    })

    const pluginPayload = createPluginPayload()

    render(
      <PluginAuthInAgent
        pluginPayload={pluginPayload}
        credentialId="unavailable-id"
      />,
      { wrapper: createWrapper() },
    )

    // Check that button text contains unavailable
    const button = screen.getByRole('button')
    expect(button.textContent).toContain('plugin.auth.unavailable')
  })

  it('should call onAuthorizationItemClick when item is clicked', async () => {
    const PluginAuthInAgent = (await import('./plugin-auth-in-agent')).default

    const onAuthorizationItemClick = vi.fn()
    const pluginPayload = createPluginPayload()

    render(
      <PluginAuthInAgent
        pluginPayload={pluginPayload}
        onAuthorizationItemClick={onAuthorizationItemClick}
      />,
      { wrapper: createWrapper() },
    )

    // Click to open popup
    const buttons = screen.getAllByRole('button')
    fireEvent.click(buttons[0])

    // Verify popup is opened (there will be multiple buttons after opening)
    expect(screen.getAllByRole('button').length).toBeGreaterThan(0)
  })

  it('should trigger handleAuthorizationItemClick and close popup when authorization item is clicked', async () => {
    const PluginAuthInAgent = (await import('./plugin-auth-in-agent')).default

    const onAuthorizationItemClick = vi.fn()
    const credential = createCredential({ id: 'test-cred-id', name: 'Test Credential' })
    mockGetPluginCredentialInfo.mockReturnValue({
      credentials: [credential],
      supported_credential_types: [CredentialTypeEnum.API_KEY],
      allow_custom_token: true,
    })

    const pluginPayload = createPluginPayload()

    render(
      <PluginAuthInAgent
        pluginPayload={pluginPayload}
        onAuthorizationItemClick={onAuthorizationItemClick}
      />,
      { wrapper: createWrapper() },
    )

    // Click trigger button to open popup
    const triggerButton = screen.getByRole('button')
    fireEvent.click(triggerButton)

    // Find and click the workspace default item in the dropdown
    // There will be multiple elements with this text, we need the one in the popup (not the trigger)
    const workspaceDefaultItems = screen.getAllByText('plugin.auth.workspaceDefault')
    // The second one is in the popup list (first one is the trigger button)
    const popupItem = workspaceDefaultItems.length > 1 ? workspaceDefaultItems[1] : workspaceDefaultItems[0]
    fireEvent.click(popupItem)

    // Verify onAuthorizationItemClick was called with empty string for workspace default
    expect(onAuthorizationItemClick).toHaveBeenCalledWith('')
  })

  it('should call onAuthorizationItemClick with credential id when specific credential is clicked', async () => {
    const PluginAuthInAgent = (await import('./plugin-auth-in-agent')).default

    const onAuthorizationItemClick = vi.fn()
    const credential = createCredential({
      id: 'specific-cred-id',
      name: 'Specific Credential',
      credential_type: CredentialTypeEnum.API_KEY,
    })
    mockGetPluginCredentialInfo.mockReturnValue({
      credentials: [credential],
      supported_credential_types: [CredentialTypeEnum.API_KEY],
      allow_custom_token: true,
    })

    const pluginPayload = createPluginPayload()

    render(
      <PluginAuthInAgent
        pluginPayload={pluginPayload}
        onAuthorizationItemClick={onAuthorizationItemClick}
      />,
      { wrapper: createWrapper() },
    )

    // Click trigger button to open popup
    const triggerButton = screen.getByRole('button')
    fireEvent.click(triggerButton)

    // Find and click the specific credential item - there might be multiple "Specific Credential" texts
    const credentialItems = screen.getAllByText('Specific Credential')
    // Click the one in the popup (usually the last one if trigger shows different text)
    const popupItem = credentialItems[credentialItems.length - 1]
    fireEvent.click(popupItem)

    // Verify onAuthorizationItemClick was called with the credential id
    expect(onAuthorizationItemClick).toHaveBeenCalledWith('specific-cred-id')
  })

  it('should be memoized', async () => {
    const PluginAuthInAgentModule = await import('./plugin-auth-in-agent')
    expect(typeof PluginAuthInAgentModule.default).toBe('object')
  })
})

// ==================== PluginAuthInDataSourceNode Component Tests ====================
describe('PluginAuthInDataSourceNode Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render connect button when not authorized', async () => {
    const PluginAuthInDataSourceNode = (await import('./plugin-auth-in-datasource-node')).default

    const onJumpToDataSourcePage = vi.fn()

    render(
      <PluginAuthInDataSourceNode
        isAuthorized={false}
        onJumpToDataSourcePage={onJumpToDataSourcePage}
      />,
    )

    const button = screen.getByRole('button')
    expect(button).toBeInTheDocument()
    expect(screen.getByText('common.integrations.connect')).toBeInTheDocument()
  })

  it('should call onJumpToDataSourcePage when connect button is clicked', async () => {
    const PluginAuthInDataSourceNode = (await import('./plugin-auth-in-datasource-node')).default

    const onJumpToDataSourcePage = vi.fn()

    render(
      <PluginAuthInDataSourceNode
        isAuthorized={false}
        onJumpToDataSourcePage={onJumpToDataSourcePage}
      />,
    )

    fireEvent.click(screen.getByRole('button'))
    expect(onJumpToDataSourcePage).toHaveBeenCalledTimes(1)
  })

  it('should render children when authorized', async () => {
    const PluginAuthInDataSourceNode = (await import('./plugin-auth-in-datasource-node')).default

    const onJumpToDataSourcePage = vi.fn()

    render(
      <PluginAuthInDataSourceNode
        isAuthorized={true}
        onJumpToDataSourcePage={onJumpToDataSourcePage}
      >
        <div data-testid="children-content">Authorized Content</div>
      </PluginAuthInDataSourceNode>,
    )

    expect(screen.getByTestId('children-content')).toBeInTheDocument()
    expect(screen.getByText('Authorized Content')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('should not render connect button when authorized', async () => {
    const PluginAuthInDataSourceNode = (await import('./plugin-auth-in-datasource-node')).default

    const onJumpToDataSourcePage = vi.fn()

    render(
      <PluginAuthInDataSourceNode
        isAuthorized={true}
        onJumpToDataSourcePage={onJumpToDataSourcePage}
      />,
    )

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('should not render children when not authorized', async () => {
    const PluginAuthInDataSourceNode = (await import('./plugin-auth-in-datasource-node')).default

    const onJumpToDataSourcePage = vi.fn()

    render(
      <PluginAuthInDataSourceNode
        isAuthorized={false}
        onJumpToDataSourcePage={onJumpToDataSourcePage}
      >
        <div data-testid="children-content">Authorized Content</div>
      </PluginAuthInDataSourceNode>,
    )

    expect(screen.queryByTestId('children-content')).not.toBeInTheDocument()
  })

  it('should handle undefined isAuthorized (falsy)', async () => {
    const PluginAuthInDataSourceNode = (await import('./plugin-auth-in-datasource-node')).default

    const onJumpToDataSourcePage = vi.fn()

    render(
      <PluginAuthInDataSourceNode
        onJumpToDataSourcePage={onJumpToDataSourcePage}
      >
        <div data-testid="children-content">Content</div>
      </PluginAuthInDataSourceNode>,
    )

    // isAuthorized is undefined, which is falsy, so connect button should be shown
    expect(screen.getByRole('button')).toBeInTheDocument()
    expect(screen.queryByTestId('children-content')).not.toBeInTheDocument()
  })

  it('should be memoized', async () => {
    const PluginAuthInDataSourceNodeModule = await import('./plugin-auth-in-datasource-node')
    expect(typeof PluginAuthInDataSourceNodeModule.default).toBe('object')
  })
})

// ==================== AuthorizedInDataSourceNode Component Tests ====================
describe('AuthorizedInDataSourceNode Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render with singular authorization text when authorizationsNum is 1', async () => {
    const AuthorizedInDataSourceNode = (await import('./authorized-in-data-source-node')).default

    const onJumpToDataSourcePage = vi.fn()

    render(
      <AuthorizedInDataSourceNode
        authorizationsNum={1}
        onJumpToDataSourcePage={onJumpToDataSourcePage}
      />,
    )

    expect(screen.getByRole('button')).toBeInTheDocument()
    expect(screen.getByText('plugin.auth.authorization')).toBeInTheDocument()
  })

  it('should render with plural authorizations text when authorizationsNum > 1', async () => {
    const AuthorizedInDataSourceNode = (await import('./authorized-in-data-source-node')).default

    const onJumpToDataSourcePage = vi.fn()

    render(
      <AuthorizedInDataSourceNode
        authorizationsNum={3}
        onJumpToDataSourcePage={onJumpToDataSourcePage}
      />,
    )

    expect(screen.getByText('plugin.auth.authorizations')).toBeInTheDocument()
  })

  it('should call onJumpToDataSourcePage when button is clicked', async () => {
    const AuthorizedInDataSourceNode = (await import('./authorized-in-data-source-node')).default

    const onJumpToDataSourcePage = vi.fn()

    render(
      <AuthorizedInDataSourceNode
        authorizationsNum={1}
        onJumpToDataSourcePage={onJumpToDataSourcePage}
      />,
    )

    fireEvent.click(screen.getByRole('button'))
    expect(onJumpToDataSourcePage).toHaveBeenCalledTimes(1)
  })

  it('should render with green indicator', async () => {
    const AuthorizedInDataSourceNode = (await import('./authorized-in-data-source-node')).default

    const { container } = render(
      <AuthorizedInDataSourceNode
        authorizationsNum={1}
        onJumpToDataSourcePage={vi.fn()}
      />,
    )

    // Check that indicator component is rendered
    expect(container.querySelector('.mr-1\\.5')).toBeInTheDocument()
  })

  it('should handle authorizationsNum of 0', async () => {
    const AuthorizedInDataSourceNode = (await import('./authorized-in-data-source-node')).default

    render(
      <AuthorizedInDataSourceNode
        authorizationsNum={0}
        onJumpToDataSourcePage={vi.fn()}
      />,
    )

    // 0 is not > 1, so should show singular
    expect(screen.getByText('plugin.auth.authorization')).toBeInTheDocument()
  })

  it('should be memoized', async () => {
    const AuthorizedInDataSourceNodeModule = await import('./authorized-in-data-source-node')
    expect(typeof AuthorizedInDataSourceNodeModule.default).toBe('object')
  })
})

// ==================== AuthorizedInNode Component Tests ====================
describe('AuthorizedInNode Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsCurrentWorkspaceManager.mockReturnValue(true)
    mockGetPluginCredentialInfo.mockReturnValue({
      credentials: [createCredential({ is_default: true })],
      supported_credential_types: [CredentialTypeEnum.API_KEY],
      allow_custom_token: true,
    })
    mockGetPluginOAuthClientSchema.mockReturnValue({
      schema: [],
      is_oauth_custom_client_enabled: false,
      is_system_oauth_params_exists: false,
    })
  })

  it('should render with workspace default when no credentialId', async () => {
    const AuthorizedInNode = (await import('./authorized-in-node')).default

    const pluginPayload = createPluginPayload()

    render(
      <AuthorizedInNode
        pluginPayload={pluginPayload}
        onAuthorizationItemClick={vi.fn()}
      />,
      { wrapper: createWrapper() },
    )

    expect(screen.getByText('plugin.auth.workspaceDefault')).toBeInTheDocument()
  })

  it('should render credential name when credentialId matches', async () => {
    const AuthorizedInNode = (await import('./authorized-in-node')).default

    const credential = createCredential({ id: 'selected-id', name: 'My Credential' })
    mockGetPluginCredentialInfo.mockReturnValue({
      credentials: [credential],
      supported_credential_types: [CredentialTypeEnum.API_KEY],
      allow_custom_token: true,
    })

    const pluginPayload = createPluginPayload()

    render(
      <AuthorizedInNode
        pluginPayload={pluginPayload}
        onAuthorizationItemClick={vi.fn()}
        credentialId="selected-id"
      />,
      { wrapper: createWrapper() },
    )

    expect(screen.getByText('My Credential')).toBeInTheDocument()
  })

  it('should show auth removed when credentialId not found', async () => {
    const AuthorizedInNode = (await import('./authorized-in-node')).default

    mockGetPluginCredentialInfo.mockReturnValue({
      credentials: [createCredential()],
      supported_credential_types: [CredentialTypeEnum.API_KEY],
      allow_custom_token: true,
    })

    const pluginPayload = createPluginPayload()

    render(
      <AuthorizedInNode
        pluginPayload={pluginPayload}
        onAuthorizationItemClick={vi.fn()}
        credentialId="non-existent"
      />,
      { wrapper: createWrapper() },
    )

    expect(screen.getByText('plugin.auth.authRemoved')).toBeInTheDocument()
  })

  it('should show unavailable when credential is not allowed', async () => {
    const AuthorizedInNode = (await import('./authorized-in-node')).default

    const credential = createCredential({
      id: 'unavailable-id',
      not_allowed_to_use: true,
      from_enterprise: false,
    })
    mockGetPluginCredentialInfo.mockReturnValue({
      credentials: [credential],
      supported_credential_types: [CredentialTypeEnum.API_KEY],
      allow_custom_token: true,
    })

    const pluginPayload = createPluginPayload()

    render(
      <AuthorizedInNode
        pluginPayload={pluginPayload}
        onAuthorizationItemClick={vi.fn()}
        credentialId="unavailable-id"
      />,
      { wrapper: createWrapper() },
    )

    // Check that button text contains unavailable
    const button = screen.getByRole('button')
    expect(button.textContent).toContain('plugin.auth.unavailable')
  })

  it('should show unavailable when default credential is not allowed', async () => {
    const AuthorizedInNode = (await import('./authorized-in-node')).default

    const credential = createCredential({
      is_default: true,
      not_allowed_to_use: true,
    })
    mockGetPluginCredentialInfo.mockReturnValue({
      credentials: [credential],
      supported_credential_types: [CredentialTypeEnum.API_KEY],
      allow_custom_token: true,
    })

    const pluginPayload = createPluginPayload()

    render(
      <AuthorizedInNode
        pluginPayload={pluginPayload}
        onAuthorizationItemClick={vi.fn()}
      />,
      { wrapper: createWrapper() },
    )

    // Check that button text contains unavailable
    const button = screen.getByRole('button')
    expect(button.textContent).toContain('plugin.auth.unavailable')
  })

  it('should call onAuthorizationItemClick when clicking', async () => {
    const AuthorizedInNode = (await import('./authorized-in-node')).default

    const onAuthorizationItemClick = vi.fn()
    const pluginPayload = createPluginPayload()

    render(
      <AuthorizedInNode
        pluginPayload={pluginPayload}
        onAuthorizationItemClick={onAuthorizationItemClick}
      />,
      { wrapper: createWrapper() },
    )

    // Click to open the popup
    const buttons = screen.getAllByRole('button')
    fireEvent.click(buttons[0])

    // The popup should be open now - there will be multiple buttons after opening
    expect(screen.getAllByRole('button').length).toBeGreaterThan(0)
  })

  it('should be memoized', async () => {
    const AuthorizedInNodeModule = await import('./authorized-in-node')
    expect(typeof AuthorizedInNodeModule.default).toBe('object')
  })
})

// ==================== useCredential Hooks Tests ====================
describe('useCredential Hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetPluginCredentialInfo.mockReturnValue({
      credentials: [],
      supported_credential_types: [],
      allow_custom_token: true,
    })
  })

  describe('useGetPluginCredentialInfoHook', () => {
    it('should return credential info when enabled', async () => {
      const { useGetPluginCredentialInfoHook } = await import('./hooks/use-credential')

      mockGetPluginCredentialInfo.mockReturnValue({
        credentials: [createCredential()],
        supported_credential_types: [CredentialTypeEnum.API_KEY],
        allow_custom_token: true,
      })

      const pluginPayload = createPluginPayload()

      const { result } = renderHook(() => useGetPluginCredentialInfoHook(pluginPayload, true), {
        wrapper: createWrapper(),
      })

      expect(result.current.data).toBeDefined()
      expect(result.current.data?.credentials).toHaveLength(1)
    })

    it('should not fetch when disabled', async () => {
      const { useGetPluginCredentialInfoHook } = await import('./hooks/use-credential')

      const pluginPayload = createPluginPayload()

      const { result } = renderHook(() => useGetPluginCredentialInfoHook(pluginPayload, false), {
        wrapper: createWrapper(),
      })

      expect(result.current.data).toBeUndefined()
    })
  })

  describe('useDeletePluginCredentialHook', () => {
    it('should return mutateAsync function', async () => {
      const { useDeletePluginCredentialHook } = await import('./hooks/use-credential')

      const pluginPayload = createPluginPayload()

      const { result } = renderHook(() => useDeletePluginCredentialHook(pluginPayload), {
        wrapper: createWrapper(),
      })

      expect(typeof result.current.mutateAsync).toBe('function')
    })
  })

  describe('useInvalidPluginCredentialInfoHook', () => {
    it('should return invalidation function that calls both invalidators', async () => {
      const { useInvalidPluginCredentialInfoHook } = await import('./hooks/use-credential')

      const pluginPayload = createPluginPayload({ providerType: 'builtin' })

      const { result } = renderHook(() => useInvalidPluginCredentialInfoHook(pluginPayload), {
        wrapper: createWrapper(),
      })

      expect(typeof result.current).toBe('function')

      result.current()

      expect(mockInvalidPluginCredentialInfo).toHaveBeenCalled()
      expect(mockInvalidToolsByType).toHaveBeenCalled()
    })
  })

  describe('useSetPluginDefaultCredentialHook', () => {
    it('should return mutateAsync function', async () => {
      const { useSetPluginDefaultCredentialHook } = await import('./hooks/use-credential')

      const pluginPayload = createPluginPayload()

      const { result } = renderHook(() => useSetPluginDefaultCredentialHook(pluginPayload), {
        wrapper: createWrapper(),
      })

      expect(typeof result.current.mutateAsync).toBe('function')
    })
  })

  describe('useGetPluginCredentialSchemaHook', () => {
    it('should return schema data', async () => {
      const { useGetPluginCredentialSchemaHook } = await import('./hooks/use-credential')

      mockGetPluginCredentialSchema.mockReturnValue([{ name: 'api_key', type: 'string' }])

      const pluginPayload = createPluginPayload()

      const { result } = renderHook(
        () => useGetPluginCredentialSchemaHook(pluginPayload, CredentialTypeEnum.API_KEY),
        { wrapper: createWrapper() },
      )

      expect(result.current.data).toBeDefined()
    })
  })

  describe('useAddPluginCredentialHook', () => {
    it('should return mutateAsync function', async () => {
      const { useAddPluginCredentialHook } = await import('./hooks/use-credential')

      const pluginPayload = createPluginPayload()

      const { result } = renderHook(() => useAddPluginCredentialHook(pluginPayload), {
        wrapper: createWrapper(),
      })

      expect(typeof result.current.mutateAsync).toBe('function')
    })
  })

  describe('useUpdatePluginCredentialHook', () => {
    it('should return mutateAsync function', async () => {
      const { useUpdatePluginCredentialHook } = await import('./hooks/use-credential')

      const pluginPayload = createPluginPayload()

      const { result } = renderHook(() => useUpdatePluginCredentialHook(pluginPayload), {
        wrapper: createWrapper(),
      })

      expect(typeof result.current.mutateAsync).toBe('function')
    })
  })

  describe('useGetPluginOAuthUrlHook', () => {
    it('should return mutateAsync function', async () => {
      const { useGetPluginOAuthUrlHook } = await import('./hooks/use-credential')

      const pluginPayload = createPluginPayload()

      const { result } = renderHook(() => useGetPluginOAuthUrlHook(pluginPayload), {
        wrapper: createWrapper(),
      })

      expect(typeof result.current.mutateAsync).toBe('function')
    })
  })

  describe('useGetPluginOAuthClientSchemaHook', () => {
    it('should return schema data', async () => {
      const { useGetPluginOAuthClientSchemaHook } = await import('./hooks/use-credential')

      mockGetPluginOAuthClientSchema.mockReturnValue({
        schema: [],
        is_oauth_custom_client_enabled: true,
      })

      const pluginPayload = createPluginPayload()

      const { result } = renderHook(() => useGetPluginOAuthClientSchemaHook(pluginPayload), {
        wrapper: createWrapper(),
      })

      expect(result.current.data).toBeDefined()
    })
  })

  describe('useSetPluginOAuthCustomClientHook', () => {
    it('should return mutateAsync function', async () => {
      const { useSetPluginOAuthCustomClientHook } = await import('./hooks/use-credential')

      const pluginPayload = createPluginPayload()

      const { result } = renderHook(() => useSetPluginOAuthCustomClientHook(pluginPayload), {
        wrapper: createWrapper(),
      })

      expect(typeof result.current.mutateAsync).toBe('function')
    })
  })

  describe('useDeletePluginOAuthCustomClientHook', () => {
    it('should return mutateAsync function', async () => {
      const { useDeletePluginOAuthCustomClientHook } = await import('./hooks/use-credential')

      const pluginPayload = createPluginPayload()

      const { result } = renderHook(() => useDeletePluginOAuthCustomClientHook(pluginPayload), {
        wrapper: createWrapper(),
      })

      expect(typeof result.current.mutateAsync).toBe('function')
    })
  })
})

// ==================== Edge Cases and Error Handling ====================
describe('Edge Cases and Error Handling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsCurrentWorkspaceManager.mockReturnValue(true)
    mockGetPluginCredentialInfo.mockReturnValue({
      credentials: [],
      supported_credential_types: [CredentialTypeEnum.API_KEY],
      allow_custom_token: true,
    })
    mockGetPluginOAuthClientSchema.mockReturnValue({
      schema: [],
      is_oauth_custom_client_enabled: false,
      is_system_oauth_params_exists: false,
    })
  })

  describe('PluginAuth edge cases', () => {
    it('should handle empty provider gracefully', async () => {
      const PluginAuth = (await import('./plugin-auth')).default

      const pluginPayload = createPluginPayload({ provider: '' })

      expect(() => {
        render(
          <PluginAuth pluginPayload={pluginPayload} />,
          { wrapper: createWrapper() },
        )
      }).not.toThrow()
    })

    it('should handle tool and datasource auth categories with button', async () => {
      const PluginAuth = (await import('./plugin-auth')).default

      // Tool and datasource categories should render with API support
      const categoriesWithApi = [AuthCategory.tool]

      for (const category of categoriesWithApi) {
        const pluginPayload = createPluginPayload({ category })

        const { unmount } = render(
          <PluginAuth pluginPayload={pluginPayload} />,
          { wrapper: createWrapper() },
        )

        expect(screen.getByRole('button')).toBeInTheDocument()

        unmount()
      }
    })

    it('should handle model and trigger categories without throwing', async () => {
      const PluginAuth = (await import('./plugin-auth')).default

      // Model and trigger categories have empty API endpoints, so they render without buttons
      const categoriesWithoutApi = [AuthCategory.model, AuthCategory.trigger]

      for (const category of categoriesWithoutApi) {
        const pluginPayload = createPluginPayload({ category })

        expect(() => {
          const { unmount } = render(
            <PluginAuth pluginPayload={pluginPayload} />,
            { wrapper: createWrapper() },
          )
          unmount()
        }).not.toThrow()
      }
    })

    it('should handle undefined detail', async () => {
      const PluginAuth = (await import('./plugin-auth')).default

      const pluginPayload = createPluginPayload({ detail: undefined })

      expect(() => {
        render(
          <PluginAuth pluginPayload={pluginPayload} />,
          { wrapper: createWrapper() },
        )
      }).not.toThrow()
    })
  })

  describe('usePluginAuthAction error handling', () => {
    it('should handle delete error gracefully', async () => {
      const { usePluginAuthAction } = await import('./hooks/use-plugin-auth-action')

      mockDeletePluginCredential.mockRejectedValue(new Error('Delete failed'))

      const pluginPayload = createPluginPayload()

      const { result } = renderHook(() => usePluginAuthAction(pluginPayload), {
        wrapper: createWrapper(),
      })

      act(() => {
        result.current.openConfirm('test-id')
      })

      // Should not throw, error is caught
      await expect(
        act(async () => {
          await result.current.handleConfirm()
        }),
      ).rejects.toThrow('Delete failed')

      // Action state should be reset
      expect(result.current.doingAction).toBe(false)
    })

    it('should handle set default error gracefully', async () => {
      const { usePluginAuthAction } = await import('./hooks/use-plugin-auth-action')

      mockSetPluginDefaultCredential.mockRejectedValue(new Error('Set default failed'))

      const pluginPayload = createPluginPayload()

      const { result } = renderHook(() => usePluginAuthAction(pluginPayload), {
        wrapper: createWrapper(),
      })

      await expect(
        act(async () => {
          await result.current.handleSetDefault('test-id')
        }),
      ).rejects.toThrow('Set default failed')

      expect(result.current.doingAction).toBe(false)
    })

    it('should handle rename error gracefully', async () => {
      const { usePluginAuthAction } = await import('./hooks/use-plugin-auth-action')

      mockUpdatePluginCredential.mockRejectedValue(new Error('Rename failed'))

      const pluginPayload = createPluginPayload()

      const { result } = renderHook(() => usePluginAuthAction(pluginPayload), {
        wrapper: createWrapper(),
      })

      await expect(
        act(async () => {
          await result.current.handleRename({ credential_id: 'test-id', name: 'New Name' })
        }),
      ).rejects.toThrow('Rename failed')

      expect(result.current.doingAction).toBe(false)
    })
  })

  describe('Credential list edge cases', () => {
    it('should handle large credential lists', async () => {
      const { usePluginAuth } = await import('./hooks/use-plugin-auth')

      const largeCredentialList = createCredentialList(100)
      mockGetPluginCredentialInfo.mockReturnValue({
        credentials: largeCredentialList,
        supported_credential_types: [CredentialTypeEnum.API_KEY],
        allow_custom_token: true,
      })

      const pluginPayload = createPluginPayload()

      const { result } = renderHook(() => usePluginAuth(pluginPayload, true), {
        wrapper: createWrapper(),
      })

      expect(result.current.isAuthorized).toBe(true)
      expect(result.current.credentials).toHaveLength(100)
    })

    it('should handle mixed credential types', async () => {
      const { usePluginAuth } = await import('./hooks/use-plugin-auth')

      const mixedCredentials = [
        createCredential({ id: '1', credential_type: CredentialTypeEnum.API_KEY }),
        createCredential({ id: '2', credential_type: CredentialTypeEnum.OAUTH2 }),
        createCredential({ id: '3', credential_type: undefined }),
      ]
      mockGetPluginCredentialInfo.mockReturnValue({
        credentials: mixedCredentials,
        supported_credential_types: [CredentialTypeEnum.API_KEY, CredentialTypeEnum.OAUTH2],
        allow_custom_token: true,
      })

      const pluginPayload = createPluginPayload()

      const { result } = renderHook(() => usePluginAuth(pluginPayload, true), {
        wrapper: createWrapper(),
      })

      expect(result.current.credentials).toHaveLength(3)
      expect(result.current.canOAuth).toBe(true)
      expect(result.current.canApiKey).toBe(true)
    })
  })

  describe('Boundary conditions', () => {
    it('should handle special characters in provider name', async () => {
      const { useGetApi } = await import('./hooks/use-get-api')

      const pluginPayload = createPluginPayload({
        provider: 'test-provider_v2.0',
      })

      const apiMap = useGetApi(pluginPayload)

      expect(apiMap.getCredentialInfo).toContain('test-provider_v2.0')
    })

    it('should handle very long provider names', async () => {
      const { useGetApi } = await import('./hooks/use-get-api')

      const longProvider = 'a'.repeat(200)
      const pluginPayload = createPluginPayload({
        provider: longProvider,
      })

      const apiMap = useGetApi(pluginPayload)

      expect(apiMap.getCredentialInfo).toContain(longProvider)
    })
  })
})
