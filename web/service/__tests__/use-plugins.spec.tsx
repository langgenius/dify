import type { ReactNode } from 'react'
import type { Permissions, PluginTaskStart } from '@/app/components/plugins/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AUTO_UPDATE_MODE, AUTO_UPDATE_STRATEGY } from '@/app/components/plugins/reference-setting-modal/auto-update-setting/types'
import { PermissionType, PluginCategoryEnum, PluginSource, TaskStatus } from '@/app/components/plugins/types'
import {
  useInstalledPluginList,
  useMutationPluginAutoUpgradeSettings,
  useMutationPluginPermissionSettings,
  usePluginAutoUpgradeSettings,
  usePluginTaskList,
} from '../use-plugins'

const {
  mockGet,
  mockPost,
} = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockPost: vi.fn(),
}))

vi.mock('@/service/base', () => ({
  get: mockGet,
  getMarketplace: vi.fn(),
  post: mockPost,
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
    workspacePermissionKeys: ['plugin.install'],
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
    mockPost.mockReturnValue(new Promise((resolve) => {
      resolvePost = resolve
    }))
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
      expect(mockPost).toHaveBeenCalledWith('/workspaces/current/plugin/auto-upgrade/change', {
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
    mockPost.mockReturnValue(new Promise((resolve) => {
      resolvePost = resolve
    }))
    queryClient.setQueryData(queryKey, previousPermission)

    const { result } = renderHook(
      () => useMutationPluginPermissionSettings(),
      { wrapper: createWrapper(queryClient) },
    )

    act(() => {
      result.current.mutate(nextPermission)
    })

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/workspaces/current/plugin/permission/change', {
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
    mockPost.mockReturnValue(new Promise((_resolve, reject) => {
      rejectPost = reject
    }))
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
    mockPost.mockReturnValue(new Promise((_resolve, reject) => {
      rejectPost = reject
    }))

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
    mockPost.mockReturnValue(new Promise((_resolve, reject) => {
      rejectPost = reject
    }))
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

describe('useInstalledPluginList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches the default installed plugin list when no category is provided', async () => {
    const queryClient = createQueryClient()
    mockGet.mockResolvedValue({ plugins: [], total: 0 })

    renderHook(
      () => useInstalledPluginList(false, 100),
      { wrapper: createWrapper(queryClient) },
    )

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith('/workspaces/current/plugin/list?page=1&page_size=100')
    })
  })

  it('fetches the scoped installed plugin category list when category is provided', async () => {
    const queryClient = createQueryClient()
    mockGet.mockResolvedValue({ plugins: [], has_more: false })

    renderHook(
      () => useInstalledPluginList(false, 100, { category: PluginCategoryEnum.trigger }),
      { wrapper: createWrapper(queryClient) },
    )

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith('/workspaces/current/plugin/trigger/list?page=1&page_size=100')
    })
  })

  it('keeps builtin tools from the scoped tool plugin category response', async () => {
    const queryClient = createQueryClient()
    const builtinTools = [
      {
        id: 'builtin-tool',
        name: 'builtin-tool',
        label: { en_US: 'Builtin Tool', zh_Hans: 'Builtin Tool' },
        description: { en_US: 'Builtin Tool description', zh_Hans: 'Builtin Tool description' },
        author: 'Dify',
        icon: '',
        type: 'builtin',
        team_credentials: {},
        is_team_authorization: false,
        allow_delete: false,
        labels: [],
      },
    ]
    mockGet.mockResolvedValue({ plugins: [], builtin_tools: builtinTools, has_more: false })

    const { result } = renderHook(
      () => useInstalledPluginList(false, 100, { category: PluginCategoryEnum.tool }),
      { wrapper: createWrapper(queryClient) },
    )

    await waitFor(() => {
      expect(result.current.data?.builtin_tools).toEqual(builtinTools)
    })
  })

  it('uses has_more to load the next scoped plugin category page', async () => {
    const queryClient = createQueryClient()
    mockGet
      .mockResolvedValueOnce({
        plugins: [
          { plugin_id: 'trigger-plugin-1' },
        ],
        has_more: true,
      })
      .mockResolvedValueOnce({
        plugins: [
          { plugin_id: 'trigger-plugin-2' },
        ],
        has_more: false,
      })

    const { result } = renderHook(
      () => useInstalledPluginList(false, 100, { category: PluginCategoryEnum.trigger }),
      { wrapper: createWrapper(queryClient) },
    )

    await waitFor(() => {
      expect(result.current.isLastPage).toBe(false)
    })

    act(() => {
      result.current.loadNextPage()
    })

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith('/workspaces/current/plugin/trigger/list?page=2&page_size=100')
    })
    await waitFor(() => {
      expect(result.current.isLastPage).toBe(true)
    })
  })

  it('keeps builtin tools from the first scoped tool plugin page when loading more pages', async () => {
    const queryClient = createQueryClient()
    const builtinTools = [
      {
        id: 'builtin-tool',
        name: 'builtin-tool',
        label: { en_US: 'Builtin Tool', zh_Hans: 'Builtin Tool' },
        description: { en_US: 'Builtin Tool description', zh_Hans: 'Builtin Tool description' },
        author: 'Dify',
        icon: '',
        type: 'builtin',
        team_credentials: {},
        is_team_authorization: false,
        allow_delete: false,
        labels: [],
      },
    ]
    mockGet
      .mockResolvedValueOnce({
        plugins: [
          { plugin_id: 'tool-plugin-1' },
        ],
        builtin_tools: builtinTools,
        has_more: true,
      })
      .mockResolvedValueOnce({
        plugins: [
          { plugin_id: 'tool-plugin-2' },
        ],
        builtin_tools: builtinTools,
        has_more: false,
      })

    const { result } = renderHook(
      () => useInstalledPluginList(false, 100, { category: PluginCategoryEnum.tool }),
      { wrapper: createWrapper(queryClient) },
    )

    await waitFor(() => {
      expect(result.current.isLastPage).toBe(false)
    })

    act(() => {
      result.current.loadNextPage()
    })

    await waitFor(() => {
      expect(result.current.data?.plugins).toEqual([
        { plugin_id: 'tool-plugin-1' },
        { plugin_id: 'tool-plugin-2' },
      ])
    })
    expect(result.current.data?.builtin_tools).toEqual(builtinTools)
  })
})

describe('usePluginTaskList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('adds the task from an install start response to the task list cache', async () => {
    const queryClient = createQueryClient()
    queryClient.setQueryData(['plugins', 'referenceSettings', 'permission'], {
      install_permission: PermissionType.admin,
      debug_permission: PermissionType.admin,
    })
    mockGet.mockResolvedValue({ tasks: [] })

    const startedTask: PluginTaskStart = {
      id: 'task-new',
      created_at: '2026-06-05T03:34:59.578653Z',
      updated_at: '2026-06-05T03:34:59.578653Z',
      status: 'running',
      total_plugins: 1,
      completed_plugins: 0,
      plugins: [
        {
          plugin_unique_identifier: 'langgenius/gitlab_datasource:0.3.11@test',
          plugin_id: 'langgenius/gitlab_datasource',
          status: TaskStatus.running,
          message: '',
          icon: 'gitlab.png',
          labels: {
            en_US: 'GitLab',
          } as PluginTaskStart['plugins'][number]['labels'],
          source: PluginSource.marketplace,
        },
      ],
    }

    const { result } = renderHook(
      () => usePluginTaskList(PluginCategoryEnum.tool),
      { wrapper: createWrapper(queryClient) },
    )

    act(() => {
      result.current.handleInstallTaskStart({
        all_installed: false,
        task_id: 'task-new',
        plugin_unique_identifier: 'langgenius/gitlab_datasource:0.3.11@test',
        task: startedTask,
      })
    })

    expect(queryClient.getQueryData(['plugins', 'pluginTaskList'])).toEqual({
      tasks: [
        {
          ...startedTask,
          plugins: [
            {
              ...startedTask.plugins[0],
              taskId: 'task-new',
            },
          ],
        },
      ],
    })
  })

  it('replaces an existing task with the latest start response task data', () => {
    const queryClient = createQueryClient()
    queryClient.setQueryData(['plugins', 'referenceSettings', 'permission'], {
      install_permission: PermissionType.admin,
      debug_permission: PermissionType.admin,
    })
    queryClient.setQueryData(['plugins', 'pluginTaskList'], {
      tasks: [
        {
          id: 'task-new',
          created_at: '2026-06-05T03:34:59.578653Z',
          updated_at: '2026-06-05T03:34:59.578653Z',
          status: 'running',
          total_plugins: 1,
          completed_plugins: 0,
          plugins: [],
        },
        {
          id: 'task-old',
          created_at: '2026-06-04T03:34:59.578653Z',
          updated_at: '2026-06-04T03:34:59.578653Z',
          status: 'success',
          total_plugins: 1,
          completed_plugins: 1,
          plugins: [],
        },
      ],
    })
    mockGet.mockResolvedValue({ tasks: [] })

    const { result } = renderHook(
      () => usePluginTaskList(PluginCategoryEnum.tool),
      { wrapper: createWrapper(queryClient) },
    )

    act(() => {
      result.current.handleInstallTaskStart({
        all_installed: false,
        task_id: 'task-new',
        plugin_unique_identifier: 'langgenius/gitlab_datasource:0.3.11@test',
        task: {
          id: 'task-new',
          created_at: '2026-06-05T03:34:59.578653Z',
          updated_at: '2026-06-05T03:35:59.578653Z',
          status: 'success',
          total_plugins: 1,
          completed_plugins: 1,
          plugins: [],
        },
      })
    })

    expect(queryClient.getQueryData(['plugins', 'pluginTaskList'])).toEqual({
      tasks: [
        {
          id: 'task-new',
          created_at: '2026-06-05T03:34:59.578653Z',
          updated_at: '2026-06-05T03:35:59.578653Z',
          status: 'success',
          total_plugins: 1,
          completed_plugins: 1,
          plugins: [],
        },
        {
          id: 'task-old',
          created_at: '2026-06-04T03:34:59.578653Z',
          updated_at: '2026-06-04T03:34:59.578653Z',
          status: 'success',
          total_plugins: 1,
          completed_plugins: 1,
          plugins: [],
        },
      ],
    })
  })

  it('keeps a locally started unfinished task when an immediate refetch returns a stale task list', async () => {
    const queryClient = createQueryClient()
    queryClient.setQueryData(['plugins', 'referenceSettings', 'permission'], {
      install_permission: PermissionType.admin,
      debug_permission: PermissionType.admin,
    })
    const staleTask = {
      id: 'task-old',
      created_at: '2026-06-04T03:34:59.578653Z',
      updated_at: '2026-06-04T03:34:59.578653Z',
      status: TaskStatus.success,
      total_plugins: 1,
      completed_plugins: 1,
      plugins: [],
    }
    mockGet.mockResolvedValue({ tasks: [staleTask] })
    const startedTask: PluginTaskStart = {
      id: 'task-new',
      created_at: '2026-06-05T03:34:59.578653Z',
      updated_at: '2026-06-05T03:34:59.578653Z',
      status: TaskStatus.running,
      total_plugins: 1,
      completed_plugins: 0,
      plugins: [
        {
          plugin_unique_identifier: 'langgenius/gitlab_datasource:0.3.11@test',
          plugin_id: 'langgenius/gitlab_datasource',
          status: TaskStatus.pending,
          message: '',
          icon: 'gitlab.png',
          labels: {
            en_US: 'GitLab',
          } as PluginTaskStart['plugins'][number]['labels'],
          source: PluginSource.marketplace,
        },
      ],
    }

    const { result } = renderHook(
      () => usePluginTaskList(PluginCategoryEnum.tool),
      { wrapper: createWrapper(queryClient) },
    )

    await waitFor(() => {
      expect(queryClient.getQueryData(['plugins', 'pluginTaskList'])).toEqual({ tasks: [staleTask] })
    })

    act(() => {
      result.current.handleInstallTaskStart({
        all_installed: false,
        task_id: 'task-new',
        task: startedTask,
      })
    })

    await waitFor(() => {
      expect(queryClient.getQueryData(['plugins', 'pluginTaskList'])).toEqual({
        tasks: [
          {
            ...startedTask,
            plugins: [
              {
                ...startedTask.plugins[0],
                taskId: 'task-new',
              },
            ],
          },
          staleTask,
        ],
      })
    })
  })
})

describe('usePluginAutoUpgradeSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not expose frontend default settings before backend data resolves', () => {
    const queryClient = createQueryClient()
    mockGet.mockReturnValue(new Promise(() => {}))

    const { result } = renderHook(
      () => usePluginAutoUpgradeSettings(PluginCategoryEnum.model),
      { wrapper: createWrapper(queryClient) },
    )

    expect(result.current.data).toBeUndefined()
    expect(mockGet).toHaveBeenCalledWith('/workspaces/current/plugin/auto-upgrade/fetch', {
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
    mockGet.mockResolvedValue({
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
