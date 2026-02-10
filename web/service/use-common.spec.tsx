import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { post } from './base'
import { commonQueryKeys, useLogout } from './use-common'

vi.mock('./base', () => ({
  get: vi.fn(),
  post: vi.fn(),
}))

const createWrapper = (queryClient: QueryClient) => {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  )
}

describe('useLogout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should reset login cache when logout succeeds', async () => {
    // Arrange
    const queryClient = new QueryClient()
    const wrapper = createWrapper(queryClient)
    queryClient.setQueryData(commonQueryKeys.isLogin, { logged_in: true })
    vi.mocked(post).mockResolvedValue({ result: 'success' } as never)
    const { result } = renderHook(() => useLogout(), { wrapper })

    // Act
    await act(async () => {
      await result.current.mutateAsync()
    })

    // Assert
    expect(post).toHaveBeenCalledWith('/logout')
    expect(queryClient.getQueryData(commonQueryKeys.isLogin)).toEqual({ logged_in: false })
  })
})
