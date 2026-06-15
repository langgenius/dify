// Import mocks for assertions
import { toast } from '@langgenius/dify-ui/toast'
import { waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHookWithSystemFeatures as renderHook } from '@/__tests__/utils/mock-system-features'
import { useAppContext } from '@/context/app-context'

import { useInvalidateReferenceSettings, useMutationPluginPermissionSettings, useMutationReferenceSettings, usePluginAutoUpgradeSettings, usePluginPermissionSettings } from '@/service/use-plugins'
import { PermissionType, PluginCategoryEnum } from '../../types'
import useReferenceSetting, { useCanInstallPluginFromMarketplace } from '../use-reference-setting'

vi.mock('@/context/app-context', () => ({
  useAppContext: vi.fn(),
}))

vi.mock('@/service/use-plugins', () => ({
  hasPluginPermission: vi.fn((permission: string | undefined, isAdmin: boolean) => {
    if (!permission)
      return false

    if (permission === 'noone')
      return false

    if (permission === 'everyone')
      return true

    return isAdmin
  }),
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

  describe('hasPermission logic', () => {
    it('should return false when permission is undefined', () => {
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

    it('should return false when permission is noOne', () => {
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

    it('should return true when permission is everyone', () => {
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

    it('should return isAdmin when permission is admin and user is manager', () => {
      vi.mocked(useAppContext).mockReturnValue({
        isCurrentWorkspaceManager: true,
        isCurrentWorkspaceOwner: false,
      } as ReturnType<typeof useAppContext>)

      vi.mocked(usePluginPermissionSettings).mockReturnValue({
        data: {
          install_permission: PermissionType.admin,
          debug_permission: PermissionType.admin,
        },
      } as ReturnType<typeof usePluginPermissionSettings>)

      const { result } = renderHook(() => useReferenceSetting(PluginCategoryEnum.tool))

      expect(result.current.canManagement).toBe(true)
      expect(result.current.canDebugger).toBe(true)
    })

    it('should return isAdmin when permission is admin and user is owner', () => {
      vi.mocked(useAppContext).mockReturnValue({
        isCurrentWorkspaceManager: false,
        isCurrentWorkspaceOwner: true,
      } as ReturnType<typeof useAppContext>)

      vi.mocked(usePluginPermissionSettings).mockReturnValue({
        data: {
          install_permission: PermissionType.admin,
          debug_permission: PermissionType.admin,
        },
      } as ReturnType<typeof usePluginPermissionSettings>)

      const { result } = renderHook(() => useReferenceSetting(PluginCategoryEnum.tool))

      expect(result.current.canManagement).toBe(true)
      expect(result.current.canDebugger).toBe(true)
    })

    it('should return false when permission is admin and user is not admin', () => {
      vi.mocked(useAppContext).mockReturnValue({
        isCurrentWorkspaceManager: false,
        isCurrentWorkspaceOwner: false,
      } as ReturnType<typeof useAppContext>)

      vi.mocked(usePluginPermissionSettings).mockReturnValue({
        data: {
          install_permission: PermissionType.admin,
          debug_permission: PermissionType.admin,
        },
      } as ReturnType<typeof usePluginPermissionSettings>)

      const { result } = renderHook(() => useReferenceSetting(PluginCategoryEnum.tool))

      expect(result.current.canManagement).toBe(false)
      expect(result.current.canDebugger).toBe(false)
    })
  })

  describe('canSetPermissions', () => {
    it('should be true when user is workspace manager', () => {
      vi.mocked(useAppContext).mockReturnValue({
        isCurrentWorkspaceManager: true,
        isCurrentWorkspaceOwner: false,
      } as ReturnType<typeof useAppContext>)

      const { result } = renderHook(() => useReferenceSetting(PluginCategoryEnum.tool))

      expect(result.current.canSetPermissions).toBe(true)
    })

    it('should be true when user is workspace owner', () => {
      vi.mocked(useAppContext).mockReturnValue({
        isCurrentWorkspaceManager: false,
        isCurrentWorkspaceOwner: true,
      } as ReturnType<typeof useAppContext>)

      const { result } = renderHook(() => useReferenceSetting(PluginCategoryEnum.tool))

      expect(result.current.canSetPermissions).toBe(true)
    })

    it('should be false when user is neither manager nor owner', () => {
      vi.mocked(useAppContext).mockReturnValue({
        isCurrentWorkspaceManager: false,
        isCurrentWorkspaceOwner: false,
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

    it('should keep permissions available when reference setting data is still loading', () => {
      vi.mocked(usePluginAutoUpgradeSettings).mockReturnValue({
        data: undefined,
      } as unknown as ReturnType<typeof usePluginAutoUpgradeSettings>)

      const { result } = renderHook(() => useReferenceSetting(PluginCategoryEnum.tool))

      expect(result.current.referenceSetting).toBeUndefined()
      expect(result.current.canManagement).toBe(true)
      expect(result.current.canDebugger).toBe(true)
    })
  })
})

describe('useCanInstallPluginFromMarketplace Hook', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    vi.mocked(useAppContext).mockReturnValue({
      isCurrentWorkspaceManager: true,
      isCurrentWorkspaceOwner: false,
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

  it('should return true when marketplace is enabled and canManagement is true', () => {
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

  it('should return false when canManagement is false', () => {
    vi.mocked(usePluginPermissionSettings).mockReturnValue({
      data: {
        install_permission: PermissionType.noOne,
        debug_permission: PermissionType.noOne,
      },
    } as ReturnType<typeof usePluginPermissionSettings>)

    const { result } = renderHook(() => useCanInstallPluginFromMarketplace(), {
      systemFeatures: { enable_marketplace: true },
    })

    expect(result.current.canInstallPluginFromMarketplace).toBe(false)
  })

  it('should return false when both marketplace is disabled and canManagement is false', () => {
    vi.mocked(usePluginPermissionSettings).mockReturnValue({
      data: {
        install_permission: PermissionType.noOne,
        debug_permission: PermissionType.noOne,
      },
    } as ReturnType<typeof usePluginPermissionSettings>)

    const { result } = renderHook(() => useCanInstallPluginFromMarketplace(), {
      systemFeatures: { enable_marketplace: false },
    })

    expect(result.current.canInstallPluginFromMarketplace).toBe(false)
  })

  it('should only read plugin permissions and not fetch category auto-upgrade settings', () => {
    renderHook(() => useCanInstallPluginFromMarketplace(), {
      systemFeatures: { enable_marketplace: true },
    })

    expect(usePluginPermissionSettings).toHaveBeenCalled()
    expect(usePluginAutoUpgradeSettings).not.toHaveBeenCalled()
  })
})
