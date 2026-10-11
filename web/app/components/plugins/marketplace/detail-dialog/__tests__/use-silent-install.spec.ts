import type { Plugin } from '@/app/components/plugins/types'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { PluginCategoryEnum, TaskStatus } from '@/app/components/plugins/types'
import { useSilentMarketplaceInstall } from '../use-silent-install'

const mockInstallPackageFromMarketPlace = vi.fn()
const mockRefreshPluginList = vi.fn()
const mockCheckTaskStatus = vi.fn()

vi.mock('@/service/use-plugins', () => ({
  useInstallPackageFromMarketPlace: () => ({
    mutateAsync: mockInstallPackageFromMarketPlace,
  }),
}))

vi.mock('@/app/components/plugins/install-plugin/hooks/use-refresh-plugin-list', () => ({
  default: () => ({ refreshPluginList: mockRefreshPluginList }),
}))

vi.mock('@/app/components/plugins/install-plugin/base/check-task-status', () => ({
  default: () => ({
    check: mockCheckTaskStatus,
    stop: vi.fn(),
  }),
}))

const plugin = {
  type: 'plugin',
  org: 'dify',
  name: 'plugin-a',
  plugin_id: 'dify/plugin-a',
  latest_package_identifier: 'dify/plugin-a:1.0.0@pkg',
  category: PluginCategoryEnum.tool,
} as Plugin

describe('useSilentMarketplaceInstall', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockInstallPackageFromMarketPlace.mockResolvedValue({
      all_installed: true,
      task_id: 'task-1',
    })
    mockCheckTaskStatus.mockResolvedValue({ status: TaskStatus.success })
  })

  it('installs immediately when the marketplace package is already fully installed', async () => {
    const { result } = renderHook(() => useSilentMarketplaceInstall())

    await expect(result.current.install(plugin)).resolves.toEqual({ status: 'success' })
    expect(mockInstallPackageFromMarketPlace).toHaveBeenCalledWith(plugin.latest_package_identifier)
    expect(mockCheckTaskStatus).not.toHaveBeenCalled()
    expect(mockRefreshPluginList).toHaveBeenCalledWith(plugin)
  })

  it('waits for the install task instead of showing a confirmation step', async () => {
    mockInstallPackageFromMarketPlace.mockResolvedValue({
      all_installed: false,
      task_id: 'task-2',
    })
    const { result } = renderHook(() => useSilentMarketplaceInstall())

    await expect(result.current.install(plugin)).resolves.toEqual({ status: 'success' })
    expect(mockCheckTaskStatus).toHaveBeenCalledWith({
      taskId: 'task-2',
      pluginUniqueIdentifier: plugin.latest_package_identifier,
    })
    expect(mockRefreshPluginList).toHaveBeenCalledWith(plugin)
  })

  it('returns the task error when installation fails', async () => {
    mockInstallPackageFromMarketPlace.mockResolvedValue({
      all_installed: false,
      task_id: 'task-3',
    })
    mockCheckTaskStatus.mockResolvedValue({
      status: TaskStatus.failed,
      error: 'Package not found',
    })
    const { result } = renderHook(() => useSilentMarketplaceInstall())

    await expect(result.current.install(plugin)).resolves.toEqual({
      status: 'failed',
      error: 'Package not found',
    })
    expect(mockRefreshPluginList).not.toHaveBeenCalled()
  })

  it('reuses an in-flight install instead of starting a second package request', async () => {
    let resolveInstall: ((value: { all_installed: boolean; task_id: string }) => void) | undefined
    mockInstallPackageFromMarketPlace.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveInstall = resolve
        }),
    )
    const { result } = renderHook(() => useSilentMarketplaceInstall())

    const first = result.current.install(plugin)
    const second = result.current.install(plugin)

    expect(mockInstallPackageFromMarketPlace).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveInstall?.({ all_installed: true, task_id: 'task-4' })
      await expect(first).resolves.toEqual({ status: 'success' })
      await expect(second).resolves.toEqual({ status: 'success' })
    })
  })
})
