import type { PluginDetail } from '../../../types'
import type { ModalStates, VersionTarget } from './use-detail-header-state'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as amplitude from '@/app/components/base/amplitude'
import Toast from '@/app/components/base/toast'
import { PluginSource } from '../../../types'
import { usePluginOperations } from './use-plugin-operations'

type VersionPickerMock = {
  setTargetVersion: (version: VersionTarget) => void
  setIsDowngrade: (downgrade: boolean) => void
}

const {
  mockSetShowUpdatePluginModal,
  mockRefreshModelProviders,
  mockInvalidateAllToolProviders,
  mockUninstallPlugin,
  mockFetchReleases,
  mockCheckForUpdates,
} = vi.hoisted(() => {
  return {
    mockSetShowUpdatePluginModal: vi.fn(),
    mockRefreshModelProviders: vi.fn(),
    mockInvalidateAllToolProviders: vi.fn(),
    mockUninstallPlugin: vi.fn(() => Promise.resolve({ success: true })),
    mockFetchReleases: vi.fn(() => Promise.resolve([{ tag_name: 'v2.0.0' }])),
    mockCheckForUpdates: vi.fn(() => ({ needUpdate: true, toastProps: { type: 'success', message: 'Update available' } })),
  }
})

vi.mock('@/context/modal-context', () => ({
  useModalContext: () => ({
    setShowUpdatePluginModal: mockSetShowUpdatePluginModal,
  }),
}))

vi.mock('@/context/provider-context', () => ({
  useProviderContext: () => ({
    refreshModelProviders: mockRefreshModelProviders,
  }),
}))

vi.mock('@/service/plugins', () => ({
  uninstallPlugin: mockUninstallPlugin,
}))

vi.mock('@/service/use-tools', () => ({
  useInvalidateAllToolProviders: () => mockInvalidateAllToolProviders,
}))

vi.mock('../../../install-plugin/hooks', () => ({
  useGitHubReleases: () => ({
    checkForUpdates: mockCheckForUpdates,
    fetchReleases: mockFetchReleases,
  }),
}))

const createPluginDetail = (overrides: Partial<PluginDetail> = {}): PluginDetail => ({
  id: 'test-id',
  created_at: '2024-01-01',
  updated_at: '2024-01-02',
  name: 'Test Plugin',
  plugin_id: 'test-plugin',
  plugin_unique_identifier: 'test-uid',
  declaration: {
    author: 'test-author',
    name: 'test-plugin-name',
    category: 'tool',
    label: { en_US: 'Test Plugin Label' },
    description: { en_US: 'Test description' },
    icon: 'icon.png',
    verified: true,
  } as unknown as PluginDetail['declaration'],
  installation_id: 'install-1',
  tenant_id: 'tenant-1',
  endpoints_setups: 0,
  endpoints_active: 0,
  version: '1.0.0',
  latest_version: '2.0.0',
  latest_unique_identifier: 'new-uid',
  source: PluginSource.marketplace,
  meta: undefined,
  status: 'active',
  deprecated_reason: '',
  alternative_plugin_id: '',
  ...overrides,
})

const createModalStatesMock = (): ModalStates => ({
  isShowUpdateModal: false,
  showUpdateModal: vi.fn(),
  hideUpdateModal: vi.fn(),
  isShowPluginInfo: false,
  showPluginInfo: vi.fn(),
  hidePluginInfo: vi.fn(),
  isShowDeleteConfirm: false,
  showDeleteConfirm: vi.fn(),
  hideDeleteConfirm: vi.fn(),
  deleting: false,
  showDeleting: vi.fn(),
  hideDeleting: vi.fn(),
})

const createVersionPickerMock = (): VersionPickerMock => ({
  setTargetVersion: vi.fn<(version: VersionTarget) => void>(),
  setIsDowngrade: vi.fn<(downgrade: boolean) => void>(),
})

describe('usePluginOperations', () => {
  let modalStates: ModalStates
  let versionPicker: VersionPickerMock
  let mockOnUpdate: (isDelete?: boolean) => void

  beforeEach(() => {
    vi.clearAllMocks()
    modalStates = createModalStatesMock()
    versionPicker = createVersionPickerMock()
    mockOnUpdate = vi.fn()
    vi.spyOn(Toast, 'notify').mockImplementation(() => ({ clear: vi.fn() }))
    vi.spyOn(amplitude, 'trackEvent').mockImplementation(() => {})
  })

  describe('Marketplace Update Flow', () => {
    it('should show update modal for marketplace plugin', async () => {
      const detail = createPluginDetail({ source: PluginSource.marketplace })
      const { result } = renderHook(() =>
        usePluginOperations({
          detail,
          modalStates,
          versionPicker,
          isFromMarketplace: true,
          onUpdate: mockOnUpdate,
        }),
      )

      await act(async () => {
        await result.current.handleUpdate()
      })

      expect(modalStates.showUpdateModal).toHaveBeenCalled()
    })

    it('should set isDowngrade when downgrading', async () => {
      const detail = createPluginDetail({ source: PluginSource.marketplace })
      const { result } = renderHook(() =>
        usePluginOperations({
          detail,
          modalStates,
          versionPicker,
          isFromMarketplace: true,
          onUpdate: mockOnUpdate,
        }),
      )

      await act(async () => {
        await result.current.handleUpdate(true)
      })

      expect(versionPicker.setIsDowngrade).toHaveBeenCalledWith(true)
      expect(modalStates.showUpdateModal).toHaveBeenCalled()
    })

    it('should call onUpdate and hide modal on successful marketplace update', () => {
      const detail = createPluginDetail({ source: PluginSource.marketplace })
      const { result } = renderHook(() =>
        usePluginOperations({
          detail,
          modalStates,
          versionPicker,
          isFromMarketplace: true,
          onUpdate: mockOnUpdate,
        }),
      )

      act(() => {
        result.current.handleUpdatedFromMarketplace()
      })

      expect(mockOnUpdate).toHaveBeenCalled()
      expect(modalStates.hideUpdateModal).toHaveBeenCalled()
    })
  })

  describe('GitHub Update Flow', () => {
    it('should fetch releases from GitHub', async () => {
      const detail = createPluginDetail({
        source: PluginSource.github,
        meta: { repo: 'owner/repo', version: 'v1.0.0', package: 'pkg' },
      })
      const { result } = renderHook(() =>
        usePluginOperations({
          detail,
          modalStates,
          versionPicker,
          isFromMarketplace: false,
          onUpdate: mockOnUpdate,
        }),
      )

      await act(async () => {
        await result.current.handleUpdate()
      })

      expect(mockFetchReleases).toHaveBeenCalledWith('owner', 'repo')
    })

    it('should check for updates after fetching releases', async () => {
      const detail = createPluginDetail({
        source: PluginSource.github,
        meta: { repo: 'owner/repo', version: 'v1.0.0', package: 'pkg' },
      })
      const { result } = renderHook(() =>
        usePluginOperations({
          detail,
          modalStates,
          versionPicker,
          isFromMarketplace: false,
          onUpdate: mockOnUpdate,
        }),
      )

      await act(async () => {
        await result.current.handleUpdate()
      })

      expect(mockCheckForUpdates).toHaveBeenCalled()
      expect(Toast.notify).toHaveBeenCalled()
    })

    it('should show update plugin modal when update is needed', async () => {
      const detail = createPluginDetail({
        source: PluginSource.github,
        meta: { repo: 'owner/repo', version: 'v1.0.0', package: 'pkg' },
      })
      const { result } = renderHook(() =>
        usePluginOperations({
          detail,
          modalStates,
          versionPicker,
          isFromMarketplace: false,
          onUpdate: mockOnUpdate,
        }),
      )

      await act(async () => {
        await result.current.handleUpdate()
      })

      expect(mockSetShowUpdatePluginModal).toHaveBeenCalled()
    })

    it('should not show modal when no releases found', async () => {
      mockFetchReleases.mockResolvedValueOnce([])
      const detail = createPluginDetail({
        source: PluginSource.github,
        meta: { repo: 'owner/repo', version: 'v1.0.0', package: 'pkg' },
      })
      const { result } = renderHook(() =>
        usePluginOperations({
          detail,
          modalStates,
          versionPicker,
          isFromMarketplace: false,
          onUpdate: mockOnUpdate,
        }),
      )

      await act(async () => {
        await result.current.handleUpdate()
      })

      expect(mockSetShowUpdatePluginModal).not.toHaveBeenCalled()
    })

    it('should not show modal when no update needed', async () => {
      mockCheckForUpdates.mockReturnValueOnce({
        needUpdate: false,
        toastProps: { type: 'info', message: 'Already up to date' },
      })
      const detail = createPluginDetail({
        source: PluginSource.github,
        meta: { repo: 'owner/repo', version: 'v1.0.0', package: 'pkg' },
      })
      const { result } = renderHook(() =>
        usePluginOperations({
          detail,
          modalStates,
          versionPicker,
          isFromMarketplace: false,
          onUpdate: mockOnUpdate,
        }),
      )

      await act(async () => {
        await result.current.handleUpdate()
      })

      expect(mockSetShowUpdatePluginModal).not.toHaveBeenCalled()
    })

    it('should use author and name as fallback for repo parsing', async () => {
      const detail = createPluginDetail({
        source: PluginSource.github,
        meta: { repo: '/', version: 'v1.0.0', package: 'pkg' },
        declaration: {
          author: 'fallback-author',
          name: 'fallback-name',
          category: 'tool',
          label: { en_US: 'Test' },
          description: { en_US: 'Test' },
          icon: 'icon.png',
          verified: true,
        } as unknown as PluginDetail['declaration'],
      })
      const { result } = renderHook(() =>
        usePluginOperations({
          detail,
          modalStates,
          versionPicker,
          isFromMarketplace: false,
          onUpdate: mockOnUpdate,
        }),
      )

      await act(async () => {
        await result.current.handleUpdate()
      })

      expect(mockFetchReleases).toHaveBeenCalledWith('fallback-author', 'fallback-name')
    })
  })

  describe('Delete Flow', () => {
    it('should call uninstallPlugin with correct id', async () => {
      const detail = createPluginDetail({ id: 'plugin-to-delete' })
      const { result } = renderHook(() =>
        usePluginOperations({
          detail,
          modalStates,
          versionPicker,
          isFromMarketplace: true,
          onUpdate: mockOnUpdate,
        }),
      )

      await act(async () => {
        await result.current.handleDelete()
      })

      expect(mockUninstallPlugin).toHaveBeenCalledWith('plugin-to-delete')
    })

    it('should show and hide deleting state during delete', async () => {
      const detail = createPluginDetail()
      const { result } = renderHook(() =>
        usePluginOperations({
          detail,
          modalStates,
          versionPicker,
          isFromMarketplace: true,
          onUpdate: mockOnUpdate,
        }),
      )

      await act(async () => {
        await result.current.handleDelete()
      })

      expect(modalStates.showDeleting).toHaveBeenCalled()
      expect(modalStates.hideDeleting).toHaveBeenCalled()
    })

    it('should call onUpdate with true after successful delete', async () => {
      const detail = createPluginDetail()
      const { result } = renderHook(() =>
        usePluginOperations({
          detail,
          modalStates,
          versionPicker,
          isFromMarketplace: true,
          onUpdate: mockOnUpdate,
        }),
      )

      await act(async () => {
        await result.current.handleDelete()
      })

      expect(mockOnUpdate).toHaveBeenCalledWith(true)
    })

    it('should hide delete confirm after successful delete', async () => {
      const detail = createPluginDetail()
      const { result } = renderHook(() =>
        usePluginOperations({
          detail,
          modalStates,
          versionPicker,
          isFromMarketplace: true,
          onUpdate: mockOnUpdate,
        }),
      )

      await act(async () => {
        await result.current.handleDelete()
      })

      expect(modalStates.hideDeleteConfirm).toHaveBeenCalled()
    })

    it('should refresh model providers when deleting model plugin', async () => {
      const detail = createPluginDetail({
        declaration: {
          author: 'test-author',
          name: 'test-plugin-name',
          category: 'model',
          label: { en_US: 'Test' },
          description: { en_US: 'Test' },
          icon: 'icon.png',
          verified: true,
        } as unknown as PluginDetail['declaration'],
      })
      const { result } = renderHook(() =>
        usePluginOperations({
          detail,
          modalStates,
          versionPicker,
          isFromMarketplace: true,
          onUpdate: mockOnUpdate,
        }),
      )

      await act(async () => {
        await result.current.handleDelete()
      })

      expect(mockRefreshModelProviders).toHaveBeenCalled()
    })

    it('should invalidate tool providers when deleting tool plugin', async () => {
      const detail = createPluginDetail({
        declaration: {
          author: 'test-author',
          name: 'test-plugin-name',
          category: 'tool',
          label: { en_US: 'Test' },
          description: { en_US: 'Test' },
          icon: 'icon.png',
          verified: true,
        } as unknown as PluginDetail['declaration'],
      })
      const { result } = renderHook(() =>
        usePluginOperations({
          detail,
          modalStates,
          versionPicker,
          isFromMarketplace: true,
          onUpdate: mockOnUpdate,
        }),
      )

      await act(async () => {
        await result.current.handleDelete()
      })

      expect(mockInvalidateAllToolProviders).toHaveBeenCalled()
    })

    it('should track plugin uninstalled event', async () => {
      const detail = createPluginDetail()
      const { result } = renderHook(() =>
        usePluginOperations({
          detail,
          modalStates,
          versionPicker,
          isFromMarketplace: true,
          onUpdate: mockOnUpdate,
        }),
      )

      await act(async () => {
        await result.current.handleDelete()
      })

      expect(amplitude.trackEvent).toHaveBeenCalledWith('plugin_uninstalled', expect.objectContaining({
        plugin_id: 'test-plugin',
        plugin_name: 'test-plugin-name',
      }))
    })

    it('should not call onUpdate when delete fails', async () => {
      mockUninstallPlugin.mockResolvedValueOnce({ success: false })
      const detail = createPluginDetail()
      const { result } = renderHook(() =>
        usePluginOperations({
          detail,
          modalStates,
          versionPicker,
          isFromMarketplace: true,
          onUpdate: mockOnUpdate,
        }),
      )

      await act(async () => {
        await result.current.handleDelete()
      })

      expect(mockOnUpdate).not.toHaveBeenCalled()
    })
  })

  describe('Optional onUpdate Callback', () => {
    it('should not throw when onUpdate is not provided for marketplace update', () => {
      const detail = createPluginDetail()
      const { result } = renderHook(() =>
        usePluginOperations({
          detail,
          modalStates,
          versionPicker,
          isFromMarketplace: true,
        }),
      )

      expect(() => {
        result.current.handleUpdatedFromMarketplace()
      }).not.toThrow()
    })

    it('should not throw when onUpdate is not provided for delete', async () => {
      const detail = createPluginDetail()
      const { result } = renderHook(() =>
        usePluginOperations({
          detail,
          modalStates,
          versionPicker,
          isFromMarketplace: true,
        }),
      )

      await expect(
        act(async () => {
          await result.current.handleDelete()
        }),
      ).resolves.not.toThrow()
    })
  })
})
