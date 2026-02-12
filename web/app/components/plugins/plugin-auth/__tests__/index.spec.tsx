import type { ReactNode } from 'react'
import type { Credential, PluginPayload } from '../types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { AuthCategory, CredentialTypeEnum } from '../types'

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

const mockIsCurrentWorkspaceManager = vi.fn()
vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    isCurrentWorkspaceManager: mockIsCurrentWorkspaceManager(),
  }),
}))

const mockNotify = vi.fn()
vi.mock('@/app/components/base/toast', () => ({
  useToastContext: () => ({
    notify: mockNotify,
  }),
}))

vi.mock('@/hooks/use-oauth', () => ({
  openOAuthPopup: vi.fn(),
}))

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

const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  })

const _createWrapper = () => {
  const testQueryClient = createTestQueryClient()
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={testQueryClient}>
      {children}
    </QueryClientProvider>
  )
}

const _createPluginPayload = (overrides: Partial<PluginPayload> = {}): PluginPayload => ({
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

const _createCredentialList = (count: number, overrides: Partial<Credential>[] = []): Credential[] => {
  return Array.from({ length: count }, (_, i) => createCredential({
    id: `credential-${i}`,
    name: `Credential ${i}`,
    is_default: i === 0,
    ...overrides[i],
  }))
}

describe('Index Exports', () => {
  it('should export all required components and hooks', async () => {
    const exports = await import('../index')

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
  }, 15000)

  it('should export AuthCategory enum', async () => {
    const exports = await import('../index')

    expect(exports.AuthCategory).toBeDefined()
    expect(exports.AuthCategory.tool).toBe('tool')
    expect(exports.AuthCategory.datasource).toBe('datasource')
    expect(exports.AuthCategory.model).toBe('model')
    expect(exports.AuthCategory.trigger).toBe('trigger')
  }, 15000)

  it('should export CredentialTypeEnum', async () => {
    const exports = await import('../index')

    expect(exports.CredentialTypeEnum).toBeDefined()
    expect(exports.CredentialTypeEnum.OAUTH2).toBe('oauth2')
    expect(exports.CredentialTypeEnum.API_KEY).toBe('api-key')
  }, 15000)
})

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
