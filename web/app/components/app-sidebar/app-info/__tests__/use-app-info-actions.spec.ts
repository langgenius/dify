import { act, renderHook } from '@testing-library/react'
import { AppModeEnum } from '@/types/app'
import { useAppInfoActions } from '../use-app-info-actions'

const toastMocks = vi.hoisted(() => {
  const call = vi.fn()
  return {
    call,
    api: vi.fn((message: unknown, options?: Record<string, unknown>) => call({ message, ...options })),
    dismiss: vi.fn(),
    update: vi.fn(),
    promise: vi.fn(),
  }
})
const mockReplace = vi.fn()
const mockOnPlanInfoChanged = vi.fn()
const mockInvalidateAppList = vi.fn()
const mockSetAppDetail = vi.fn()
const mockUpdateAppInfo = vi.fn()
const mockCopyApp = vi.fn()
const mockExportAppConfig = vi.fn()
const mockDeleteApp = vi.fn()
const mockFetchAppDetail = vi.fn()
const mockFetchWorkflowDraft = vi.fn()
const mockDownloadBlob = vi.fn()
const mockGetSocket = vi.fn()
const mockOnAppMetaUpdate = vi.fn()

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
  useStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
    appDetail: mockAppDetail,
    setAppDetail: mockSetAppDetail,
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

vi.mock('@/service/use-apps', () => ({
  useInvalidateAppList: () => mockInvalidateAppList,
}))

vi.mock('@/service/apps', () => ({
  updateAppInfo: (...args: unknown[]) => mockUpdateAppInfo(...args),
  copyApp: (...args: unknown[]) => mockCopyApp(...args),
  exportAppConfig: (...args: unknown[]) => mockExportAppConfig(...args),
  deleteApp: (...args: unknown[]) => mockDeleteApp(...args),
  fetchAppDetail: (...args: unknown[]) => mockFetchAppDetail(...args),
}))

vi.mock('@/service/workflow', () => ({
  fetchWorkflowDraft: (...args: unknown[]) => mockFetchWorkflowDraft(...args),
}))

vi.mock('@/utils/download', () => ({
  downloadBlob: (...args: unknown[]) => mockDownloadBlob(...args),
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

vi.mock('@/config', () => ({
  NEED_REFRESH_APP_LIST_KEY: 'test-refresh-key',
}))

describe('useAppInfoActions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
      expect(result.current.panelOpen).toBe(false)
      expect(result.current.activeModal).toBeNull()
      expect(result.current.secretEnvList).toEqual([])
    })
  })

  describe('Panel management', () => {
    it('should toggle panelOpen', () => {
      const { result } = renderHook(() => useAppInfoActions({}))

      act(() => {
        result.current.setPanelOpen(true)
      })

      expect(result.current.panelOpen).toBe(true)
    })

    it('should close panel and call onDetailExpand', () => {
      const onDetailExpand = vi.fn()
      const { result } = renderHook(() => useAppInfoActions({ onDetailExpand }))

      act(() => {
        result.current.setPanelOpen(true)
      })

      act(() => {
        result.current.closePanel()
      })

      expect(result.current.panelOpen).toBe(false)
      expect(onDetailExpand).toHaveBeenCalledWith(false)
    })

    it('should reset app-scoped state when resetKey changes', () => {
      const { result, rerender } = renderHook(
        ({ resetKey }) => useAppInfoActions({ resetKey }),
        { initialProps: { resetKey: 'app-1' } },
      )

      act(() => {
        result.current.openModal('delete')
        result.current.setPanelOpen(true)
      })

      expect(result.current.panelOpen).toBe(true)
      expect(result.current.activeModal).toBe('delete')

      rerender({ resetKey: 'app-2' })

      expect(result.current.panelOpen).toBe(false)
      expect(result.current.activeModal).toBeNull()
      expect(result.current.secretEnvList).toEqual([])
    })
  })

  describe('Modal management', () => {
    it('should open modal and close panel', () => {
      const { result } = renderHook(() => useAppInfoActions({}))

      act(() => {
        result.current.setPanelOpen(true)
      })

      act(() => {
        result.current.openModal('edit')
      })

      expect(result.current.activeModal).toBe('edit')
      expect(result.current.panelOpen).toBe(false)
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
      await new Promise(resolve => setTimeout(resolve, 0))

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
      expect(toastMocks.call).toHaveBeenCalledWith({ type: 'success', message: 'app.newApp.appCreated' })
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

      expect(toastMocks.call).toHaveBeenCalledWith({ type: 'error', message: 'app.newApp.appCreateFailed' })
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
    it('should export app config and trigger download', async () => {
      mockExportAppConfig.mockResolvedValue({ data: 'yaml-content' })

      const { result } = renderHook(() => useAppInfoActions({}))

      await act(async () => {
        await result.current.onExport(false)
      })

      expect(mockExportAppConfig).toHaveBeenCalledWith({ appID: 'app-1', include: false })
      expect(mockDownloadBlob).toHaveBeenCalled()
    })

    it('should notify error on export failure', async () => {
      mockExportAppConfig.mockRejectedValue(new Error('fail'))

      const { result } = renderHook(() => useAppInfoActions({}))

      await act(async () => {
        await result.current.onExport()
      })

      expect(toastMocks.call).toHaveBeenCalledWith({ type: 'error', message: 'app.exportFailed' })
    })
  })

  describe('onExport - early return', () => {
    it('should not export when appDetail is undefined', async () => {
      mockAppDetail = undefined

      const { result } = renderHook(() => useAppInfoActions({}))

      await act(async () => {
        await result.current.onExport()
      })

      expect(mockExportAppConfig).not.toHaveBeenCalled()
    })
  })

  describe('exportCheck', () => {
    it('should call onExport directly for non-workflow modes', async () => {
      mockExportAppConfig.mockResolvedValue({ data: 'yaml' })

      const { result } = renderHook(() => useAppInfoActions({}))

      await act(async () => {
        await result.current.exportCheck()
      })

      expect(mockExportAppConfig).toHaveBeenCalled()
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

      expect(mockExportAppConfig).not.toHaveBeenCalled()
    })
  })

  describe('handleConfirmExport', () => {
    it('should export directly when no secret env variables', async () => {
      mockAppDetail = { ...mockAppDetail, mode: AppModeEnum.WORKFLOW }
      mockFetchWorkflowDraft.mockResolvedValue({
        environment_variables: [{ value_type: 'string' }],
      })
      mockExportAppConfig.mockResolvedValue({ data: 'yaml' })

      const { result } = renderHook(() => useAppInfoActions({}))

      await act(async () => {
        await result.current.handleConfirmExport()
      })

      expect(mockExportAppConfig).toHaveBeenCalled()
    })

    it('should set secret env list when secret variables exist', async () => {
      mockAppDetail = { ...mockAppDetail, mode: AppModeEnum.WORKFLOW }
      const secretVars = [{ value_type: 'secret', key: 'API_KEY' }]
      mockFetchWorkflowDraft.mockResolvedValue({
        environment_variables: secretVars,
      })

      const { result } = renderHook(() => useAppInfoActions({}))

      await act(async () => {
        await result.current.handleConfirmExport()
      })

      expect(result.current.secretEnvList).toEqual(secretVars)
    })

    it('should notify error on workflow draft fetch failure', async () => {
      mockFetchWorkflowDraft.mockRejectedValue(new Error('fail'))

      const { result } = renderHook(() => useAppInfoActions({}))

      await act(async () => {
        await result.current.handleConfirmExport()
      })

      expect(toastMocks.call).toHaveBeenCalledWith({ type: 'error', message: 'app.exportFailed' })
    })
  })

  describe('handleConfirmExport - early return', () => {
    it('should not do anything when appDetail is undefined', async () => {
      mockAppDetail = undefined

      const { result } = renderHook(() => useAppInfoActions({}))

      await act(async () => {
        await result.current.handleConfirmExport()
      })

      expect(mockFetchWorkflowDraft).not.toHaveBeenCalled()
    })
  })

  describe('handleConfirmExport - with environment variables', () => {
    it('should handle empty environment_variables', async () => {
      mockFetchWorkflowDraft.mockResolvedValue({
        environment_variables: undefined,
      })
      mockExportAppConfig.mockResolvedValue({ data: 'yaml' })

      const { result } = renderHook(() => useAppInfoActions({}))

      await act(async () => {
        await result.current.handleConfirmExport()
      })

      expect(mockExportAppConfig).toHaveBeenCalled()
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
      expect(toastMocks.call).toHaveBeenCalledWith({ type: 'success', message: 'app.appDeleted' })
      expect(mockInvalidateAppList).toHaveBeenCalled()
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
      await new Promise(resolve => setTimeout(resolve, 0))

      await act(async () => {
        await onUpdate?.()
      })

      expect(mockFetchAppDetail).toHaveBeenCalledWith({ url: '/apps', id: 'app-1' })
      expect(mockSetAppDetail).toHaveBeenCalledWith(updated)

      unmount()
      expect(unsubscribe).toHaveBeenCalled()
    })
  })
})
