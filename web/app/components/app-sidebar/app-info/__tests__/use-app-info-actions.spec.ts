import { act, renderHook } from '@testing-library/react'
import { AppModeEnum } from '@/types/app'
import { useAppInfoActions } from '../use-app-info-actions'

const mockNotify = vi.fn()
const mockReplace = vi.fn()
const mockOnPlanInfoChanged = vi.fn()
const mockInvalidateAppList = vi.fn()
const mockSetAppDetail = vi.fn()
const mockUpdateAppInfo = vi.fn()
const mockCopyApp = vi.fn()
const mockExportAppConfig = vi.fn()
const mockDeleteApp = vi.fn()
const mockFetchWorkflowDraft = vi.fn()
const mockDownloadBlob = vi.fn()

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

vi.mock('use-context-selector', () => ({
  useContext: () => ({ notify: mockNotify }),
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

vi.mock('@/app/components/base/toast/context', () => ({
  ToastContext: {},
}))

vi.mock('@/service/use-apps', () => ({
  useInvalidateAppList: () => mockInvalidateAppList,
}))

vi.mock('@/service/apps', () => ({
  updateAppInfo: (...args: unknown[]) => mockUpdateAppInfo(...args),
  copyApp: (...args: unknown[]) => mockCopyApp(...args),
  exportAppConfig: (...args: unknown[]) => mockExportAppConfig(...args),
  deleteApp: (...args: unknown[]) => mockDeleteApp(...args),
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

vi.mock('@/config', () => ({
  NEED_REFRESH_APP_LIST_KEY: 'test-refresh-key',
}))

describe('useAppInfoActions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
      expect(mockNotify).toHaveBeenCalledWith({ type: 'success', message: 'app.editDone' })
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

      expect(mockNotify).toHaveBeenCalledWith({ type: 'error', message: 'app.editFailed' })
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
      expect(mockNotify).toHaveBeenCalledWith({ type: 'success', message: 'app.newApp.appCreated' })
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

      expect(mockNotify).toHaveBeenCalledWith({ type: 'error', message: 'app.newApp.appCreateFailed' })
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

      expect(mockNotify).toHaveBeenCalledWith({ type: 'error', message: 'app.exportFailed' })
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

      expect(mockNotify).toHaveBeenCalledWith({ type: 'error', message: 'app.exportFailed' })
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
      expect(mockNotify).toHaveBeenCalledWith({ type: 'success', message: 'app.appDeleted' })
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

      expect(mockNotify).toHaveBeenCalledWith({
        type: 'error',
        message: expect.stringContaining('app.appDeleteFailed'),
      })
    })
  })
})
