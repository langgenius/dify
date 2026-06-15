import type { ReactNode } from 'react'
import type { InstalledPluginListWithTotalResponse } from '@/app/components/plugins/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useInstalledPluginList } from './use-plugins'

const mockGet = vi.hoisted(() => vi.fn())

vi.mock('./base', () => ({
  get: mockGet,
  getMarketplace: vi.fn(),
  post: vi.fn(),
  postMarketplace: vi.fn(),
}))

vi.mock('./common', () => ({
  fetchModelProviderModelList: vi.fn(),
}))

vi.mock('./plugins', () => ({
  fetchPluginInfoFromMarketPlace: vi.fn(),
  uninstallPlugin: vi.fn(),
}))

vi.mock('./use-tools', () => ({
  useInvalidateAllBuiltInTools: () => vi.fn(),
}))

vi.mock('@/app/components/plugins/install-plugin/hooks/use-refresh-plugin-list', () => ({
  default: () => ({ refreshPluginList: vi.fn() }),
}))

vi.mock('@/app/components/plugins/marketplace/utils', () => ({
  getFormattedPlugin: vi.fn((plugin: unknown) => plugin),
}))

vi.mock('@/app/components/plugins/plugin-page/use-reference-setting', () => ({
  default: () => ({ canManagement: true }),
}))

const createResponse = (endpointsActive: number): InstalledPluginListWithTotalResponse => ({
  plugins: [
    {
      plugin_id: 'plugin-1',
      endpoints_active: endpointsActive,
      endpoints_setups: endpointsActive,
    } as unknown as InstalledPluginListWithTotalResponse['plugins'][number],
  ],
  total: 1,
})

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

describe('useInstalledPluginList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('drops cached plugin list data after unmount so remount fetches fresh counts', async () => {
    const queryClient = createQueryClient()
    const wrapper = createWrapper(queryClient)

    mockGet
      .mockResolvedValueOnce(createResponse(0))
      .mockResolvedValueOnce(createResponse(1))

    const { result, unmount } = renderHook(() => useInstalledPluginList(), { wrapper })

    await waitFor(() => {
      expect(result.current.data?.plugins[0]?.endpoints_active).toBe(0)
    })
    expect(mockGet).toHaveBeenCalledTimes(1)

    unmount()

    await waitFor(() => {
      expect(queryClient.getQueryCache().find({ queryKey: ['plugins', 'installedPluginList'] })).toBeUndefined()
    })

    const { result: remountedResult } = renderHook(() => useInstalledPluginList(), { wrapper })

    await waitFor(() => {
      expect(remountedResult.current.data?.plugins[0]?.endpoints_active).toBe(1)
    })
    expect(mockGet).toHaveBeenCalledTimes(2)
  })
})
