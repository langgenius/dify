import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthCategory, CredentialTypeEnum } from '../../types'
import { usePluginAuth } from '../use-plugin-auth'

// Mock dependencies
const mockCredentials = [
  { id: '1', credential_type: CredentialTypeEnum.API_KEY, is_default: false },
  { id: '2', credential_type: CredentialTypeEnum.OAUTH2, is_default: true },
]

const mockCredentialInfo = vi.fn().mockReturnValue({
  credentials: mockCredentials,
  supported_credential_types: [CredentialTypeEnum.API_KEY, CredentialTypeEnum.OAUTH2],
  allow_custom_token: true,
})

const mockInvalidate = vi.fn()

vi.mock('../use-credential', () => ({
  useGetPluginCredentialInfoHook: (_payload: unknown, enable?: boolean) => ({
    data: enable ? mockCredentialInfo() : undefined,
    isLoading: false,
  }),
  useInvalidPluginCredentialInfoHook: () => mockInvalidate,
}))

vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    isCurrentWorkspaceManager: true,
  }),
}))

const basePayload = {
  category: AuthCategory.tool,
  provider: 'test-provider',
}

describe('usePluginAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return authorized state when credentials exist', () => {
    const { result } = renderHook(() => usePluginAuth(basePayload, true))

    expect(result.current.isAuthorized).toBe(true)
    expect(result.current.credentials).toHaveLength(2)
  })

  it('should detect OAuth and API Key support', () => {
    const { result } = renderHook(() => usePluginAuth(basePayload, true))

    expect(result.current.canOAuth).toBe(true)
    expect(result.current.canApiKey).toBe(true)
  })

  it('should return disabled=false for workspace managers', () => {
    const { result } = renderHook(() => usePluginAuth(basePayload, true))

    expect(result.current.disabled).toBe(false)
  })

  it('should return notAllowCustomCredential=false when allowed', () => {
    const { result } = renderHook(() => usePluginAuth(basePayload, true))

    expect(result.current.notAllowCustomCredential).toBe(false)
  })

  it('should return unauthorized when enable is false', () => {
    const { result } = renderHook(() => usePluginAuth(basePayload, false))

    expect(result.current.isAuthorized).toBe(false)
    expect(result.current.credentials).toEqual([])
  })

  it('should provide invalidate function', () => {
    const { result } = renderHook(() => usePluginAuth(basePayload, true))

    expect(result.current.invalidPluginCredentialInfo).toBe(mockInvalidate)
  })

  it('should handle empty credentials', () => {
    mockCredentialInfo.mockReturnValueOnce({
      credentials: [],
      supported_credential_types: [],
      allow_custom_token: false,
    })

    const { result } = renderHook(() => usePluginAuth(basePayload, true))

    expect(result.current.isAuthorized).toBe(false)
    expect(result.current.canOAuth).toBe(false)
    expect(result.current.canApiKey).toBe(false)
    expect(result.current.notAllowCustomCredential).toBe(true)
  })

  it('should handle only API Key support', () => {
    mockCredentialInfo.mockReturnValueOnce({
      credentials: [{ id: '1' }],
      supported_credential_types: [CredentialTypeEnum.API_KEY],
      allow_custom_token: true,
    })

    const { result } = renderHook(() => usePluginAuth(basePayload, true))

    expect(result.current.canApiKey).toBe(true)
    expect(result.current.canOAuth).toBe(false)
  })
})
