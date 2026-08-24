import { act, renderHook } from '@testing-library/react'
import { consoleQuery } from '@/service/client'
import { AppModeEnum } from '@/types/app'
import { useAppInfoActions } from '../use-app-info-actions'

const toastMocks = vi.hoisted(() => {
  const call = vi.fn()
  return {
    call,
    api: vi.fn((message: unknown, options?: Record<string, unknown>) =>
      call({ message, ...options }),
    ),
    dismiss: vi.fn(),
    update: vi.fn(),
    promise: vi.fn(),
  }
})
const mockReplace = vi.fn()
const mockOnPlanInfoChanged = vi.fn()
const mockInvalidateQueries = vi.fn()
const mockSetAppDetail = vi.fn()
const mockUpdateAppInfo = vi.fn()
const mockCopyApp = vi.fn()
const mockExportAppDsl = vi.fn()
const mockExportState = { isExporting: false }
const mockExportWorkflowAppDsl = vi.fn()
const mockWorkflowExportState = { isExporting: false }
const mockDeleteApp = vi.fn()
const mockFetchAppDetail = vi.fn()
const mockMarkAppDeletionStarted = vi.fn()
const mockMarkAppDeletionSucceeded = vi.fn()
const mockMarkAppDeletionFailed = vi.fn()
const mockGetSocket = vi.fn()
const mockOnAppMetaUpdate = vi.fn()
const mockSetQueryData = vi.fn()

let mockAppDetail: Record<string, unknown> | undefined = {
  id: 'app-1',
  name: 'Test App',
  mode: AppModeEnum.CHAT,
  icon: '🤖',
  icon_type: 'emoji',
  icon_background: '#FFEAD5',
}

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
}))

vi.mock('@/context/provider-context', () => ({
  useProviderContext: () => ({ onPlanInfoChanged: mockOnPlanInfoChanged }),
}))

vi.mock('@/app/components/app/store', () => ({
  useStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      appDetail: mockAppDetail,
      setAppDetail: mockSetAppDetail,
    }),
}))

vi.mock('@/app/components/app/use-export-app-dsl', () => ({
  useExportAppDsl: () => ({
    exportAppDsl: mockExportAppDsl,
    isExporting: mockExportState.isExporting,
  }),
  useExportWorkflowAppDsl: () => ({
    exportWorkflowAppDsl: mockExportWorkflowAppDsl,
    isExporting: mockWorkflowExportState.isExporting,
  }),
}))

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: Object.assign(toastMocks.api, {
    success: vi.fn((message, options) => toastMocks.call({ type: 'success', message, ...options })),
    error: vi.fn((message, options) => toastMocks.call({ type: 'error', message, ...options })),
    warning: vi.fn((message, options) => toastMocks.call({ type: 'warning', message, ...options })),
    info: vi.fn((message, options) => toastMocks.call({ type: 'info', message, ...options })),
    dismiss: toastMocks.dismiss,
    update: toastMocks.update,
    promise: toastMocks.promise,
  }),
}))

vi.mock('@tanstack/react-query', () => ({
  queryOptions: <TOptions>(options: TOptions) => options,
  useSuspenseQuery: () => ({
    data: { rbac_enabled: true },
  }),
  useQueryClient: () => ({
    invalidateQueries: mockInvalidateQueries,
    setQueryData: mockSetQueryData,
  }),
}))

vi.mock('@/service/apps', () => ({
  updateAppInfo: (...args: unknown[]) => mockUpdateAppInfo(...args),
  copyApp: (...args: unknown[]) => mockCopyApp(...args),
  deleteApp: (...args: unknown[]) => mockDeleteApp(...args),
  fetchAppDetail: (...args: unknown[]) => mockFetchAppDetail(...args),
}))

vi.mock('@/service/app-deletion', () => ({
  markAppDeletionStarted: (...args: unknown[]) => mockMarkAppDeletionStarted(...args),
  markAppDeletionSucceeded: (...args: unknown[]) => mockMarkAppDeletionSucceeded(...args),
  markAppDeletionFailed: (...args: unknown[]) => mockMarkAppDeletionFailed(...args),
}))

vi.mock('@/utils/app-redirection', () => ({
  getRedirection: vi.fn(),
}))

vi.mock('@/app/components/workflow/collaboration/core/websocket-manager', () => ({
  webSocketClient: {
    getSocket: (...args: unknown[]) => mockGetSocket(...args),
  },
}))

vi.mock('@/app/components/workflow/collaboration/core/collaboration-manager', () => ({
  collaborationManager: {
    onAppMetaUpdate: (...args: unknown[]) => mockOnAppMetaUpdate(...args),
  },
}))

describe('useAppInfoActions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockExportState.isExporting = false
    mockExportAppDsl.mockResolvedValue({ status: 'downloaded' })
    mockWorkflowExportState.isExporting = false
    mockExportWorkflowAppDsl.mockResolvedValue({ status: 'downloaded' })
    mockOnAppMetaUpdate.mockReturnValue(() => {})
    mockGetSocket.mockReturnValue(null)
    mockAppDetail = {
      id: 'app-1',
      name: 'Test App',
      mode: AppModeEnum.CHAT,
      icon: '🤖',
      icon_type: 'emoji',
      icon_background: '#FFEAD5',
    }
  })

  describe('Initial state', () => {
    it('should return initial state correctly', () => {
      const { result } = renderHook(() => useAppInfoActions({}))
      expect(result.current.appDetail).toEqual(mockAppDetail)
      expect(result.current.activeModal).toBeNull()
      expect(result.current.secretEnvList).toEqual([])
    })
  })

  describe('App-scoped state', () => {
    it('should reset app-scoped state when resetKey changes', () => {
      const { result, rerender } = renderHook(({ resetKey }) => useAppInfoActions({ resetKey }), {
        initialProps: { resetKey: 'app-1' },
      })

      act(() => {
        result.current.openModal('delete')
      })

      expect(result.current.activeModal).toBe('delete')

      rerender({ resetKey: 'app-2' })

      expect(result.current.activeModal).toBeNull()
      expect(result.current.secretEnvList).toEqual([])
    })
  })

  describe('Modal management', () => {
    it('should open modal', () => {
      const { result } = renderHook(() => useAppInfoActions({}))

      act(() => {
        result.current.openModal('edit')
      })

      expect(result.current.activeModal).toBe('edit')
    })

    it('should close modal', () => {
      const { result } = renderHook(() => useAppInfoActions({}))

      act(() => {
        result.current.openModal('delete')
      })

      act(() => {
        result.current.closeModal()
      })

      expect(result.current.activeModal).toBeNull()
    })
  })

  describe('onEdit', () => {
    it('should update app info and close modal on success', async () => {
      const updatedApp = { ...mockAppDetail, name: 'Updated' }
      mockUpdateAppInfo.mockResolvedValue(updatedApp)

      const { result } = renderHook(() => useAppInfoActions({}))

      await act(async () => {
        await result.current.onEdit({
          name: 'Updated',
          icon_type: 'emoji',
          icon: '🤖',
          icon_background: '#fff',
          description: '',
          use_icon_as_answer_icon: false,
        })
      })

      expect(mockUpdateAppInfo).toHaveBeenCalled()
      expect(mockSetQueryData).toHaveBeenCalledWith(
        consoleQuery.apps.byAppId.get.queryKey({
          input: { params: { app_id: 'app-1' } },
        }),
        expect.any(Function),
      )
      const updateCachedApp = mockSetQueryData.mock.calls[0]![1]
      expect(updateCachedApp({ id: 'app-1', name: 'Old name' })).toEqual(
        expect.objectContaining({ id: 'app-1', name: 'Updated' }),
      )
      expect(mockInvalidateQueries).toHaveBeenCalledWith({
        queryKey: consoleQuery.apps.get.key(),
      })
      expect(mockInvalidateQueries).toHaveBeenCalledWith({
        queryKey: consoleQuery.apps.starred.get.key(),
      })
      expect(mockInvalidateQueries).toHaveBeenCalledWith({
        queryKey: consoleQuery.apps.recent.get.key(),
      })
      expect(mockSetAppDetail).toHaveBeenCalledWith(updatedApp)
      expect(toastMocks.call).toHaveBeenCalledWith({ type: 'success', message: 'app.editDone' })
    })

    it('should emit app_meta_update after successful edit when collaboration socket exists', async () => {
      const updatedApp = { ...mockAppDetail, name: 'Updated' }
      const socket = { emit: vi.fn() }
      mockUpdateAppInfo.mockResolvedValue(updatedApp)
      mockGetSocket.mockReturnValue(socket)

      const { result } = renderHook(() => useAppInfoActions({}))

      await act(async () => {
        await result.current.onEdit({
          name: 'Updated',
          icon_type: 'emoji',
          icon: '🤖',
          icon_background: '#fff',
          description: '',
          use_icon_as_answer_icon: false,
        })
      })
      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(mockGetSocket).toHaveBeenCalledWith('app-1')
      expect(socket.emit).toHaveBeenCalledWith(
        'collaboration_event',
        expect.objectContaining({
          type: 'app_meta_update',
        }),
      )
    })

    it('should notify error on edit failure', async () => {
      mockUpdateAppInfo.mockRejectedValue(new Error('fail'))

      const { result } = renderHook(() => useAppInfoActions({}))

      await act(async () => {
        await result.current.onEdit({
          name: 'Updated',
          icon_type: 'emoji',
          icon: '🤖',
          icon_background: '#fff',
          description: '',
          use_icon_as_answer_icon: false,
        })
      })

      expect(toastMocks.call).toHaveBeenCalledWith({ type: 'error', message: 'app.editFailed' })
    })

    it('should not call updateAppInfo when appDetail is undefined', async () => {
      mockAppDetail = undefined

      const { result } = renderHook(() => useAppInfoActions({}))

      await act(async () => {
        await result.current.onEdit({
          name: 'Updated',
          icon_type: 'emoji',
          icon: '🤖',
          icon_background: '#fff',
          description: '',
          use_icon_as_answer_icon: false,
        })
      })

      expect(mockUpdateAppInfo).not.toHaveBeenCalled()
    })
  })

  describe('onCopy', () => {
    it('should copy app and redirect on success', async () => {
      const newApp = { id: 'app-2', name: 'Copy', mode: 'chat' }
      mockCopyApp.mockResolvedValue(newApp)

      const { result } = renderHook(() => useAppInfoActions({}))

      await act(async () => {
        await result.current.onCopy({
          name: 'Copy',
          icon_type: 'emoji',
          icon: '🤖',
          icon_background: '#fff',
        })
      })

      expect(mockCopyApp).toHaveBeenCalled()
      expect(mockInvalidateQueries).toHaveBeenCalledTimes(3)
      expect(toastMocks.call).toHaveBeenCalledWith({
        type: 'success',
        message: 'app.newApp.appCreated',
      })
      expect(mockOnPlanInfoChanged).toHaveBeenCalled()
    })

    it('should notify error on copy failure', async () => {
      mockCopyApp.mockRejectedValue(new Error('fail'))

      const { result } = renderHook(() => useAppInfoActions({}))

      await act(async () => {
        await result.current.onCopy({
          name: 'Copy',
          icon_type: 'emoji',
          icon: '🤖',
          icon_background: '#fff',
        })
      })

      expect(toastMocks.call).toHaveBeenCalledWith({
        type: 'error',
        message: 'app.newApp.appCreateFailed',
      })
    })
  })

  describe('onCopy - early return', () => {
    it('should not call copyApp when appDetail is undefined', async () => {
      mockAppDetail = undefined

      const { result } = renderHook(() => useAppInfoActions({}))

      await act(async () => {
        await result.current.onCopy({
          name: 'Copy',
          icon_type: 'emoji',
          icon: '🤖',
          icon_background: '#fff',
        })
      })

      expect(mockCopyApp).not.toHaveBeenCalled()
    })
  })

  describe('onExport', () => {
    it('should export the app DSL', async () => {
      const { result } = renderHook(() => useAppInfoActions({}))

      await act(async () => {
        await result.current.onExport(false)
      })

      expect(mockExportAppDsl).toHaveBeenCalledWith({
        appId: 'app-1',
        appName: 'Test App',
        includeSecret: false,
      })
    })
  })

  describe('onExport - early return', () => {
    it('should not export when appDetail is undefined', async () => {
      mockAppDetail = undefined

      const { result } = renderHook(() => useAppInfoActions({}))

      await act(async () => {
        await result.current.onExport()
      })

      expect(mockExportAppDsl).not.toHaveBeenCalled()
    })
  })

  describe('exportCheck', () => {
    it('should call onExport directly for non-workflow modes', async () => {
      const { result } = renderHook(() => useAppInfoActions({}))

      await act(async () => {
        await result.current.exportCheck()
      })

      expect(mockExportAppDsl).toHaveBeenCalled()
    })

    it('should open export warning modal for workflow mode', async () => {
      mockAppDetail = { ...mockAppDetail, mode: AppModeEnum.WORKFLOW }

      const { result } = renderHook(() => useAppInfoActions({}))

      await act(async () => {
        await result.current.exportCheck()
      })

      expect(result.current.activeModal).toBe('exportWarning')
    })

    it('should open export warning modal for advanced_chat mode', async () => {
      mockAppDetail = { ...mockAppDetail, mode: AppModeEnum.ADVANCED_CHAT }

      const { result } = renderHook(() => useAppInfoActions({}))

      await act(async () => {
        await result.current.exportCheck()
      })

      expect(result.current.activeModal).toBe('exportWarning')
    })
  })

  describe('exportCheck - early return', () => {
    it('should not do anything when appDetail is undefined', async () => {
      mockAppDetail = undefined

      const { result } = renderHook(() => useAppInfoActions({}))

      await act(async () => {
        await result.current.exportCheck()
      })

      expect(mockExportAppDsl).not.toHaveBeenCalled()
    })
  })

  describe('handleConfirmExport', () => {
    it('should export directly when no secret env variables', async () => {
      mockAppDetail = { ...mockAppDetail, mode: AppModeEnum.WORKFLOW }
      const { result } = renderHook(() => useAppInfoActions({}))

      await act(async () => {
        await result.current.handleConfirmExport()
      })

      expect(mockExportWorkflowAppDsl).toHaveBeenCalledWith({
        appId: 'app-1',
        appName: 'Test App',
      })
    })

    it('should set secret env list when secret variables exist', async () => {
      mockAppDetail = { ...mockAppDetail, mode: AppModeEnum.WORKFLOW }
      const secretVars = [{ value_type: 'secret', name: 'API_KEY', value: 'secret' }]
      mockExportWorkflowAppDsl.mockResolvedValue({
        status: 'confirmation-required',
        secretEnvList: secretVars,
      })

      const { result } = renderHook(() => useAppInfoActions({}))

      await act(async () => {
        await result.current.handleConfirmExport()
      })

      expect(result.current.secretEnvList).toEqual(secretVars)
    })
  })

  describe('handleConfirmExport - early return', () => {
    it('should not do anything when appDetail is undefined', async () => {
      mockAppDetail = undefined

      const { result } = renderHook(() => useAppInfoActions({}))

      await act(async () => {
        await result.current.handleConfirmExport()
      })

      expect(mockExportWorkflowAppDsl).not.toHaveBeenCalled()
    })
  })

  describe('onConfirmDelete', () => {
    it('should delete app and redirect on success', async () => {
      mockDeleteApp.mockResolvedValue({})

      const { result } = renderHook(() => useAppInfoActions({}))

      await act(async () => {
        await result.current.onConfirmDelete()
      })

      expect(mockDeleteApp).toHaveBeenCalledWith('app-1')
      expect(mockMarkAppDeletionStarted).toHaveBeenCalledWith('app-1')
      expect(mockMarkAppDeletionSucceeded).toHaveBeenCalledWith('app-1')
      expect(mockMarkAppDeletionFailed).not.toHaveBeenCalled()
      expect(toastMocks.call).toHaveBeenCalledWith({ type: 'success', message: 'app.appDeleted' })
      expect(mockInvalidateQueries).toHaveBeenCalledTimes(3)
      expect(mockReplace).toHaveBeenCalledWith('/apps')
      expect(mockSetAppDetail).toHaveBeenCalledWith()
    })

    it('should not delete when appDetail is undefined', async () => {
      mockAppDetail = undefined

      const { result } = renderHook(() => useAppInfoActions({}))

      await act(async () => {
        await result.current.onConfirmDelete()
      })

      expect(mockDeleteApp).not.toHaveBeenCalled()
    })

    it('should notify error on delete failure', async () => {
      mockDeleteApp.mockRejectedValue({ message: 'cannot delete' })

      const { result } = renderHook(() => useAppInfoActions({}))

      await act(async () => {
        await result.current.onConfirmDelete()
      })

      expect(mockMarkAppDeletionStarted).toHaveBeenCalledWith('app-1')
      expect(mockMarkAppDeletionFailed).toHaveBeenCalledWith('app-1')
      expect(mockMarkAppDeletionSucceeded).not.toHaveBeenCalled()
      expect(toastMocks.call).toHaveBeenCalledWith({
        type: 'error',
        message: expect.stringContaining('app.appDeleteFailed'),
      })
    })
  })

  describe('collaboration app meta updates', () => {
    it('should refresh app detail when receiving app_meta_update', async () => {
      const updated = { ...mockAppDetail, name: 'Remote Updated' }
      const unsubscribe = vi.fn()
      let onUpdate: (() => Promise<void>) | undefined

      mockOnAppMetaUpdate.mockImplementation((callback: () => Promise<void>) => {
        onUpdate = callback
        return unsubscribe
      })
      mockFetchAppDetail.mockResolvedValue(updated)

      const { unmount } = renderHook(() => useAppInfoActions({}))
      await new Promise((resolve) => setTimeout(resolve, 0))

      await act(async () => {
        await onUpdate?.()
      })

      expect(mockFetchAppDetail).toHaveBeenCalledWith({ url: '/apps', id: 'app-1' })
      expect(mockSetQueryData).toHaveBeenCalledWith(
        consoleQuery.apps.byAppId.get.queryKey({
          input: { params: { app_id: 'app-1' } },
        }),
        expect.any(Function),
      )
      const updateCachedApp = mockSetQueryData.mock.calls[0]![1]
      expect(updateCachedApp({ id: 'app-1', name: 'Old name' })).toEqual(
        expect.objectContaining({ id: 'app-1', name: 'Remote Updated' }),
      )
      expect(mockSetAppDetail).toHaveBeenCalledWith(updated)

      unmount()
      expect(unsubscribe).toHaveBeenCalled()
    })
  })
})
