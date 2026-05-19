import type { ReactNode } from 'react'
import type { Permissions } from '@/app/components/plugins/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AUTO_UPDATE_MODE, AUTO_UPDATE_STRATEGY } from '@/app/components/plugins/reference-setting-modal/auto-update-setting/types'
import { PermissionType, PluginCategoryEnum } from '@/app/components/plugins/types'
import { get, post } from '../base'
import {
  useMutationPluginAutoUpgradeSettings,
  useMutationPluginPermissionSettings,
  usePluginAutoUpgradeSettings,
} from '../use-plugins'

vi.mock('../base', () => ({
  get: vi.fn(),
  getMarketplace: vi.fn(),
  post: vi.fn(),
  postMarketplace: vi.fn(),
}))

vi.mock('@/app/components/plugins/install-plugin/hooks/use-refresh-plugin-list', () => ({
  default: () => ({
    refreshPluginList: vi.fn(),
  }),
}))

vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    isCurrentWorkspaceManager: true,
    isCurrentWorkspaceOwner: false,
  }),
}))

vi.mock('../use-tools', () => ({
  useInvalidateAllBuiltInTools: () => vi.fn(),
}))

const createQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
})

const createWrapper = (queryClient: QueryClient) => {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    )
  }
}

describe('use-plugins mutations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('optimistically updates category auto-upgrade cache before the request finishes', async () => {
    const queryClient = createQueryClient()
    const queryKey = ['plugins', 'referenceSettings', 'autoUpgrade', PluginCategoryEnum.model]
    const previousAutoUpgrade = {
      strategy_setting: AUTO_UPDATE_STRATEGY.latest,
      upgrade_time_of_day: 0,
      upgrade_mode: AUTO_UPDATE_MODE.exclude,
      exclude_plugins: [],
      include_plugins: [],
    }
    const nextAutoUpgrade = {
      ...previousAutoUpgrade,
      upgrade_time_of_day: 3600,
    }
    let resolvePost: (value: unknown) => void = () => {}
    vi.mocked(post).mockReturnValue(new Promise((resolve) => {
      resolvePost = resolve
    }) as ReturnType<typeof post>)
    queryClient.setQueryData(queryKey, {
      category: PluginCategoryEnum.model,
      auto_upgrade: previousAutoUpgrade,
    })

    const { result } = renderHook(
      () => useMutationPluginAutoUpgradeSettings({ category: PluginCategoryEnum.model }),
      { wrapper: createWrapper(queryClient) },
    )

    act(() => {
      result.current.mutate(nextAutoUpgrade)
    })

    await waitFor(() => {
      expect(post).toHaveBeenCalledWith('/workspaces/current/plugin/auto-upgrade/change', {
        body: {
          category: PluginCategoryEnum.model,
          auto_upgrade: nextAutoUpgrade,
        },
      })
    })
    await waitFor(() => {
      expect(queryClient.getQueryData(queryKey)).toEqual({
        category: PluginCategoryEnum.model,
        auto_upgrade: nextAutoUpgrade,
      })
    })

    resolvePost({})
  })

  it('optimistically updates plugin permission cache before the request finishes', async () => {
    const queryClient = createQueryClient()
    const queryKey = ['plugins', 'referenceSettings', 'permission']
    const previousPermission: Permissions = {
      install_permission: PermissionType.admin,
      debug_permission: PermissionType.admin,
    }
    const nextPermission: Permissions = {
      install_permission: PermissionType.everyone,
      debug_permission: PermissionType.admin,
    }
    let resolvePost: (value: unknown) => void = () => {}
    vi.mocked(post).mockReturnValue(new Promise((resolve) => {
      resolvePost = resolve
    }) as ReturnType<typeof post>)
    queryClient.setQueryData(queryKey, previousPermission)

    const { result } = renderHook(
      () => useMutationPluginPermissionSettings(),
      { wrapper: createWrapper(queryClient) },
    )

    act(() => {
      result.current.mutate(nextPermission)
    })

    await waitFor(() => {
      expect(post).toHaveBeenCalledWith('/workspaces/current/plugin/permission/change', {
        body: nextPermission,
      })
    })
    await waitFor(() => {
      expect(queryClient.getQueryData(queryKey)).toEqual(nextPermission)
    })

    resolvePost({})
  })

  it('rolls back category auto-upgrade cache when the request fails', async () => {
    const queryClient = createQueryClient()
    const queryKey = ['plugins', 'referenceSettings', 'autoUpgrade', PluginCategoryEnum.model]
    const previousAutoUpgrade = {
      strategy_setting: AUTO_UPDATE_STRATEGY.latest,
      upgrade_time_of_day: 0,
      upgrade_mode: AUTO_UPDATE_MODE.exclude,
      exclude_plugins: [],
      include_plugins: [],
    }
    const nextAutoUpgrade = {
      ...previousAutoUpgrade,
      upgrade_time_of_day: 3600,
    }
    let rejectPost: (reason?: unknown) => void = () => {}
    vi.mocked(post).mockReturnValue(new Promise((_resolve, reject) => {
      rejectPost = reject
    }) as ReturnType<typeof post>)
    queryClient.setQueryData(queryKey, {
      category: PluginCategoryEnum.model,
      auto_upgrade: previousAutoUpgrade,
    })

    const { result } = renderHook(
      () => useMutationPluginAutoUpgradeSettings({ category: PluginCategoryEnum.model }),
      { wrapper: createWrapper(queryClient) },
    )

    const mutation = result.current.mutateAsync(nextAutoUpgrade).catch(() => undefined)

    await waitFor(() => {
      expect(queryClient.getQueryData(queryKey)).toEqual({
        category: PluginCategoryEnum.model,
        auto_upgrade: nextAutoUpgrade,
      })
    })

    rejectPost(new Error('auto-upgrade update failed'))

    await waitFor(() => {
      expect(queryClient.getQueryData(queryKey)).toEqual({
        category: PluginCategoryEnum.model,
        auto_upgrade: previousAutoUpgrade,
      })
    })
    await mutation
  })

  it('clears optimistic category auto-upgrade cache when the request fails without previous cache', async () => {
    const queryClient = createQueryClient()
    const queryKey = ['plugins', 'referenceSettings', 'autoUpgrade', PluginCategoryEnum.model]
    const nextAutoUpgrade = {
      strategy_setting: AUTO_UPDATE_STRATEGY.latest,
      upgrade_time_of_day: 3600,
      upgrade_mode: AUTO_UPDATE_MODE.exclude,
      exclude_plugins: [],
      include_plugins: [],
    }
    let rejectPost: (reason?: unknown) => void = () => {}
    vi.mocked(post).mockReturnValue(new Promise((_resolve, reject) => {
      rejectPost = reject
    }) as ReturnType<typeof post>)

    const { result } = renderHook(
      () => useMutationPluginAutoUpgradeSettings({ category: PluginCategoryEnum.model }),
      { wrapper: createWrapper(queryClient) },
    )

    const mutation = result.current.mutateAsync(nextAutoUpgrade).catch(() => undefined)

    await waitFor(() => {
      expect(queryClient.getQueryData(queryKey)).toEqual({
        category: PluginCategoryEnum.model,
        auto_upgrade: nextAutoUpgrade,
      })
    })

    rejectPost(new Error('auto-upgrade update failed'))

    await waitFor(() => {
      expect(queryClient.getQueryData(queryKey)).toBeUndefined()
    })
    await mutation
  })

  it('rolls back plugin permission cache when the request fails', async () => {
    const queryClient = createQueryClient()
    const queryKey = ['plugins', 'referenceSettings', 'permission']
    const previousPermission: Permissions = {
      install_permission: PermissionType.admin,
      debug_permission: PermissionType.admin,
    }
    const nextPermission: Permissions = {
      install_permission: PermissionType.everyone,
      debug_permission: PermissionType.admin,
    }
    let rejectPost: (reason?: unknown) => void = () => {}
    vi.mocked(post).mockReturnValue(new Promise((_resolve, reject) => {
      rejectPost = reject
    }) as ReturnType<typeof post>)
    queryClient.setQueryData(queryKey, previousPermission)

    const { result } = renderHook(
      () => useMutationPluginPermissionSettings(),
      { wrapper: createWrapper(queryClient) },
    )

    const mutation = result.current.mutateAsync(nextPermission).catch(() => undefined)

    await waitFor(() => {
      expect(queryClient.getQueryData(queryKey)).toEqual(nextPermission)
    })

    rejectPost(new Error('permission update failed'))

    await waitFor(() => {
      expect(queryClient.getQueryData(queryKey)).toEqual(previousPermission)
    })
    await mutation
  })
})

describe('usePluginAutoUpgradeSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not expose frontend default settings before backend data resolves', () => {
    const queryClient = createQueryClient()
    vi.mocked(get).mockReturnValue(new Promise(() => {}) as ReturnType<typeof get>)

    const { result } = renderHook(
      () => usePluginAutoUpgradeSettings(PluginCategoryEnum.model),
      { wrapper: createWrapper(queryClient) },
    )

    expect(result.current.data).toBeUndefined()
    expect(get).toHaveBeenCalledWith('/workspaces/current/plugin/auto-upgrade/fetch', {
      params: {
        category: PluginCategoryEnum.model,
      },
    })
  })

  it('returns backend auto-upgrade settings when the request resolves', async () => {
    const queryClient = createQueryClient()
    const backendAutoUpgrade = {
      strategy_setting: AUTO_UPDATE_STRATEGY.fixOnly,
      upgrade_time_of_day: 0,
      upgrade_mode: AUTO_UPDATE_MODE.exclude,
      exclude_plugins: [],
      include_plugins: [],
    }
    vi.mocked(get).mockResolvedValue({
      category: PluginCategoryEnum.tool,
      auto_upgrade: backendAutoUpgrade,
    })

    const { result } = renderHook(
      () => usePluginAutoUpgradeSettings(PluginCategoryEnum.tool),
      { wrapper: createWrapper(queryClient) },
    )

    await waitFor(() => {
      expect(result.current.data).toEqual({
        category: PluginCategoryEnum.tool,
        auto_upgrade: backendAutoUpgrade,
      })
    })
  })
})
