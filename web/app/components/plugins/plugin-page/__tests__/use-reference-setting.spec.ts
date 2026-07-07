// Import mocks for assertions
import { toast } from '@langgenius/dify-ui/toast'
import { waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHookWithSystemFeatures as renderHook } from '@/__tests__/utils/mock-system-features'
import { useAppContext } from '@/context/app-context'

import { useInvalidateReferenceSettings, useMutationPluginPermissionSettings, useMutationReferenceSettings, usePluginAutoUpgradeSettings, usePluginPermissionSettings } from '@/service/use-plugins'
import { PermissionType, PluginCategoryEnum } from '../../types'
import useReferenceSetting, { useCanInstallPluginFromMarketplace } from '../use-reference-setting'

vi.mock('@/context/app-context', async () => {
  const actual = await vi.importActual('@/context/app-context')
  return {
    ...actual,
    useAppContext: vi.fn(),
  }
})

vi.mock('@/service/use-plugins', () => ({
  usePluginAutoUpgradeSettings: vi.fn(),
  usePluginPermissionSettings: vi.fn(),
  useMutationPluginPermissionSettings: vi.fn(),
  useMutationReferenceSettings: vi.fn(),
  useInvalidateReferenceSettings: vi.fn(),
}))

const toastSuccessSpy = vi.spyOn(toast, 'success').mockReturnValue('toast-success')

describe('useReferenceSetting Hook', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    toastSuccessSpy.mockClear()

    // Default mocks
    vi.mocked(useAppContext).mockReturnValue({
      isCurrentWorkspaceManager: false,
      isCurrentWorkspaceOwner: false,
      langGeniusVersionInfo: { current_version: '1.0.0', latest_version: '', version: '' },
      workspacePermissionKeys: [] as string[],
    } as ReturnType<typeof useAppContext>)

    vi.mocked(usePluginAutoUpgradeSettings).mockReturnValue({
      data: {
        category: PluginCategoryEnum.tool,
        auto_upgrade: {
          strategy_setting: 'fix_only',
          upgrade_time_of_day: 0,
          upgrade_mode: 'all',
          exclude_plugins: [],
          include_plugins: [],
        },
      },
    } as unknown as ReturnType<typeof usePluginAutoUpgradeSettings>)

    vi.mocked(usePluginPermissionSettings).mockReturnValue({
      data: {
        install_permission: PermissionType.everyone,
        debug_permission: PermissionType.everyone,
      },
    } as ReturnType<typeof usePluginPermissionSettings>)

    vi.mocked(useMutationReferenceSettings).mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof useMutationReferenceSettings>)

    vi.mocked(useMutationPluginPermissionSettings).mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof useMutationPluginPermissionSettings>)

    vi.mocked(useInvalidateReferenceSettings).mockReturnValue(vi.fn())
  })

  describe('permission key access', () => {
    it('should not expose installed plugin list viewing as a permission capability', () => {
      const { result } = renderHook(() => useReferenceSetting(PluginCategoryEnum.tool))

      expect('canViewInstalledPlugins' in result.current).toBe(false)
    })

    it('should return false without plugin permission keys', () => {
      vi.mocked(usePluginPermissionSettings).mockReturnValue({
        data: {
          install_permission: undefined,
          debug_permission: undefined,
        },
      } as unknown as ReturnType<typeof usePluginPermissionSettings>)

      const { result } = renderHook(() => useReferenceSetting(PluginCategoryEnum.tool))

      expect(result.current.canManagement).toBe(false)
      expect(result.current.canDebugger).toBe(false)
    })

    it('should ignore legacy noOne permission when plugin keys are missing', () => {
      vi.mocked(usePluginPermissionSettings).mockReturnValue({
        data: {
          install_permission: PermissionType.noOne,
          debug_permission: PermissionType.noOne,
        },
      } as ReturnType<typeof usePluginPermissionSettings>)

      const { result } = renderHook(() => useReferenceSetting(PluginCategoryEnum.tool))

      expect(result.current.canManagement).toBe(false)
      expect(result.current.canDebugger).toBe(false)
    })

    it('should allow install and debug when plugin permission keys are present', () => {
      vi.mocked(useAppContext).mockReturnValue({
        isCurrentWorkspaceManager: false,
        isCurrentWorkspaceOwner: false,
        langGeniusVersionInfo: { current_version: '1.0.0', latest_version: '', version: '' },
        workspacePermissionKeys: ['plugin.install', 'plugin.debug'],
      } as ReturnType<typeof useAppContext>)
      vi.mocked(usePluginPermissionSettings).mockReturnValue({
        data: {
          install_permission: PermissionType.everyone,
          debug_permission: PermissionType.everyone,
        },
      } as ReturnType<typeof usePluginPermissionSettings>)

      const { result } = renderHook(() => useReferenceSetting(PluginCategoryEnum.tool))

      expect(result.current.canManagement).toBe(true)
      expect(result.current.canDebugger).toBe(true)
    })

    it('should allow debug for managers with legacy admin permission when RBAC is disabled', () => {
      vi.mocked(useAppContext).mockReturnValue({
        isCurrentWorkspaceManager: true,
        isCurrentWorkspaceOwner: false,
        langGeniusVersionInfo: { current_version: '1.0.0', latest_version: '', version: '' },
        workspacePermissionKeys: [] as string[],
      } as ReturnType<typeof useAppContext>)

      vi.mocked(usePluginPermissionSettings).mockReturnValue({
        data: {
          install_permission: PermissionType.admin,
          debug_permission: PermissionType.admin,
        },
      } as ReturnType<typeof usePluginPermissionSettings>)

      const { result } = renderHook(() => useReferenceSetting(PluginCategoryEnum.tool))

      expect(result.current.canManagement).toBe(false)
      expect(result.current.canDebugger).toBe(true)
    })

    it('should allow debug for owners with legacy admin permission when RBAC is disabled', () => {
      vi.mocked(useAppContext).mockReturnValue({
        isCurrentWorkspaceManager: false,
        isCurrentWorkspaceOwner: true,
        langGeniusVersionInfo: { current_version: '1.0.0', latest_version: '', version: '' },
        workspacePermissionKeys: [] as string[],
      } as ReturnType<typeof useAppContext>)

      vi.mocked(usePluginPermissionSettings).mockReturnValue({
        data: {
          install_permission: PermissionType.admin,
          debug_permission: PermissionType.admin,
        },
      } as ReturnType<typeof usePluginPermissionSettings>)

      const { result } = renderHook(() => useReferenceSetting(PluginCategoryEnum.tool))

      expect(result.current.canManagement).toBe(false)
      expect(result.current.canDebugger).toBe(true)
    })

    it('should allow debug for normal users when legacy debug permission is everyone and RBAC is disabled', () => {
      vi.mocked(useAppContext).mockReturnValue({
        isCurrentWorkspaceManager: false,
        isCurrentWorkspaceOwner: false,
        langGeniusVersionInfo: { current_version: '1.0.0', latest_version: '', version: '' },
        workspacePermissionKeys: ['plugin.install'],
      } as ReturnType<typeof useAppContext>)

      vi.mocked(usePluginPermissionSettings).mockReturnValue({
        data: {
          install_permission: PermissionType.everyone,
          debug_permission: PermissionType.everyone,
        },
      } as ReturnType<typeof usePluginPermissionSettings>)

      const { result } = renderHook(() => useReferenceSetting(PluginCategoryEnum.tool), {
        systemFeatures: { rbac_enabled: false },
      })

      expect(result.current.canDebugPlugin).toBe(true)
      expect(result.current.canDebugger).toBe(true)
    })

    it('should use plugin keys even when legacy admin permission is configured and RBAC is enabled', () => {
      vi.mocked(useAppContext).mockReturnValue({
        isCurrentWorkspaceManager: false,
        isCurrentWorkspaceOwner: false,
        langGeniusVersionInfo: { current_version: '1.0.0', latest_version: '', version: '' },
        workspacePermissionKeys: ['plugin.install', 'plugin.debug'],
      } as ReturnType<typeof useAppContext>)

      vi.mocked(usePluginPermissionSettings).mockReturnValue({
        data: {
          install_permission: PermissionType.admin,
          debug_permission: PermissionType.admin,
        },
      } as ReturnType<typeof usePluginPermissionSettings>)

      const { result } = renderHook(() => useReferenceSetting(PluginCategoryEnum.tool), {
        systemFeatures: { rbac_enabled: true },
      })

      expect(result.current.canManagement).toBe(true)
      expect(result.current.canDebugger).toBe(true)
    })

    it('should apply legacy noOne plugin permissions when RBAC is disabled', () => {
      vi.mocked(useAppContext).mockReturnValue({
        isCurrentWorkspaceManager: true,
        isCurrentWorkspaceOwner: false,
        langGeniusVersionInfo: { current_version: '1.0.0', latest_version: '', version: '' },
        workspacePermissionKeys: ['plugin.install', 'plugin.delete', 'plugin.debug'],
      } as ReturnType<typeof useAppContext>)
      vi.mocked(usePluginPermissionSettings).mockReturnValue({
        data: {
          install_permission: PermissionType.noOne,
          debug_permission: PermissionType.noOne,
        },
      } as ReturnType<typeof usePluginPermissionSettings>)

      const { result } = renderHook(() => useReferenceSetting(PluginCategoryEnum.tool), {
        systemFeatures: { rbac_enabled: false },
      })

      expect(result.current.canInstallPlugin).toBe(false)
      expect(result.current.canManagement).toBe(false)
      expect(result.current.canUpdatePlugin).toBe(false)
      expect(result.current.canDeletePlugin).toBe(false)
      expect(result.current.canDebugPlugin).toBe(false)
      expect(result.current.canDebugger).toBe(false)
    })
  })

  describe('canSetPermissions', () => {
    it('should be true with plugin preferences permission when RBAC is disabled', () => {
      vi.mocked(useAppContext).mockReturnValue({
        isCurrentWorkspaceManager: false,
        isCurrentWorkspaceOwner: false,
        langGeniusVersionInfo: { current_version: '1.0.0', latest_version: '', version: '' },
        workspacePermissionKeys: ['plugin.plugin_preferences'],
      } as ReturnType<typeof useAppContext>)

      const { result } = renderHook(() => useReferenceSetting(PluginCategoryEnum.tool))

      expect(result.current.canSetPermissions).toBe(true)
    })

    it('should be false when RBAC is enabled even with plugin preferences permission', () => {
      vi.mocked(useAppContext).mockReturnValue({
        isCurrentWorkspaceManager: false,
        isCurrentWorkspaceOwner: true,
        langGeniusVersionInfo: { current_version: '1.0.0', latest_version: '', version: '' },
        workspacePermissionKeys: ['plugin.plugin_preferences'],
      } as ReturnType<typeof useAppContext>)

      const { result } = renderHook(() => useReferenceSetting(PluginCategoryEnum.tool), {
        systemFeatures: { rbac_enabled: true },
      })

      expect(result.current.canSetPermissions).toBe(false)
      expect(result.current.canSetPluginPreferences).toBe(true)
    })

    it('should be false without plugin preferences permission', () => {
      vi.mocked(useAppContext).mockReturnValue({
        isCurrentWorkspaceManager: true,
        isCurrentWorkspaceOwner: false,
        langGeniusVersionInfo: { current_version: '1.0.0', latest_version: '', version: '' },
        workspacePermissionKeys: [] as string[],
      } as ReturnType<typeof useAppContext>)

      const { result } = renderHook(() => useReferenceSetting(PluginCategoryEnum.tool))

      expect(result.current.canSetPermissions).toBe(false)
    })
  })

  describe('setReferenceSettings callback', () => {
    it('should call invalidateReferenceSettings and show toast on success', async () => {
      const mockInvalidate = vi.fn()
      vi.mocked(useInvalidateReferenceSettings).mockReturnValue(mockInvalidate)

      let onSuccessCallback: (() => void) | undefined
      vi.mocked(useMutationReferenceSettings).mockImplementation((options) => {
        onSuccessCallback = options?.onSuccess as () => void
        return {
          mutate: vi.fn(),
          isPending: false,
        } as unknown as ReturnType<typeof useMutationReferenceSettings>
      })

      renderHook(() => useReferenceSetting(PluginCategoryEnum.tool))

      // Trigger the onSuccess callback
      if (onSuccessCallback)
        onSuccessCallback()

      await waitFor(() => {
        expect(mockInvalidate).toHaveBeenCalled()
        expect(toastSuccessSpy).toHaveBeenCalledWith('common.api.actionSuccess')
      })
    })
  })

  describe('returned values', () => {
    it('should return referenceSetting data', () => {
      const mockData = {
        permission: {
          install_permission: PermissionType.everyone,
          debug_permission: PermissionType.everyone,
        },
        auto_upgrade: {
          strategy_setting: 'fix_only',
          upgrade_time_of_day: 0,
          upgrade_mode: 'all',
          exclude_plugins: [],
          include_plugins: [],
        },
      }
      vi.mocked(usePluginAutoUpgradeSettings).mockReturnValue({
        data: {
          category: PluginCategoryEnum.tool,
          auto_upgrade: mockData.auto_upgrade,
        },
      } as unknown as ReturnType<typeof usePluginAutoUpgradeSettings>)

      const { result } = renderHook(() => useReferenceSetting(PluginCategoryEnum.tool))

      expect(result.current.referenceSetting).toEqual(mockData)
    })

    it('should return isUpdatePending from mutation', () => {
      vi.mocked(useMutationReferenceSettings).mockReturnValue({
        mutate: vi.fn(),
        isPending: true,
      } as unknown as ReturnType<typeof useMutationReferenceSettings>)

      const { result } = renderHook(() => useReferenceSetting(PluginCategoryEnum.tool))

      expect(result.current.isUpdatePending).toBe(true)
    })

    it('should keep permission key access available when reference setting data is still loading', () => {
      vi.mocked(useAppContext).mockReturnValue({
        isCurrentWorkspaceManager: false,
        isCurrentWorkspaceOwner: false,
        langGeniusVersionInfo: { current_version: '1.0.0', latest_version: '', version: '' },
        workspacePermissionKeys: ['plugin.install', 'plugin.debug'],
      } as ReturnType<typeof useAppContext>)
      vi.mocked(usePluginAutoUpgradeSettings).mockReturnValue({
        data: undefined,
      } as unknown as ReturnType<typeof usePluginAutoUpgradeSettings>)

      const { result } = renderHook(() => useReferenceSetting(PluginCategoryEnum.tool))

      expect(result.current.referenceSetting).toBeUndefined()
      expect(result.current.canManagement).toBe(true)
      expect(result.current.canDebugger).toBe(true)
    })

    it('should keep permission state loading while workspace permission keys are loading', () => {
      vi.mocked(useAppContext).mockReturnValue({
        isCurrentWorkspaceManager: false,
        isCurrentWorkspaceOwner: false,
        isLoadingWorkspacePermissionKeys: true,
        langGeniusVersionInfo: { current_version: '1.0.0', latest_version: '', version: '' },
        workspacePermissionKeys: [] as string[],
      } as ReturnType<typeof useAppContext>)

      const { result } = renderHook(() => useReferenceSetting(PluginCategoryEnum.tool))

      expect(result.current.isPermissionLoading).toBe(true)
      expect(result.current.canInstallPlugin).toBe(false)
    })

    it('should keep permission state loading while current workspace is loading', () => {
      vi.mocked(useAppContext).mockReturnValue({
        isCurrentWorkspaceManager: false,
        isCurrentWorkspaceOwner: false,
        isLoadingCurrentWorkspace: true,
        langGeniusVersionInfo: { current_version: '1.0.0', latest_version: '', version: '' },
        workspacePermissionKeys: ['plugin.install'],
      } as ReturnType<typeof useAppContext>)

      const { result } = renderHook(() => useReferenceSetting(PluginCategoryEnum.tool))

      expect(result.current.isPermissionLoading).toBe(true)
    })
  })

  describe('RBAC permissions', () => {
    it('should use workspace permission keys when RBAC is enabled', () => {
      vi.mocked(useAppContext).mockReturnValue({
        isCurrentWorkspaceManager: false,
        isCurrentWorkspaceOwner: false,
        langGeniusVersionInfo: { current_version: '1.0.0', latest_version: '', version: '' },
        workspacePermissionKeys: [
          'plugin.install',
          'plugin.delete',
          'plugin.debug',
          'plugin.plugin_preferences',
        ],
      } as ReturnType<typeof useAppContext>)
      vi.mocked(usePluginPermissionSettings).mockReturnValue({
        data: {
          install_permission: PermissionType.noOne,
          debug_permission: PermissionType.noOne,
        },
      } as ReturnType<typeof usePluginPermissionSettings>)

      const { result } = renderHook(() => useReferenceSetting(PluginCategoryEnum.tool), {
        systemFeatures: { rbac_enabled: true },
      })

      expect(result.current.canInstallPlugin).toBe(true)
      expect(result.current.canManagement).toBe(true)
      expect(result.current.canUpdatePlugin).toBe(true)
      expect(result.current.canDeletePlugin).toBe(true)
      expect(result.current.canDebugPlugin).toBe(true)
      expect(result.current.canDebugger).toBe(true)
      expect(result.current.canSetPermissions).toBe(false)
      expect(result.current.canSetPluginPreferences).toBe(true)
    })

    it('should ignore legacy plugin permission settings when RBAC is enabled', () => {
      vi.mocked(useAppContext).mockReturnValue({
        isCurrentWorkspaceManager: true,
        isCurrentWorkspaceOwner: false,
        langGeniusVersionInfo: { current_version: '1.0.0', latest_version: '', version: '' },
        workspacePermissionKeys: [] as string[],
      } as ReturnType<typeof useAppContext>)

      const { result } = renderHook(() => useReferenceSetting(PluginCategoryEnum.tool), {
        systemFeatures: { rbac_enabled: true },
      })

      expect(result.current.canInstallPlugin).toBe(false)
      expect(result.current.canManagement).toBe(false)
      expect(result.current.canUpdatePlugin).toBe(false)
      expect(result.current.canDeletePlugin).toBe(false)
      expect(result.current.canDebugPlugin).toBe(false)
      expect(result.current.canDebugger).toBe(false)
      expect(result.current.canSetPermissions).toBe(false)
      expect(result.current.canSetPluginPreferences).toBe(false)
    })
  })
})

describe('useCanInstallPluginFromMarketplace Hook', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    vi.mocked(useAppContext).mockReturnValue({
      isCurrentWorkspaceManager: true,
      isCurrentWorkspaceOwner: false,
      langGeniusVersionInfo: { current_version: '1.0.0', latest_version: '', version: '' },
      workspacePermissionKeys: ['plugin.install'],
    } as ReturnType<typeof useAppContext>)

    vi.mocked(usePluginPermissionSettings).mockReturnValue({
      data: {
        install_permission: PermissionType.everyone,
        debug_permission: PermissionType.everyone,
      },
    } as ReturnType<typeof usePluginPermissionSettings>)

    vi.mocked(useMutationReferenceSettings).mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof useMutationReferenceSettings>)

    vi.mocked(useInvalidateReferenceSettings).mockReturnValue(vi.fn())
  })

  it('should return true when marketplace is enabled and plugin.install is available', () => {
    const { result } = renderHook(() => useCanInstallPluginFromMarketplace(), {
      systemFeatures: { enable_marketplace: true },
    })

    expect(result.current.canInstallPluginFromMarketplace).toBe(true)
  })

  it('should return false when marketplace is disabled', () => {
    const { result } = renderHook(() => useCanInstallPluginFromMarketplace(), {
      systemFeatures: { enable_marketplace: false },
    })

    expect(result.current.canInstallPluginFromMarketplace).toBe(false)
  })

  it('should return false without plugin.install', () => {
    vi.mocked(useAppContext).mockReturnValue({
      isCurrentWorkspaceManager: true,
      isCurrentWorkspaceOwner: false,
      langGeniusVersionInfo: { current_version: '1.0.0', latest_version: '', version: '' },
      workspacePermissionKeys: [] as string[],
    } as ReturnType<typeof useAppContext>)

    const { result } = renderHook(() => useCanInstallPluginFromMarketplace(), {
      systemFeatures: { enable_marketplace: true },
    })

    expect(result.current.canInstallPluginFromMarketplace).toBe(false)
  })

  it('should return false when both marketplace is disabled and plugin.install is missing', () => {
    vi.mocked(useAppContext).mockReturnValue({
      isCurrentWorkspaceManager: true,
      isCurrentWorkspaceOwner: false,
      langGeniusVersionInfo: { current_version: '1.0.0', latest_version: '', version: '' },
      workspacePermissionKeys: [] as string[],
    } as ReturnType<typeof useAppContext>)

    const { result } = renderHook(() => useCanInstallPluginFromMarketplace(), {
      systemFeatures: { enable_marketplace: false },
    })

    expect(result.current.canInstallPluginFromMarketplace).toBe(false)
  })

  it('should fetch legacy plugin permissions but not category auto-upgrade settings', () => {
    renderHook(() => useCanInstallPluginFromMarketplace(), {
      systemFeatures: { enable_marketplace: true },
    })

    expect(usePluginPermissionSettings).toHaveBeenCalled()
    expect(usePluginAutoUpgradeSettings).not.toHaveBeenCalled()
  })

  it('should return false when legacy install permission is noOne and RBAC is disabled', () => {
    vi.mocked(usePluginPermissionSettings).mockReturnValue({
      data: {
        install_permission: PermissionType.noOne,
        debug_permission: PermissionType.everyone,
      },
    } as ReturnType<typeof usePluginPermissionSettings>)

    const { result } = renderHook(() => useCanInstallPluginFromMarketplace(), {
      systemFeatures: {
        enable_marketplace: true,
        rbac_enabled: false,
      },
    })

    expect(result.current.canInstallPluginFromMarketplace).toBe(false)
  })

  it('should use plugin.install when marketplace and RBAC are enabled', () => {
    vi.mocked(useAppContext).mockReturnValue({
      isCurrentWorkspaceManager: false,
      isCurrentWorkspaceOwner: false,
      langGeniusVersionInfo: { current_version: '1.0.0', latest_version: '', version: '' },
      workspacePermissionKeys: ['plugin.install'],
    } as ReturnType<typeof useAppContext>)
    vi.mocked(usePluginPermissionSettings).mockReturnValue({
      data: {
        install_permission: PermissionType.noOne,
        debug_permission: PermissionType.noOne,
      },
    } as ReturnType<typeof usePluginPermissionSettings>)

    const { result } = renderHook(() => useCanInstallPluginFromMarketplace(), {
      systemFeatures: {
        enable_marketplace: true,
        rbac_enabled: true,
      },
    })

    expect(result.current.canInstallPluginFromMarketplace).toBe(true)
  })
})
