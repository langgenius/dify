import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { defaultSystemFeatures } from '@/types/feature'
import { useGlobalPublicStore, useSystemFeaturesQuery } from './global-public-context'

const mockSystemFeatures = vi.fn()

vi.mock('@/service/client', () => ({
  consoleClient: {
    systemFeatures: (...args: unknown[]) => mockSystemFeatures(...args),
  },
  consoleQuery: {},
}))

vi.mock('@/utils/setup-status', () => ({
  fetchSetupStatusWithCache: vi.fn().mockResolvedValue({}),
}))

const createWrapper = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

describe('fetchSystemFeatures obfuscation decode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useGlobalPublicStore.setState({ systemFeatures: defaultSystemFeatures })
  })

  it('decodes a valid Base64 envelope and updates the store', async () => {
    const features = { ...defaultSystemFeatures, enable_email_password_login: false, is_allow_register: true }
    mockSystemFeatures.mockResolvedValue({ d: btoa(JSON.stringify(features)) })

    const { result } = renderHook(() => useSystemFeaturesQuery(), { wrapper: createWrapper() })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    const stored = useGlobalPublicStore.getState().systemFeatures
    expect(stored.enable_email_password_login).toBe(false)
    expect(stored.is_allow_register).toBe(true)
    // query data and store must be consistent
    expect(result.current.data).toEqual(stored)
  })

  it('falls back to defaultSystemFeatures when Base64 decode fails', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockSystemFeatures.mockResolvedValue({ d: '!!!not-valid-base64!!!' })

    const { result } = renderHook(() => useSystemFeaturesQuery(), { wrapper: createWrapper() })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    const stored = useGlobalPublicStore.getState().systemFeatures
    expect(stored).toMatchObject(defaultSystemFeatures)
    expect(result.current.data).toEqual(stored)
    expect(consoleSpy).toHaveBeenCalledWith(
      '[system-features] Failed to decode response envelope; using defaults',
      expect.any(Error),
    )
    consoleSpy.mockRestore()
  })

  it('falls back to defaultSystemFeatures when Zod validation fails', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    // valid Base64 but payload fails Zod schema (string instead of boolean)
    mockSystemFeatures.mockResolvedValue({ d: btoa(JSON.stringify({ enable_email_password_login: 'yes' })) })

    const { result } = renderHook(() => useSystemFeaturesQuery(), { wrapper: createWrapper() })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(useGlobalPublicStore.getState().systemFeatures).toMatchObject(defaultSystemFeatures)
    expect(consoleSpy).toHaveBeenCalledWith(
      '[system-features] Failed to decode response envelope; using defaults',
      expect.any(Error),
    )
    consoleSpy.mockRestore()
  })
})
