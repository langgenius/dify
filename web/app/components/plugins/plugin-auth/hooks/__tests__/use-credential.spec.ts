import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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
  useInvalidPluginOAuthClientSchemaHook,
  useSetPluginDefaultCredentialHook,
  useSetPluginOAuthCustomClientHook,
  useUpdatePluginCredentialHook,
} from '../use-credential'

// Mock service hooks
const mockUseGetPluginCredentialInfo = vi.fn().mockReturnValue({ data: null, isLoading: false })
const mockUseDeletePluginCredential = vi.fn().mockReturnValue({ mutateAsync: vi.fn() })
const mockUseInvalidPluginCredentialInfo = vi.fn().mockReturnValue(vi.fn())
const mockUseSetPluginDefaultCredential = vi.fn().mockReturnValue({ mutateAsync: vi.fn() })
const mockUseGetPluginCredentialSchema = vi.fn().mockReturnValue({ data: [], isLoading: false })
const mockUseAddPluginCredential = vi.fn().mockReturnValue({ mutateAsync: vi.fn() })
const mockUseUpdatePluginCredential = vi.fn().mockReturnValue({ mutateAsync: vi.fn() })
const mockUseGetPluginOAuthUrl = vi.fn().mockReturnValue({ mutateAsync: vi.fn() })
const mockUseGetPluginOAuthClientSchema = vi.fn().mockReturnValue({ data: null, isLoading: false })
const mockUseInvalidPluginOAuthClientSchema = vi.fn().mockReturnValue(vi.fn())
const mockUseSetPluginOAuthCustomClient = vi.fn().mockReturnValue({ mutateAsync: vi.fn() })
const mockUseDeletePluginOAuthCustomClient = vi.fn().mockReturnValue({ mutateAsync: vi.fn() })
const mockInvalidToolsByType = vi.fn()

vi.mock('@/service/use-plugins-auth', () => ({
  useGetPluginCredentialInfo: (...args: unknown[]) => mockUseGetPluginCredentialInfo(...args),
  useDeletePluginCredential: (...args: unknown[]) => mockUseDeletePluginCredential(...args),
  useInvalidPluginCredentialInfo: (...args: unknown[]) => mockUseInvalidPluginCredentialInfo(...args),
  useSetPluginDefaultCredential: (...args: unknown[]) => mockUseSetPluginDefaultCredential(...args),
  useGetPluginCredentialSchema: (...args: unknown[]) => mockUseGetPluginCredentialSchema(...args),
  useAddPluginCredential: (...args: unknown[]) => mockUseAddPluginCredential(...args),
  useUpdatePluginCredential: (...args: unknown[]) => mockUseUpdatePluginCredential(...args),
  useGetPluginOAuthUrl: (...args: unknown[]) => mockUseGetPluginOAuthUrl(...args),
  useGetPluginOAuthClientSchema: (...args: unknown[]) => mockUseGetPluginOAuthClientSchema(...args),
  useInvalidPluginOAuthClientSchema: (...args: unknown[]) => mockUseInvalidPluginOAuthClientSchema(...args),
  useSetPluginOAuthCustomClient: (...args: unknown[]) => mockUseSetPluginOAuthCustomClient(...args),
  useDeletePluginOAuthCustomClient: (...args: unknown[]) => mockUseDeletePluginOAuthCustomClient(...args),
}))

vi.mock('@/service/use-tools', () => ({
  useInvalidToolsByType: () => mockInvalidToolsByType,
}))

const toolPayload = {
  category: AuthCategory.tool,
  provider: 'test-provider',
  providerType: 'builtin',
}

describe('use-credential hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('useGetPluginCredentialInfoHook', () => {
    it('should call service with correct URL when enabled', () => {
      renderHook(() => useGetPluginCredentialInfoHook(toolPayload, true))
      expect(mockUseGetPluginCredentialInfo).toHaveBeenCalledWith(
        `/workspaces/current/tool-provider/builtin/${toolPayload.provider}/credential/info`,
      )
    })

    it('should pass empty string when disabled', () => {
      renderHook(() => useGetPluginCredentialInfoHook(toolPayload, false))
      expect(mockUseGetPluginCredentialInfo).toHaveBeenCalledWith('')
    })
  })

  describe('useDeletePluginCredentialHook', () => {
    it('should call service with correct URL', () => {
      renderHook(() => useDeletePluginCredentialHook(toolPayload))
      expect(mockUseDeletePluginCredential).toHaveBeenCalledWith(
        `/workspaces/current/tool-provider/builtin/${toolPayload.provider}/delete`,
      )
    })
  })

  describe('useInvalidPluginCredentialInfoHook', () => {
    it('should return a function that invalidates both credential info and tools', () => {
      const { result } = renderHook(() => useInvalidPluginCredentialInfoHook(toolPayload))

      result.current()

      const invalidFn = mockUseInvalidPluginCredentialInfo.mock.results[0].value
      expect(invalidFn).toHaveBeenCalled()
      expect(mockInvalidToolsByType).toHaveBeenCalled()
    })
  })

  describe('useSetPluginDefaultCredentialHook', () => {
    it('should call service with correct URL', () => {
      renderHook(() => useSetPluginDefaultCredentialHook(toolPayload))
      expect(mockUseSetPluginDefaultCredential).toHaveBeenCalledWith(
        `/workspaces/current/tool-provider/builtin/${toolPayload.provider}/default-credential`,
      )
    })
  })

  describe('useGetPluginCredentialSchemaHook', () => {
    it('should call service with correct schema URL for API_KEY', () => {
      renderHook(() => useGetPluginCredentialSchemaHook(toolPayload, CredentialTypeEnum.API_KEY))
      expect(mockUseGetPluginCredentialSchema).toHaveBeenCalledWith(
        `/workspaces/current/tool-provider/builtin/${toolPayload.provider}/credential/schema/${CredentialTypeEnum.API_KEY}`,
      )
    })

    it('should call service with correct schema URL for OAUTH2', () => {
      renderHook(() => useGetPluginCredentialSchemaHook(toolPayload, CredentialTypeEnum.OAUTH2))
      expect(mockUseGetPluginCredentialSchema).toHaveBeenCalledWith(
        `/workspaces/current/tool-provider/builtin/${toolPayload.provider}/credential/schema/${CredentialTypeEnum.OAUTH2}`,
      )
    })
  })

  describe('useAddPluginCredentialHook', () => {
    it('should call service with correct URL', () => {
      renderHook(() => useAddPluginCredentialHook(toolPayload))
      expect(mockUseAddPluginCredential).toHaveBeenCalledWith(
        `/workspaces/current/tool-provider/builtin/${toolPayload.provider}/add`,
      )
    })
  })

  describe('useUpdatePluginCredentialHook', () => {
    it('should call service with correct URL', () => {
      renderHook(() => useUpdatePluginCredentialHook(toolPayload))
      expect(mockUseUpdatePluginCredential).toHaveBeenCalledWith(
        `/workspaces/current/tool-provider/builtin/${toolPayload.provider}/update`,
      )
    })
  })

  describe('useGetPluginOAuthUrlHook', () => {
    it('should call service with correct URL', () => {
      renderHook(() => useGetPluginOAuthUrlHook(toolPayload))
      expect(mockUseGetPluginOAuthUrl).toHaveBeenCalledWith(
        `/oauth/plugin/${toolPayload.provider}/tool/authorization-url`,
      )
    })
  })

  describe('useGetPluginOAuthClientSchemaHook', () => {
    it('should call service with correct URL', () => {
      renderHook(() => useGetPluginOAuthClientSchemaHook(toolPayload))
      expect(mockUseGetPluginOAuthClientSchema).toHaveBeenCalledWith(
        `/workspaces/current/tool-provider/builtin/${toolPayload.provider}/oauth/client-schema`,
      )
    })
  })

  describe('useInvalidPluginOAuthClientSchemaHook', () => {
    it('should call service with correct URL', () => {
      renderHook(() => useInvalidPluginOAuthClientSchemaHook(toolPayload))
      expect(mockUseInvalidPluginOAuthClientSchema).toHaveBeenCalledWith(
        `/workspaces/current/tool-provider/builtin/${toolPayload.provider}/oauth/client-schema`,
      )
    })
  })

  describe('useSetPluginOAuthCustomClientHook', () => {
    it('should call service with correct URL', () => {
      renderHook(() => useSetPluginOAuthCustomClientHook(toolPayload))
      expect(mockUseSetPluginOAuthCustomClient).toHaveBeenCalledWith(
        `/workspaces/current/tool-provider/builtin/${toolPayload.provider}/oauth/custom-client`,
      )
    })
  })

  describe('useDeletePluginOAuthCustomClientHook', () => {
    it('should call service with correct URL', () => {
      renderHook(() => useDeletePluginOAuthCustomClientHook(toolPayload))
      expect(mockUseDeletePluginOAuthCustomClient).toHaveBeenCalledWith(
        `/workspaces/current/tool-provider/builtin/${toolPayload.provider}/oauth/custom-client`,
      )
    })
  })
})
