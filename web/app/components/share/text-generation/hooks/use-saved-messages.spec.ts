import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import * as React from 'react'
import { AppSourceType } from '@/service/share'
import {
  useInvalidateSavedMessages,
  useRemoveMessageMutation,
  useSavedMessages,
  useSaveMessageMutation,
} from './use-saved-messages'

// Mock service layer (preserve enum exports)
vi.mock('@/service/share', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    fetchSavedMessage: vi.fn(),
    saveMessage: vi.fn(),
    removeMessage: vi.fn(),
  }
})

vi.mock('@/app/components/base/toast', () => ({
  default: { notify: vi.fn() },
}))

// Get mocked functions for assertion
const shareModule = await import('@/service/share')
const mockFetchSavedMessage = shareModule.fetchSavedMessage as ReturnType<typeof vi.fn>
const mockSaveMessage = shareModule.saveMessage as ReturnType<typeof vi.fn>
const mockRemoveMessage = shareModule.removeMessage as ReturnType<typeof vi.fn>

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return ({ children }: { children: ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children)
}

const APP_SOURCE = AppSourceType.webApp
const APP_ID = 'test-app-id'

describe('useSavedMessages', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Fetching saved messages
  describe('Query behavior', () => {
    it('should fetch saved messages when enabled and appId present', async () => {
      mockFetchSavedMessage.mockResolvedValue({ data: [{ id: 'm1', answer: 'Hello' }] })

      const { result } = renderHook(
        () => useSavedMessages(APP_SOURCE, APP_ID, true),
        { wrapper: createWrapper() },
      )

      await waitFor(() => expect(result.current.isSuccess).toBe(true))
      expect(result.current.data).toEqual([{ id: 'm1', answer: 'Hello' }])
      expect(mockFetchSavedMessage).toHaveBeenCalledWith(APP_SOURCE, APP_ID)
    })

    it('should not fetch when disabled', () => {
      const { result } = renderHook(
        () => useSavedMessages(APP_SOURCE, APP_ID, false),
        { wrapper: createWrapper() },
      )

      expect(result.current.fetchStatus).toBe('idle')
      expect(mockFetchSavedMessage).not.toHaveBeenCalled()
    })

    it('should not fetch when appId is empty', () => {
      const { result } = renderHook(
        () => useSavedMessages(APP_SOURCE, '', true),
        { wrapper: createWrapper() },
      )

      expect(result.current.fetchStatus).toBe('idle')
      expect(mockFetchSavedMessage).not.toHaveBeenCalled()
    })
  })
})

describe('useSaveMessageMutation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should call saveMessage service on mutate', async () => {
    mockSaveMessage.mockResolvedValue({})

    const { result } = renderHook(
      () => useSaveMessageMutation(APP_SOURCE, APP_ID),
      { wrapper: createWrapper() },
    )

    result.current.mutate('msg-1')

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockSaveMessage).toHaveBeenCalledWith('msg-1', APP_SOURCE, APP_ID)
  })
})

describe('useRemoveMessageMutation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should call removeMessage service on mutate', async () => {
    mockRemoveMessage.mockResolvedValue({})

    const { result } = renderHook(
      () => useRemoveMessageMutation(APP_SOURCE, APP_ID),
      { wrapper: createWrapper() },
    )

    result.current.mutate('msg-2')

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockRemoveMessage).toHaveBeenCalledWith('msg-2', APP_SOURCE, APP_ID)
  })
})

describe('useInvalidateSavedMessages', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return a callable invalidation function', () => {
    const { result } = renderHook(
      () => useInvalidateSavedMessages(APP_SOURCE, APP_ID),
      { wrapper: createWrapper() },
    )

    expect(typeof result.current).toBe('function')
    expect(() => result.current()).not.toThrow()
  })
})
