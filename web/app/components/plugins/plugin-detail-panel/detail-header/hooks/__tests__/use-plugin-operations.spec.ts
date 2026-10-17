import type { PluginDetail } from '../../../../types'
import type { ModalStates, VersionTarget } from '../use-detail-header-state'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import * as amplitude from '@/app/components/base/amplitude'
import { createDeferred } from '@/test/deferred'
import { PluginSource } from '../../../../types'
import { usePluginOperations } from '../use-plugin-operations'

type VersionPickerMock = {
  setTargetVersion: (version: VersionTarget) => void
  setIsDowngrade: (downgrade: boolean) => void
}

const {
  mockSetShowUpdatePluginModal,
  mockInvalidateCheckInstalled,
  mockRefreshPluginList,
  mockUninstallPlugin,
  mockFetchReleases,
  mockToastNotify,
} = vi.hoisted(() => {
  return {
    mockSetShowUpdatePluginModal: vi.fn(),
    mockInvalidateCheckInstalled: vi.fn(),
    mockRefreshPluginList: vi.fn(),
    mockUninstallPlugin: vi.fn(() => Promise.resolve({ success: true })),
    mockFetchReleases: vi.fn(() => Promise.resolve([{ tag_name: 'v2.0.0' }])),
    mockToastNotify: vi.fn(),
  }
})

vi.mock('@/app/notifications', () => ({
  toast: Object.assign(
    (message: string, options?: { type?: string }) =>
      mockToastNotify({ type: options?.type, message }),
    {
      success: (message: string) => mockToastNotify({ type: 'success', message }),
      error: (message: string) => mockToastNotify({ type: 'error', message }),
      warning: (message: string) => mockToastNotify({ type: 'warning', message }),
      info: (message: string) => mockToastNotify({ type: 'info', message }),
      dismiss: vi.fn(),
      update: vi.fn(),
      promise: vi.fn(),
    },
  ),
}))

vi.mock('@/context/modal-context', () => ({
  useModalContext: () => ({
    setShowUpdatePluginModal: mockSetShowUpdatePluginModal,
  }),
}))

vi.mock('@/app/components/plugins/install-plugin/hooks/use-refresh-plugin-list', () => ({
  default: () => ({
    refreshPluginList: mockRefreshPluginList,
  }),
}))

vi.mock('@/service/plugins', () => ({
  uninstallPlugin: mockUninstallPlugin,
}))

vi.mock('@/service/use-plugins', () => ({
  useInvalidateCheckInstalled: () => mockInvalidateCheckInstalled,
}))

vi.mock('../../../../install-plugin/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../install-plugin/hooks')>()
  return {
    ...actual,
    fetchReleases: mockFetchReleases,
  }
})

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
    vi.spyOn(amplitude, 'trackEvent').mockImplementation(() => {})
  })

  describe('Marketplace Update Flow', () => {
    it.each([false, true])(
      'opens the marketplace update with downgrade=%s',
      async (isDowngrade) => {
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
          await result.current.handleUpdate(isDowngrade)
        })

        expect(versionPicker.setIsDowngrade).toHaveBeenCalledWith(isDowngrade)
        expect(modalStates.showUpdateModal).toHaveBeenCalled()
      },
    )

    it('waits for the updated plugin list before hiding the update modal', async () => {
      const detail = createPluginDetail({ source: PluginSource.marketplace })
      let resolveUpdate: (() => void) | undefined
      mockOnUpdate = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveUpdate = resolve
          }),
      )
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
        void result.current.handleUpdatedFromMarketplace()
      })

      expect(mockInvalidateCheckInstalled).toHaveBeenCalled()
      expect(mockOnUpdate).toHaveBeenCalled()
      expect(mockRefreshPluginList).not.toHaveBeenCalled()
      expect(modalStates.hideUpdateModal).not.toHaveBeenCalled()

      resolveUpdate?.()

      await waitFor(() => {
        expect(modalStates.hideUpdateModal).toHaveBeenCalled()
      })
    })
  })

  describe('GitHub Update Flow', () => {
    it('waits for the update callback when GitHub update save callback fires', async () => {
      const detail = createPluginDetail({
        source: PluginSource.github,
        meta: { repo: 'owner/repo', version: 'v1.0.0', package: 'pkg' },
      })
      let resolveUpdate: (() => void) | undefined
      mockOnUpdate = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveUpdate = resolve
          }),
      )
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
      expect(mockToastNotify).toHaveBeenCalledWith({
        type: 'info',
        message: 'New version available: v2.0.0',
      })
      expect(mockSetShowUpdatePluginModal).toHaveBeenCalledExactlyOnceWith({
        onSaveCallback: expect.any(Function),
        payload: {
          type: PluginSource.github,
          category: 'tool',
          github: {
            originalPackageInfo: {
              id: 'test-uid',
              repo: 'owner/repo',
              version: 'v1.0.0',
              package: 'pkg',
              releases: [{ tag_name: 'v2.0.0' }],
            },
          },
        },
      })
      const firstCall = mockSetShowUpdatePluginModal.mock.calls[0]![0]
      const updatePromise = firstCall.onSaveCallback()

      expect(mockInvalidateCheckInstalled).toHaveBeenCalled()
      expect(mockOnUpdate).toHaveBeenCalled()

      let didFinish = false
      void updatePromise.then(() => {
        didFinish = true
      })
      await Promise.resolve()
      expect(didFinish).toBe(false)

      resolveUpdate?.()
      await updatePromise
      expect(didFinish).toBe(true)
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
      mockFetchReleases.mockResolvedValueOnce([{ tag_name: 'v1.0.0' }])
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
    it.each(['model', 'tool'] as const)(
      'deletes a %s plugin and refreshes its catalog after success',
      async (category) => {
        const request = createDeferred<{ success: boolean }>()
        mockUninstallPlugin.mockReturnValueOnce(request.promise)
        const detail = createPluginDetail()
        detail.declaration.category = category
        const { result } = renderHook(() =>
          usePluginOperations({
            detail,
            modalStates,
            versionPicker,
            isFromMarketplace: true,
            onUpdate: mockOnUpdate,
          }),
        )
        let completion: Promise<void>
        act(() => {
          completion = result.current.handleDelete()
        })
        expect(mockUninstallPlugin).toHaveBeenCalledExactlyOnceWith('test-id')
        expect(modalStates.showDeleting).toHaveBeenCalledOnce()
        expect(modalStates.hideDeleting).not.toHaveBeenCalled()
        expect(mockOnUpdate).not.toHaveBeenCalled()
        await act(async () => {
          request.resolve({ success: true })
          await completion
        })
        expect(modalStates.hideDeleting).toHaveBeenCalledOnce()
        expect(modalStates.hideDeleteConfirm).toHaveBeenCalledOnce()
        expect(mockInvalidateCheckInstalled).toHaveBeenCalledOnce()
        expect(mockOnUpdate).toHaveBeenCalledExactlyOnceWith(true)
        expect(mockRefreshPluginList).toHaveBeenCalledExactlyOnceWith({ category })
        expect(amplitude.trackEvent).toHaveBeenCalledExactlyOnceWith('plugin_uninstalled', {
          plugin_id: 'test-plugin',
          plugin_name: 'test-plugin-name',
        })
      },
    )

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
      expect(modalStates.hideDeleting).toHaveBeenCalledOnce()
      expect(modalStates.hideDeleteConfirm).not.toHaveBeenCalled()
      expect(mockInvalidateCheckInstalled).not.toHaveBeenCalled()
      expect(mockRefreshPluginList).not.toHaveBeenCalled()
    })
  })
})
