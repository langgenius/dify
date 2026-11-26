import type { PluginPayload } from '../../types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook } from '@testing-library/react'
import { createElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { consoleQuery } from '@/service/console'
import { AuthCategory, CredentialTypeEnum } from '../../types'
import {
  useAddPluginCredentialHook,
  useDeletePluginCredentialHook,
  useDeletePluginOAuthCustomClientHook,
  useGetPluginCredentialInfoHook,
  useGetPluginCredentialSchemaHook,
  useGetPluginOAuthClientSchemaHook,
  useGetPluginOAuthUrlHook,
  useInvalidPluginCredentialInfoHook,
  useSetPluginDefaultCredentialHook,
  useSetPluginOAuthCustomClientHook,
  useUpdatePluginCredentialHook,
} from '../use-credential'

// Queries stay pending; these specs only assert which cache entries the hooks own.
const request = vi.hoisted(() => vi.fn(() => new Promise<Response>(() => {})))
vi.mock('@/service/base', () => ({ request }))

// Mock service hooks
const mockUseDeletePluginCredential = vi.fn().mockReturnValue({ mutateAsync: vi.fn() })
const mockUseSetPluginDefaultCredential = vi.fn().mockReturnValue({ mutateAsync: vi.fn() })
const mockUseAddPluginCredential = vi.fn().mockReturnValue({ mutateAsync: vi.fn() })
const mockUseUpdatePluginCredential = vi.fn().mockReturnValue({ mutateAsync: vi.fn() })
const mockUseGetPluginOAuthUrl = vi.fn().mockReturnValue({ mutateAsync: vi.fn() })
const mockUseSetPluginOAuthCustomClient = vi.fn().mockReturnValue({ mutateAsync: vi.fn() })
const mockUseDeletePluginOAuthCustomClient = vi.fn().mockReturnValue({ mutateAsync: vi.fn() })

vi.mock('@/service/use-plugins-auth', () => ({
  useDeletePluginCredential: (...args: unknown[]) => mockUseDeletePluginCredential(...args),
  useSetPluginDefaultCredential: (...args: unknown[]) => mockUseSetPluginDefaultCredential(...args),
  useAddPluginCredential: (...args: unknown[]) => mockUseAddPluginCredential(...args),
  useUpdatePluginCredential: (...args: unknown[]) => mockUseUpdatePluginCredential(...args),
  useGetPluginOAuthUrl: (...args: unknown[]) => mockUseGetPluginOAuthUrl(...args),
  useSetPluginOAuthCustomClient: (...args: unknown[]) => mockUseSetPluginOAuthCustomClient(...args),
  useDeletePluginOAuthCustomClient: (...args: unknown[]) =>
    mockUseDeletePluginOAuthCustomClient(...args),
}))

const toolPayload = {
  category: AuthCategory.tool,
  provider: 'test-provider',
  providerType: 'builtin',
} satisfies PluginPayload

const credentialInfo =
  consoleQuery.workspaces.current.toolProvider.builtin.byProvider.credential.info.get
const oauthClientSchema =
  consoleQuery.workspaces.current.toolProvider.builtin.byProvider.oauth.clientSchema.get

const renderWithClient = <T>(hook: () => T) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const rendered = renderHook(hook, {
    wrapper: ({ children }) =>
      createElement(QueryClientProvider, { client: queryClient }, children),
  })
  return { ...rendered, queryClient }
}

describe('use-credential hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('useGetPluginCredentialInfoHook', () => {
    it('should load the tool credential info with the included credential IDs', () => {
      const { queryClient } = renderWithClient(() =>
        useGetPluginCredentialInfoHook(toolPayload, true, ['credential-1', '']),
      )
      expect(
        queryClient.getQueryState(
          credentialInfo.queryKey({
            input: {
              params: { provider: toolPayload.provider },
              query: { include_credential_ids: ['credential-1'] },
            },
          }),
        ),
      ).toBeDefined()
    })

    it('should not request credential info when disabled', () => {
      const { result } = renderWithClient(() => useGetPluginCredentialInfoHook(toolPayload, false))
      expect(result.current.fetchStatus).toBe('idle')
      expect(request).not.toHaveBeenCalled()
    })
  })

  describe('useDeletePluginCredentialHook', () => {
    it('should call service with correct URL', () => {
      renderHook(() => useDeletePluginCredentialHook(toolPayload))
      expect(mockUseDeletePluginCredential).toHaveBeenCalledWith(toolPayload)
    })
  })

  describe('useInvalidPluginCredentialInfoHook', () => {
    it('should return a function that invalidates both credential info and tools', () => {
      const queryClient = new QueryClient()
      const builtInToolsKey = consoleQuery.workspaces.current.tools.builtin.get.queryKey()
      const customToolsKey = consoleQuery.workspaces.current.tools.api.get.queryKey()
      const infoKey = credentialInfo.queryKey({
        input: { params: { provider: toolPayload.provider } },
      })
      const includedInfoKey = credentialInfo.queryKey({
        input: {
          params: { provider: toolPayload.provider },
          query: { include_credential_ids: ['credential-1'] },
        },
      })
      const emptyInfo = {
        credentials: [],
        is_oauth_custom_client_enabled: false,
        supported_credential_types: [],
      }
      queryClient.setQueryData(builtInToolsKey, [])
      queryClient.setQueryData(customToolsKey, [])
      queryClient.setQueryData(infoKey, emptyInfo)
      queryClient.setQueryData(includedInfoKey, emptyInfo)
      const { result } = renderHook(() => useInvalidPluginCredentialInfoHook(toolPayload), {
        wrapper: ({ children }) =>
          createElement(QueryClientProvider, { client: queryClient }, children),
      })

      result.current()

      expect(queryClient.getQueryState(infoKey)?.isInvalidated).toBe(true)
      expect(queryClient.getQueryState(includedInfoKey)?.isInvalidated).toBe(true)
      expect(queryClient.getQueryState(builtInToolsKey)?.isInvalidated).toBe(true)
      expect(queryClient.getQueryState(customToolsKey)?.isInvalidated).toBe(false)
    })
  })

  describe('useSetPluginDefaultCredentialHook', () => {
    it('should call service with correct URL', () => {
      renderHook(() => useSetPluginDefaultCredentialHook(toolPayload))
      expect(mockUseSetPluginDefaultCredential).toHaveBeenCalledWith(toolPayload)
    })
  })

  describe('useGetPluginCredentialSchemaHook', () => {
    it.each([CredentialTypeEnum.API_KEY, CredentialTypeEnum.OAUTH2])(
      'should load the %s credential schema',
      (credentialType) => {
        const { queryClient } = renderWithClient(() =>
          useGetPluginCredentialSchemaHook(toolPayload, credentialType),
        )
        expect(
          queryClient.getQueryState(
            consoleQuery.workspaces.current.toolProvider.builtin.byProvider.credential.schema.byCredentialType.get.queryKey(
              {
                input: {
                  params: { provider: toolPayload.provider, credential_type: credentialType },
                },
              },
            ),
          ),
        ).toBeDefined()
      },
    )
  })

  describe('useAddPluginCredentialHook', () => {
    it('should call service with correct URL', () => {
      renderHook(() => useAddPluginCredentialHook(toolPayload))
      expect(mockUseAddPluginCredential).toHaveBeenCalledWith(toolPayload)
    })
  })

  describe('useUpdatePluginCredentialHook', () => {
    it('should call service with correct URL', () => {
      renderHook(() => useUpdatePluginCredentialHook(toolPayload))
      expect(mockUseUpdatePluginCredential).toHaveBeenCalledWith(toolPayload)
    })
  })

  describe('useGetPluginOAuthUrlHook', () => {
    it('should call service with correct URL', () => {
      renderHook(() => useGetPluginOAuthUrlHook(toolPayload))
      expect(mockUseGetPluginOAuthUrl).toHaveBeenCalledWith(toolPayload)
    })
  })

  describe('useGetPluginOAuthClientSchemaHook', () => {
    it('should load the OAuth client schema', () => {
      const { queryClient } = renderWithClient(() => useGetPluginOAuthClientSchemaHook(toolPayload))
      expect(
        queryClient.getQueryState(
          oauthClientSchema.queryKey({ input: { params: { provider: toolPayload.provider } } }),
        ),
      ).toBeDefined()
    })

    it('should disable the service query when OAuth data is provided by the caller', () => {
      const { result } = renderWithClient(() =>
        useGetPluginOAuthClientSchemaHook(toolPayload, false),
      )

      expect(result.current.fetchStatus).toBe('idle')
      expect(request).not.toHaveBeenCalled()
    })
  })

  describe('useSetPluginOAuthCustomClientHook', () => {
    it('should call service with correct URL', () => {
      renderHook(() => useSetPluginOAuthCustomClientHook(toolPayload))
      expect(mockUseSetPluginOAuthCustomClient).toHaveBeenCalledWith(toolPayload)
    })
  })

  describe('useDeletePluginOAuthCustomClientHook', () => {
    it('should call service with correct URL', () => {
      renderHook(() => useDeletePluginOAuthCustomClientHook(toolPayload))
      expect(mockUseDeletePluginOAuthCustomClient).toHaveBeenCalledWith(toolPayload)
    })
  })
})
