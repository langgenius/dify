import type { ConsoleStateFixture } from '@/test/console/state-fixture'
import { act, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { toast } from '@/app/notifications'
import { renderHookWithConsoleQuery } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { PermissionType, PluginCategoryEnum } from '../../types'
import useReferenceSetting, { useCanInstallPluginFromMarketplace } from '../use-reference-setting'

let consoleState: ConsoleStateFixture = {}

vi.mock('@/context/workspace-state', async () => {
  const { createWorkspaceStateModuleMock } = await import('@/test/console/state-fixture')
  return createWorkspaceStateModuleMock(() => consoleState)
})
vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')
  return createPermissionStateModuleMock(() => consoleState)
})

const requests = vi.hoisted(() => ({
  getAutoUpgrade: vi.fn(),
  getPermission: vi.fn(),
  autoUpgrade: vi.fn(),
  permission: vi.fn(),
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'workspaces.current.plugin.autoUpgrade.fetch.get': requests.getAutoUpgrade,
      'workspaces.current.plugin.permission.fetch.get': requests.getPermission,
      'workspaces.current.plugin.autoUpgrade.change.post': requests.autoUpgrade,
      'workspaces.current.plugin.permission.change.post': requests.permission,
    }),
  }
})

const autoUpgrade = {
  strategy_setting: 'fix_only' as const,
  upgrade_time_of_day: 0,
  upgrade_mode: 'all' as const,
  exclude_plugins: [],
  include_plugins: [],
}
const permissions: { install_permission: PermissionType; debug_permission: PermissionType } = {
  install_permission: PermissionType.everyone,
  debug_permission: PermissionType.everyone,
}
const allKeys = ['plugin.install', 'plugin.delete', 'plugin.debug', 'plugin.plugin_preferences']
const toastSuccess = vi.spyOn(toast, 'success').mockReturnValue('toast-success')

beforeEach(() => {
  vi.clearAllMocks()
  consoleState = { workspacePermissionKeys: [] }
  requests.getPermission.mockResolvedValue(permissions)
  requests.getAutoUpgrade.mockResolvedValue({
    category: PluginCategoryEnum.tool,
    auto_upgrade: autoUpgrade,
  })
  requests.autoUpgrade.mockResolvedValue({})
  requests.permission.mockResolvedValue({})
})

describe('plugin settings access', () => {
  it.each([
    {
      name: 'legacy access with all keys',
      rbac: false,
      keys: allKeys,
      legacy: PermissionType.everyone,
      manager: false,
      owner: false,
      install: true,
      debug: true,
    },
    {
      name: 'legacy install still requires a key',
      rbac: false,
      keys: [],
      legacy: PermissionType.everyone,
      manager: false,
      owner: false,
      install: false,
      debug: true,
    },
    {
      name: 'legacy noOne blocks even managers',
      rbac: false,
      keys: allKeys,
      legacy: PermissionType.noOne,
      manager: true,
      owner: false,
      install: false,
      debug: false,
    },
    {
      name: 'legacy admin grants managers debug access',
      rbac: false,
      keys: [],
      legacy: PermissionType.admin,
      manager: true,
      owner: false,
      install: false,
      debug: true,
    },
    {
      name: 'legacy admin grants owners debug access',
      rbac: false,
      keys: [],
      legacy: PermissionType.admin,
      manager: false,
      owner: true,
      install: false,
      debug: true,
    },
    {
      name: 'legacy admin excludes members',
      rbac: false,
      keys: allKeys,
      legacy: PermissionType.admin,
      manager: false,
      owner: false,
      install: false,
      debug: false,
    },
    {
      name: 'RBAC keys override legacy noOne',
      rbac: true,
      keys: allKeys,
      legacy: PermissionType.noOne,
      manager: false,
      owner: false,
      install: true,
      debug: true,
    },
    {
      name: 'RBAC excludes managers without keys',
      rbac: true,
      keys: [],
      legacy: PermissionType.everyone,
      manager: true,
      owner: false,
      install: false,
      debug: false,
    },
  ])('$name', async ({ rbac, keys, legacy, manager, owner, install, debug }) => {
    consoleState = {
      workspacePermissionKeys: keys,
      isCurrentWorkspaceManager: manager,
      isCurrentWorkspaceOwner: owner,
    }
    requests.getPermission.mockResolvedValue({
      install_permission: legacy,
      debug_permission: legacy,
    })
    const { result } = renderHookWithConsoleQuery(
      () => useReferenceSetting(PluginCategoryEnum.tool),
      {
        systemFeatures: { rbac_enabled: rbac },
      },
    )
    await waitFor(() => expect(result.current.isPermissionLoading).toBe(false))
    expect(result.current).toMatchObject({
      canInstallPlugin: install,
      canManagement: install,
      canUpdatePlugin: install,
      canDeletePlugin: install && keys.includes('plugin.delete'),
      canDebugPlugin: debug,
      canDebugger: debug,
      canSetPluginPreferences: keys.includes('plugin.plugin_preferences'),
      canSetPermissions: !rbac && keys.includes('plugin.plugin_preferences'),
    })
  })

  it('keeps install and delete permissions independent', async () => {
    consoleState = { workspacePermissionKeys: ['plugin.install'] }
    const { result } = renderHookWithConsoleQuery(() =>
      useReferenceSetting(PluginCategoryEnum.tool),
    )
    await waitFor(() => expect(result.current.isPermissionLoading).toBe(false))
    expect(result.current.canInstallPlugin).toBe(true)
    expect(result.current.canDeletePlugin).toBe(false)
  })

  it('allows permission-based actions while auto-upgrade settings are loading', async () => {
    consoleState = { workspacePermissionKeys: ['plugin.install', 'plugin.debug'] }
    requests.getAutoUpgrade.mockReturnValue(new Promise(() => {}))
    const { result } = renderHookWithConsoleQuery(() =>
      useReferenceSetting(PluginCategoryEnum.tool),
    )
    await waitFor(() => expect(result.current.isPermissionLoading).toBe(false))
    expect(result.current.referenceSetting).toBeUndefined()
    expect(result.current.isReferenceSettingLoading).toBe(true)
    expect(result.current.canManagement).toBe(true)
    expect(result.current.canDebugger).toBe(true)
  })

  it.each(['isLoadingWorkspacePermissionKeys', 'isLoadingCurrentWorkspace'] as const)(
    'stays loading while %s is true',
    async (loadingKey) => {
      consoleState = { [loadingKey]: true, workspacePermissionKeys: [] }
      const { result } = renderHookWithConsoleQuery(() =>
        useReferenceSetting(PluginCategoryEnum.tool),
      )
      await waitFor(() => expect(result.current.referenceSetting).toBeDefined())
      expect(result.current.isPermissionLoading).toBe(true)
      expect(result.current.canInstallPlugin).toBe(false)
    },
  )
})

describe('saving reference settings', () => {
  it('submits only changed settings and refreshes server data after the pending save completes', async () => {
    const request = createDeferred<object>()
    requests.autoUpgrade.mockReturnValueOnce(request.promise)
    const { result } = renderHookWithConsoleQuery(() =>
      useReferenceSetting(PluginCategoryEnum.tool),
    )
    await waitFor(() =>
      expect(result.current.referenceSetting).toEqual({
        permission: permissions,
        auto_upgrade: autoUpgrade,
      }),
    )
    const updated = { ...autoUpgrade, strategy_setting: 'latest' as const }
    act(() =>
      result.current.setReferenceSettings({ permission: permissions, auto_upgrade: updated }),
    )
    await waitFor(() => expect(result.current.isUpdatePending).toBe(true))
    expect(requests.autoUpgrade).toHaveBeenCalledWith({
      body: { category: 'tool', auto_upgrade: updated },
    })
    expect(requests.permission).not.toHaveBeenCalled()
    expect(toastSuccess).not.toHaveBeenCalled()
    requests.getAutoUpgrade.mockResolvedValue({
      category: PluginCategoryEnum.tool,
      auto_upgrade: updated,
    })
    request.resolve({})
    await waitFor(() => expect(result.current.isUpdatePending).toBe(false))
    await waitFor(() => expect(requests.getAutoUpgrade).toHaveBeenCalledTimes(2))
    expect(result.current.referenceSetting).toEqual({
      permission: permissions,
      auto_upgrade: updated,
    })
    expect(toastSuccess).toHaveBeenCalledWith('common.api.actionSuccess')
  })
})

describe('marketplace install access', () => {
  it.each([
    {
      marketplace: true,
      keys: ['plugin.install'],
      legacy: PermissionType.everyone,
      rbac: false,
      allowed: true,
    },
    {
      marketplace: false,
      keys: ['plugin.install'],
      legacy: PermissionType.everyone,
      rbac: false,
      allowed: false,
    },
    { marketplace: true, keys: [], legacy: PermissionType.everyone, rbac: false, allowed: false },
    {
      marketplace: true,
      keys: ['plugin.install'],
      legacy: PermissionType.noOne,
      rbac: false,
      allowed: false,
    },
    {
      marketplace: true,
      keys: ['plugin.install'],
      legacy: PermissionType.noOne,
      rbac: true,
      allowed: true,
    },
  ])(
    'marketplace=$marketplace, keys=$keys, legacy=$legacy, RBAC=$rbac → $allowed',
    async ({ marketplace, keys, legacy, rbac, allowed }) => {
      consoleState = { workspacePermissionKeys: keys }
      const response = createDeferred<typeof permissions>()
      requests.getPermission.mockReturnValueOnce(response.promise)
      const { result } = renderHookWithConsoleQuery(() => useCanInstallPluginFromMarketplace(), {
        systemFeatures: { enable_marketplace: marketplace, rbac_enabled: rbac },
      })
      await act(async () =>
        response.resolve({ install_permission: legacy, debug_permission: legacy }),
      )
      await waitFor(() => expect(result.current.canInstallPluginFromMarketplace).toBe(allowed))
      expect(requests.getPermission).toHaveBeenCalledOnce()
      expect(requests.getAutoUpgrade).not.toHaveBeenCalled()
    },
  )
})
