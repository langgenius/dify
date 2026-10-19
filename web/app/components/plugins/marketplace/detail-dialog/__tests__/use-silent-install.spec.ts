import type { Plugin } from '@/app/components/plugins/types'
import { act, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { PluginCategoryEnum, TaskStatus } from '@/app/components/plugins/types'
import { renderHookWithConsoleQuery as renderHook } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { useSilentMarketplaceInstall } from '../use-silent-install'

const mockInstallPackageFromMarketPlace = vi.fn()
const mockRefreshPluginList = vi.fn()
const mockCheckTaskStatus = vi.fn()

vi.mock('@/app/components/plugins/install-plugin/hooks/use-refresh-plugin-list', () => ({
  default: () => ({ refreshPluginList: mockRefreshPluginList }),
}))

vi.mock('@/service/plugins', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/plugins')>()),
  checkTaskStatus: (...args: unknown[]) => mockCheckTaskStatus(...args),
}))

const plugin = {
  type: 'plugin',
  org: 'dify',
  name: 'plugin-a',
  plugin_id: 'dify/plugin-a',
  latest_package_identifier: 'dify/plugin-a:1.0.0@pkg',
  category: PluginCategoryEnum.tool,
} as Plugin

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'workspaces.current.plugin.install.marketplace.post': (...args: unknown[]) =>
        mockInstallPackageFromMarketPlace(...args),
    }),
  }
})

describe('useSilentMarketplaceInstall', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockInstallPackageFromMarketPlace.mockResolvedValue({
      all_installed: true,
      task_id: '',
    })
  })

  it('shares a pending package request and refreshes once after immediate success', async () => {
    const pending = createDeferred<{ all_installed: boolean; task_id: string }>()
    mockInstallPackageFromMarketPlace.mockReturnValueOnce(pending.promise)
    const { result } = renderHook(() => useSilentMarketplaceInstall())

    const first = result.current.install(plugin)
    const second = result.current.install(plugin)
    await waitFor(() =>
      expect(mockInstallPackageFromMarketPlace).toHaveBeenCalledExactlyOnceWith({
        body: { plugin_unique_identifiers: [plugin.latest_package_identifier] },
      }),
    )
    expect(mockRefreshPluginList).not.toHaveBeenCalled()
    await act(async () => {
      pending.resolve({ all_installed: true, task_id: '' })
      await expect(first).resolves.toEqual({ status: 'success' })
      await expect(second).resolves.toEqual({ status: 'success' })
    })
    expect(mockCheckTaskStatus).not.toHaveBeenCalled()
    expect(mockRefreshPluginList).toHaveBeenCalledExactlyOnceWith(plugin)
  })

  it('refreshes only after the requested package succeeds in the install task', async () => {
    mockInstallPackageFromMarketPlace.mockResolvedValue({
      all_installed: false,
      task_id: 'task-2',
    })
    const pending = createDeferred<{
      task: { plugins: { plugin_unique_identifier: string; status: TaskStatus }[] }
    }>()
    mockCheckTaskStatus.mockReturnValueOnce(pending.promise)
    const { result } = renderHook(() => useSilentMarketplaceInstall())
    const installed = result.current.install(plugin)
    await waitFor(() => expect(mockCheckTaskStatus).toHaveBeenCalledExactlyOnceWith('task-2'))
    expect(mockRefreshPluginList).not.toHaveBeenCalled()

    await act(async () => {
      pending.resolve({
        task: {
          plugins: [
            { plugin_unique_identifier: 'other-plugin', status: TaskStatus.failed },
            {
              plugin_unique_identifier: plugin.latest_package_identifier,
              status: TaskStatus.success,
            },
          ],
        },
      })
      await expect(installed).resolves.toEqual({ status: 'success' })
    })
    expect(mockRefreshPluginList).toHaveBeenCalledExactlyOnceWith(plugin)
  })

  it('returns the task error when installation fails', async () => {
    mockInstallPackageFromMarketPlace.mockResolvedValue({
      all_installed: false,
      task_id: 'task-3',
    })
    mockCheckTaskStatus.mockResolvedValue({
      task: {
        plugins: [
          {
            plugin_unique_identifier: plugin.latest_package_identifier,
            status: TaskStatus.failed,
            message: 'Package not found',
          },
        ],
      },
    })
    const { result } = renderHook(() => useSilentMarketplaceInstall())

    await expect(result.current.install(plugin)).resolves.toEqual({
      status: 'failed',
      error: 'Package not found',
    })
    expect(mockRefreshPluginList).not.toHaveBeenCalled()
  })
})
