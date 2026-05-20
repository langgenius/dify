// Import mocks for assertions
import { toast } from '@langgenius/dify-ui/toast'
import { waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHookWithSystemFeatures as renderHook } from '@/__tests__/utils/mock-system-features'
import { useAppContext } from '@/context/app-context'

import { useInvalidateReferenceSettings, useMutationReferenceSettings, useReferenceSettings } from '@/service/use-plugins'
import { PermissionType } from '../../types'
import useReferenceSetting, { useCanInstallPluginFromMarketplace } from '../use-reference-setting'

vi.mock('@/context/app-context', () => ({
  useAppContext: vi.fn(),
}))

vi.mock('@/service/use-plugins', () => ({
  useReferenceSettings: vi.fn(),
  useMutationReferenceSettings: vi.fn(),
  useInvalidateReferenceSettings: vi.fn(),
}))

const toastSuccessSpy = vi.spyOn(toast, 'success').mockReturnValue('toast-success')

const createAppContext = (overrides: Partial<ReturnType<typeof useAppContext>> = {}) => ({
  isCurrentWorkspaceManager: false,
  isCurrentWorkspaceOwner: false,
  langGeniusVersionInfo: { current_version: '1.0.0' },
  workspacePermissionKeys: ['plugin.install', 'plugin.manage', 'plugin.preference.manage'],
  ...overrides,
}) as ReturnType<typeof useAppContext>

describe('useReferenceSetting Hook', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    toastSuccessSpy.mockClear()

    // Default mocks
    vi.mocked(useAppContext).mockReturnValue(createAppContext())

    vi.mocked(useReferenceSettings).mockReturnValue({
      data: {
        permission: {
          install_permission: PermissionType.everyone,
          debug_permission: PermissionType.everyone,
        },
      },
    } as ReturnType<typeof useReferenceSettings>)

    vi.mocked(useMutationReferenceSettings).mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof useMutationReferenceSettings>)

    vi.mocked(useInvalidateReferenceSettings).mockReturnValue(vi.fn())
  })

  describe('hasPermission logic', () => {
    it('should return false when permission is undefined', () => {
      vi.mocked(useReferenceSettings).mockReturnValue({
        data: {
          permission: {
            install_permission: undefined,
            debug_permission: undefined,
          },
        },
      } as unknown as ReturnType<typeof useReferenceSettings>)

      const { result } = renderHook(() => useReferenceSetting())

      expect(result.current.canInstall).toBe(false)
      expect(result.current.canDebugger).toBe(false)
    })

    it('should return false when permission is noOne', () => {
      vi.mocked(useReferenceSettings).mockReturnValue({
        data: {
          permission: {
            install_permission: PermissionType.noOne,
            debug_permission: PermissionType.noOne,
          },
        },
      } as ReturnType<typeof useReferenceSettings>)

      const { result } = renderHook(() => useReferenceSetting())

      expect(result.current.canInstall).toBe(false)
      expect(result.current.canDebugger).toBe(false)
    })

    it('should return true when permission is everyone', () => {
      vi.mocked(useReferenceSettings).mockReturnValue({
        data: {
          permission: {
            install_permission: PermissionType.everyone,
            debug_permission: PermissionType.everyone,
          },
        },
      } as ReturnType<typeof useReferenceSettings>)

      const { result } = renderHook(() => useReferenceSetting())

      expect(result.current.canInstall).toBe(true)
      expect(result.current.canDebugger).toBe(true)
    })

    it('should return isAdmin when permission is admin and user is manager', () => {
      vi.mocked(useAppContext).mockReturnValue(createAppContext({
        isCurrentWorkspaceManager: true,
        isCurrentWorkspaceOwner: false,
      }))

      vi.mocked(useReferenceSettings).mockReturnValue({
        data: {
          permission: {
            install_permission: PermissionType.admin,
            debug_permission: PermissionType.admin,
          },
        },
      } as ReturnType<typeof useReferenceSettings>)

      const { result } = renderHook(() => useReferenceSetting())

      expect(result.current.canInstall).toBe(true)
      expect(result.current.canDebugger).toBe(true)
    })

    it('should return isAdmin when permission is admin and user is owner', () => {
      vi.mocked(useAppContext).mockReturnValue(createAppContext({
        isCurrentWorkspaceManager: false,
        isCurrentWorkspaceOwner: true,
      }))

      vi.mocked(useReferenceSettings).mockReturnValue({
        data: {
          permission: {
            install_permission: PermissionType.admin,
            debug_permission: PermissionType.admin,
          },
        },
      } as ReturnType<typeof useReferenceSettings>)

      const { result } = renderHook(() => useReferenceSetting())

      expect(result.current.canInstall).toBe(true)
      expect(result.current.canDebugger).toBe(true)
    })

    it('should return false when permission is admin and user is not admin', () => {
      vi.mocked(useAppContext).mockReturnValue(createAppContext({
        isCurrentWorkspaceManager: false,
        isCurrentWorkspaceOwner: false,
      }))

      vi.mocked(useReferenceSettings).mockReturnValue({
        data: {
          permission: {
            install_permission: PermissionType.admin,
            debug_permission: PermissionType.admin,
          },
        },
      } as ReturnType<typeof useReferenceSettings>)

      const { result } = renderHook(() => useReferenceSetting())

      expect(result.current.canInstall).toBe(false)
      expect(result.current.canDebugger).toBe(false)
    })

    it('should allow update and view but not install with plugin.manage only', () => {
      vi.mocked(useAppContext).mockReturnValue(createAppContext({
        workspacePermissionKeys: ['plugin.manage'],
      }))

      const { result } = renderHook(() => useReferenceSetting())

      expect(result.current.canInstall).toBe(false)
      expect(result.current.canUpdate).toBe(true)
      expect(result.current.canViewInstalledPlugins).toBe(true)
      expect(result.current.canManagePlugin).toBe(true)
    })

    it('should allow install and update but not manage with plugin.install only', () => {
      vi.mocked(useAppContext).mockReturnValue(createAppContext({
        workspacePermissionKeys: ['plugin.install'],
      }))

      const { result } = renderHook(() => useReferenceSetting())

      expect(result.current.canInstall).toBe(true)
      expect(result.current.canUpdate).toBe(true)
      expect(result.current.canViewInstalledPlugins).toBe(true)
      expect(result.current.canManagePlugin).toBe(false)
    })

    it('should allow uninstall with plugin.uninstall only', () => {
      vi.mocked(useAppContext).mockReturnValue(createAppContext({
        workspacePermissionKeys: ['plugin.uninstall'],
      }))

      const { result } = renderHook(() => useReferenceSetting())

      expect(result.current.canUninstall).toBe(true)
      expect(result.current.canInstall).toBe(false)
      expect(result.current.canUpdate).toBe(false)
    })

    it('should not allow uninstall with plugin.install only', () => {
      vi.mocked(useAppContext).mockReturnValue(createAppContext({
        workspacePermissionKeys: ['plugin.install'],
      }))

      const { result } = renderHook(() => useReferenceSetting())

      expect(result.current.canUninstall).toBe(false)
    })
  })

  describe('canSetPreferences', () => {
    it('should be true when user has plugin.preference.manage', () => {
      vi.mocked(useAppContext).mockReturnValue(createAppContext({
        workspacePermissionKeys: ['plugin.preference.manage'],
      }))

      const { result } = renderHook(() => useReferenceSetting())

      expect(result.current.canSetPreferences).toBe(true)
      expect(result.current.canSetPermissions).toBe(true)
      expect(result.current.canSetAutoUpdate).toBe(false)
    })

    it('should be true when user has plugin.install for auto update control', () => {
      vi.mocked(useAppContext).mockReturnValue(createAppContext({
        workspacePermissionKeys: ['plugin.install'],
      }))

      const { result } = renderHook(() => useReferenceSetting())

      expect(result.current.canSetPreferences).toBe(true)
      expect(result.current.canSetPermissions).toBe(false)
      expect(result.current.canSetAutoUpdate).toBe(true)
    })

    it('should be false when user has neither plugin preference nor install permission', () => {
      vi.mocked(useAppContext).mockReturnValue(createAppContext({
        workspacePermissionKeys: [],
      }))

      const { result } = renderHook(() => useReferenceSetting())

      expect(result.current.canSetPreferences).toBe(false)
      expect(result.current.canSetPermissions).toBe(false)
      expect(result.current.canSetAutoUpdate).toBe(false)
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

      renderHook(() => useReferenceSetting())

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
      }
      vi.mocked(useReferenceSettings).mockReturnValue({
        data: mockData,
      } as ReturnType<typeof useReferenceSettings>)

      const { result } = renderHook(() => useReferenceSetting())

      expect(result.current.referenceSetting).toEqual(mockData)
    })

    it('should return isUpdatePending from mutation', () => {
      vi.mocked(useMutationReferenceSettings).mockReturnValue({
        mutate: vi.fn(),
        isPending: true,
      } as unknown as ReturnType<typeof useMutationReferenceSettings>)

      const { result } = renderHook(() => useReferenceSetting())

      expect(result.current.isUpdatePending).toBe(true)
    })

    it('should handle null data', () => {
      vi.mocked(useReferenceSettings).mockReturnValue({
        data: null,
      } as unknown as ReturnType<typeof useReferenceSettings>)

      const { result } = renderHook(() => useReferenceSetting())

      expect(result.current.canInstall).toBe(false)
      expect(result.current.canDebugger).toBe(false)
    })
  })
})

describe('useCanInstallPluginFromMarketplace Hook', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    vi.mocked(useAppContext).mockReturnValue(createAppContext({
      isCurrentWorkspaceManager: true,
      isCurrentWorkspaceOwner: false,
    }))

    vi.mocked(useReferenceSettings).mockReturnValue({
      data: {
        permission: {
          install_permission: PermissionType.everyone,
          debug_permission: PermissionType.everyone,
        },
      },
    } as ReturnType<typeof useReferenceSettings>)

    vi.mocked(useMutationReferenceSettings).mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof useMutationReferenceSettings>)

    vi.mocked(useInvalidateReferenceSettings).mockReturnValue(vi.fn())
  })

  it('should return true when marketplace is enabled and canInstall is true', () => {
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

  it('should return false when canInstall is false', () => {
    vi.mocked(useReferenceSettings).mockReturnValue({
      data: {
        permission: {
          install_permission: PermissionType.noOne,
          debug_permission: PermissionType.noOne,
        },
      },
    } as ReturnType<typeof useReferenceSettings>)

    const { result } = renderHook(() => useCanInstallPluginFromMarketplace(), {
      systemFeatures: { enable_marketplace: true },
    })

    expect(result.current.canInstallPluginFromMarketplace).toBe(false)
  })

  it('should return false when user only has plugin.manage', () => {
    vi.mocked(useAppContext).mockReturnValue(createAppContext({
      workspacePermissionKeys: ['plugin.manage'],
    }))

    const { result } = renderHook(() => useCanInstallPluginFromMarketplace(), {
      systemFeatures: { enable_marketplace: true },
    })

    expect(result.current.canInstallPluginFromMarketplace).toBe(false)
  })

  it('should return false when both marketplace is disabled and canInstall is false', () => {
    vi.mocked(useReferenceSettings).mockReturnValue({
      data: {
        permission: {
          install_permission: PermissionType.noOne,
          debug_permission: PermissionType.noOne,
        },
      },
    } as ReturnType<typeof useReferenceSettings>)

    const { result } = renderHook(() => useCanInstallPluginFromMarketplace(), {
      systemFeatures: { enable_marketplace: false },
    })

    expect(result.current.canInstallPluginFromMarketplace).toBe(false)
  })
})
