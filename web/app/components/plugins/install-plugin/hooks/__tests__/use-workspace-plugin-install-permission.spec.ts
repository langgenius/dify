import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHookWithSystemFeatures as renderHook } from '@/__tests__/utils/mock-system-features'
import { PermissionType } from '@/app/components/plugins/types'
import { usePluginPermissionSettings } from '@/service/use-plugins'
import useWorkspacePluginInstallPermission from '../use-workspace-plugin-install-permission'

let mockWorkspacePermissionKeys: string[] = []
let mockIsCurrentWorkspaceManager = false
let mockIsCurrentWorkspaceOwner = false

vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    isCurrentWorkspaceManager: mockIsCurrentWorkspaceManager,
    isCurrentWorkspaceOwner: mockIsCurrentWorkspaceOwner,
    langGeniusVersionInfo: { current_version: '1.0.0' },
    workspacePermissionKeys: mockWorkspacePermissionKeys,
  }),
}))

vi.mock('@/service/use-plugins', () => ({
  usePluginPermissionSettings: vi.fn(),
}))

describe('useWorkspacePluginInstallPermission', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWorkspacePermissionKeys = []
    mockIsCurrentWorkspaceManager = false
    mockIsCurrentWorkspaceOwner = false
    vi.mocked(usePluginPermissionSettings).mockReturnValue({
      data: {
        install_permission: PermissionType.everyone,
        debug_permission: PermissionType.everyone,
      },
    } as ReturnType<typeof usePluginPermissionSettings>)
  })

  it('should grant install and update capabilities with plugin.install', () => {
    mockWorkspacePermissionKeys = ['plugin.install']

    const { result } = renderHook(() => useWorkspacePluginInstallPermission())

    expect(result.current.canInstallPlugin).toBe(true)
    expect(result.current.canUpdatePlugin).toBe(true)
    expect(result.current.canViewInstalledPlugins).toBe(true)
    expect(result.current.canManagePlugin).toBe(false)
    expect(result.current.canDebugPlugin).toBe(false)
    expect(result.current.canSetPluginPreferences).toBe(false)
  })

  it('should grant update, view, and manage capabilities but not install with plugin.manage', () => {
    mockWorkspacePermissionKeys = ['plugin.manage']

    const { result } = renderHook(() => useWorkspacePluginInstallPermission())

    expect(result.current.canInstallPlugin).toBe(false)
    expect(result.current.canUpdatePlugin).toBe(true)
    expect(result.current.canViewInstalledPlugins).toBe(true)
    expect(result.current.canManagePlugin).toBe(true)
    expect(result.current.canDebugPlugin).toBe(false)
    expect(result.current.canSetPluginPreferences).toBe(false)
  })

  it('should grant plugin debug capability with plugin.debug', () => {
    mockWorkspacePermissionKeys = ['plugin.debug']

    const { result } = renderHook(() => useWorkspacePluginInstallPermission())

    expect(result.current.canInstallPlugin).toBe(false)
    expect(result.current.canUpdatePlugin).toBe(false)
    expect(result.current.canViewInstalledPlugins).toBe(false)
    expect(result.current.canManagePlugin).toBe(false)
    expect(result.current.canDebugPlugin).toBe(true)
    expect(result.current.canSetPluginPreferences).toBe(false)
  })

  it('should grant plugin preference setting capability with plugin.plugin_preferences', () => {
    mockWorkspacePermissionKeys = ['plugin.plugin_preferences']

    const { result } = renderHook(() => useWorkspacePluginInstallPermission())

    expect(result.current.canInstallPlugin).toBe(false)
    expect(result.current.canUpdatePlugin).toBe(false)
    expect(result.current.canViewInstalledPlugins).toBe(false)
    expect(result.current.canManagePlugin).toBe(false)
    expect(result.current.canDebugPlugin).toBe(false)
    expect(result.current.canSetPluginPreferences).toBe(true)
  })

  it('should deny plugin capabilities without plugin install or manage permissions', () => {
    const { result } = renderHook(() => useWorkspacePluginInstallPermission())

    expect(result.current.canInstallPlugin).toBe(false)
    expect(result.current.canUpdatePlugin).toBe(false)
    expect(result.current.canViewInstalledPlugins).toBe(false)
    expect(result.current.canManagePlugin).toBe(false)
    expect(result.current.canDebugPlugin).toBe(false)
    expect(result.current.canSetPluginPreferences).toBe(false)
  })

  it('should deny install, update, manage, and debug when legacy plugin permissions are noOne and RBAC is disabled', () => {
    mockWorkspacePermissionKeys = ['plugin.install', 'plugin.manage', 'plugin.debug']
    mockIsCurrentWorkspaceManager = true
    vi.mocked(usePluginPermissionSettings).mockReturnValue({
      data: {
        install_permission: PermissionType.noOne,
        debug_permission: PermissionType.noOne,
      },
    } as ReturnType<typeof usePluginPermissionSettings>)

    const { result } = renderHook(() => useWorkspacePluginInstallPermission(), {
      systemFeatures: { rbac_enabled: false },
    })

    expect(result.current.canInstallPlugin).toBe(false)
    expect(result.current.canUpdatePlugin).toBe(false)
    expect(result.current.canViewInstalledPlugins).toBe(true)
    expect(result.current.canManagePlugin).toBe(false)
    expect(result.current.canDebugPlugin).toBe(false)
  })

  it('should deny plugin actions until legacy plugin permissions are available when RBAC is disabled', () => {
    mockWorkspacePermissionKeys = ['plugin.install', 'plugin.manage', 'plugin.debug']
    mockIsCurrentWorkspaceManager = true
    vi.mocked(usePluginPermissionSettings).mockReturnValue({
      data: undefined,
    } as ReturnType<typeof usePluginPermissionSettings>)

    const { result } = renderHook(() => useWorkspacePluginInstallPermission(), {
      systemFeatures: { rbac_enabled: false },
    })

    expect(result.current.canInstallPlugin).toBe(false)
    expect(result.current.canUpdatePlugin).toBe(false)
    expect(result.current.canManagePlugin).toBe(false)
    expect(result.current.canDebugPlugin).toBe(false)
  })

  it('should ignore legacy plugin permissions when RBAC is enabled', () => {
    mockWorkspacePermissionKeys = ['plugin.install', 'plugin.manage', 'plugin.debug']
    vi.mocked(usePluginPermissionSettings).mockReturnValue({
      data: {
        install_permission: PermissionType.noOne,
        debug_permission: PermissionType.noOne,
      },
    } as ReturnType<typeof usePluginPermissionSettings>)

    const { result } = renderHook(() => useWorkspacePluginInstallPermission(), {
      systemFeatures: { rbac_enabled: true },
    })

    expect(result.current.canInstallPlugin).toBe(true)
    expect(result.current.canUpdatePlugin).toBe(true)
    expect(result.current.canViewInstalledPlugins).toBe(true)
    expect(result.current.canManagePlugin).toBe(true)
    expect(result.current.canDebugPlugin).toBe(true)
  })
})
