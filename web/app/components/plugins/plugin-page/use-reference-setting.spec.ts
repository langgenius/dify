import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
// Import mocks for assertions
import { useAppContext } from '@/context/app-context'
import { useGlobalPublicStore } from '@/context/global-public-context'

import { useInvalidateReferenceSettings, useMutationReferenceSettings, useReferenceSettings } from '@/service/use-plugins'
import Toast from '../../base/toast'
import { PermissionType } from '../types'
import useReferenceSetting, { useCanInstallPluginFromMarketplace } from './use-reference-setting'

// Mock dependencies
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/context/app-context', () => ({
  useAppContext: vi.fn(),
}))

vi.mock('@/context/global-public-context', () => ({
  useGlobalPublicStore: vi.fn(),
}))

vi.mock('@/service/use-plugins', () => ({
  useReferenceSettings: vi.fn(),
  useMutationReferenceSettings: vi.fn(),
  useInvalidateReferenceSettings: vi.fn(),
}))

vi.mock('../../base/toast', () => ({
  default: {
    notify: vi.fn(),
  },
}))

describe('useReferenceSetting Hook', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Default mocks
    vi.mocked(useAppContext).mockReturnValue({
      isCurrentWorkspaceManager: false,
      isCurrentWorkspaceOwner: false,
    } as ReturnType<typeof useAppContext>)

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

      expect(result.current.canManagement).toBe(false)
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

      expect(result.current.canManagement).toBe(false)
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

      expect(result.current.canManagement).toBe(true)
      expect(result.current.canDebugger).toBe(true)
    })

    it('should return isAdmin when permission is admin and user is manager', () => {
      vi.mocked(useAppContext).mockReturnValue({
        isCurrentWorkspaceManager: true,
        isCurrentWorkspaceOwner: false,
      } as ReturnType<typeof useAppContext>)

      vi.mocked(useReferenceSettings).mockReturnValue({
        data: {
          permission: {
            install_permission: PermissionType.admin,
            debug_permission: PermissionType.admin,
          },
        },
      } as ReturnType<typeof useReferenceSettings>)

      const { result } = renderHook(() => useReferenceSetting())

      expect(result.current.canManagement).toBe(true)
      expect(result.current.canDebugger).toBe(true)
    })

    it('should return isAdmin when permission is admin and user is owner', () => {
      vi.mocked(useAppContext).mockReturnValue({
        isCurrentWorkspaceManager: false,
        isCurrentWorkspaceOwner: true,
      } as ReturnType<typeof useAppContext>)

      vi.mocked(useReferenceSettings).mockReturnValue({
        data: {
          permission: {
            install_permission: PermissionType.admin,
            debug_permission: PermissionType.admin,
          },
        },
      } as ReturnType<typeof useReferenceSettings>)

      const { result } = renderHook(() => useReferenceSetting())

      expect(result.current.canManagement).toBe(true)
      expect(result.current.canDebugger).toBe(true)
    })

    it('should return false when permission is admin and user is not admin', () => {
      vi.mocked(useAppContext).mockReturnValue({
        isCurrentWorkspaceManager: false,
        isCurrentWorkspaceOwner: false,
      } as ReturnType<typeof useAppContext>)

      vi.mocked(useReferenceSettings).mockReturnValue({
        data: {
          permission: {
            install_permission: PermissionType.admin,
            debug_permission: PermissionType.admin,
          },
        },
      } as ReturnType<typeof useReferenceSettings>)

      const { result } = renderHook(() => useReferenceSetting())

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

      const { result } = renderHook(() => useReferenceSetting())

      expect(result.current.canSetPermissions).toBe(true)
    })

    it('should be true when user is workspace owner', () => {
      vi.mocked(useAppContext).mockReturnValue({
        isCurrentWorkspaceManager: false,
        isCurrentWorkspaceOwner: true,
      } as ReturnType<typeof useAppContext>)

      const { result } = renderHook(() => useReferenceSetting())

      expect(result.current.canSetPermissions).toBe(true)
    })

    it('should be false when user is neither manager nor owner', () => {
      vi.mocked(useAppContext).mockReturnValue({
        isCurrentWorkspaceManager: false,
        isCurrentWorkspaceOwner: false,
      } as ReturnType<typeof useAppContext>)

      const { result } = renderHook(() => useReferenceSetting())

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

      renderHook(() => useReferenceSetting())

      // Trigger the onSuccess callback
      if (onSuccessCallback)
        onSuccessCallback()

      await waitFor(() => {
        expect(mockInvalidate).toHaveBeenCalled()
        expect(Toast.notify).toHaveBeenCalledWith({
          type: 'success',
          message: 'api.actionSuccess',
        })
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

      expect(result.current.canManagement).toBe(false)
      expect(result.current.canDebugger).toBe(false)
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

  it('should return true when marketplace is enabled and canManagement is true', () => {
    vi.mocked(useGlobalPublicStore).mockImplementation((selector) => {
      const state = {
        systemFeatures: {
          enable_marketplace: true,
        },
      }
      return selector(state as Parameters<typeof selector>[0])
    })

    const { result } = renderHook(() => useCanInstallPluginFromMarketplace())

    expect(result.current.canInstallPluginFromMarketplace).toBe(true)
  })

  it('should return false when marketplace is disabled', () => {
    vi.mocked(useGlobalPublicStore).mockImplementation((selector) => {
      const state = {
        systemFeatures: {
          enable_marketplace: false,
        },
      }
      return selector(state as Parameters<typeof selector>[0])
    })

    const { result } = renderHook(() => useCanInstallPluginFromMarketplace())

    expect(result.current.canInstallPluginFromMarketplace).toBe(false)
  })

  it('should return false when canManagement is false', () => {
    vi.mocked(useGlobalPublicStore).mockImplementation((selector) => {
      const state = {
        systemFeatures: {
          enable_marketplace: true,
        },
      }
      return selector(state as Parameters<typeof selector>[0])
    })

    vi.mocked(useReferenceSettings).mockReturnValue({
      data: {
        permission: {
          install_permission: PermissionType.noOne,
          debug_permission: PermissionType.noOne,
        },
      },
    } as ReturnType<typeof useReferenceSettings>)

    const { result } = renderHook(() => useCanInstallPluginFromMarketplace())

    expect(result.current.canInstallPluginFromMarketplace).toBe(false)
  })

  it('should return false when both marketplace is disabled and canManagement is false', () => {
    vi.mocked(useGlobalPublicStore).mockImplementation((selector) => {
      const state = {
        systemFeatures: {
          enable_marketplace: false,
        },
      }
      return selector(state as Parameters<typeof selector>[0])
    })

    vi.mocked(useReferenceSettings).mockReturnValue({
      data: {
        permission: {
          install_permission: PermissionType.noOne,
          debug_permission: PermissionType.noOne,
        },
      },
    } as ReturnType<typeof useReferenceSettings>)

    const { result } = renderHook(() => useCanInstallPluginFromMarketplace())

    expect(result.current.canInstallPluginFromMarketplace).toBe(false)
  })
})
