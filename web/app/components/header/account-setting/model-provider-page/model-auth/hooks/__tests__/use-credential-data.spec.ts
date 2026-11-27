import type { ModelProvider } from '../../../declarations'
import { renderHook } from '@testing-library/react'
import { isErrorHandled } from '@/service/handled-error'
import { useCredentialData } from '../use-credential-data'

const credentialQuery = {
  data: undefined as Record<string, unknown> | undefined,
  error: null as Error | null,
  isError: false,
  isFetching: false,
  isLoading: false,
  refetch: vi.fn(),
}

vi.mock('../use-auth-service', () => ({
  useGetCredential: () => credentialQuery,
}))

const provider = { provider: 'langgenius/openai/openai' } as ModelProvider

describe('useCredentialData', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.assign(credentialQuery, {
      data: undefined,
      error: null,
      isError: false,
      isFetching: false,
      isLoading: false,
    })
  })

  it('claims a failed first load, which the model modal renders in place of the form', () => {
    const failure = new Error('credential unavailable')
    Object.assign(credentialQuery, { error: failure, isError: true })

    const { result } = renderHook(() => useCredentialData(provider, true))

    expect(result.current.loadError).toBe(failure)
    expect(isErrorHandled(failure)).toBe(true)
    result.current.retry()
    expect(credentialQuery.refetch).toHaveBeenCalledOnce()
  })

  it('leaves a failed refetch to the query cache, keeping the loaded credential', () => {
    const failure = new Error('refetch failed')
    Object.assign(credentialQuery, { data: { credentials: {} }, error: failure, isError: true })

    const { result } = renderHook(() => useCredentialData(provider, true))

    expect(result.current.loadError).toBeUndefined()
    expect(isErrorHandled(failure)).toBe(false)
  })
})
