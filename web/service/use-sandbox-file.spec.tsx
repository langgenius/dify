import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import { consoleQuery } from './client'
import { useInvalidateSandboxFiles } from './use-sandbox-file'

const createQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
    },
  },
})

const createWrapper = (queryClient: QueryClient) => {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

describe('useInvalidateSandboxFiles', () => {
  it('should keep download query refetch enabled by default', async () => {
    const queryClient = createQueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined)
    const { result } = renderHook(() => useInvalidateSandboxFiles(), {
      wrapper: createWrapper(queryClient),
    })

    await act(async () => {
      await result.current()
    })

    expect(invalidateSpy).toHaveBeenNthCalledWith(1, {
      queryKey: consoleQuery.sandboxFile.listFiles.key(),
    })
    expect(invalidateSpy).toHaveBeenNthCalledWith(2, {
      queryKey: consoleQuery.sandboxFile.downloadFile.key(),
    })
  })

  it('should disable download query refetch when requested', async () => {
    const queryClient = createQueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined)
    const { result } = renderHook(() => useInvalidateSandboxFiles(), {
      wrapper: createWrapper(queryClient),
    })

    await act(async () => {
      await result.current({ refetchDownloadFile: false })
    })

    expect(invalidateSpy).toHaveBeenNthCalledWith(1, {
      queryKey: consoleQuery.sandboxFile.listFiles.key(),
    })
    expect(invalidateSpy).toHaveBeenNthCalledWith(2, {
      queryKey: consoleQuery.sandboxFile.downloadFile.key(),
      refetchType: 'none',
    })
  })
})
