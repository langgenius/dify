import type { PropsWithChildren } from 'react'
import { act, renderHook } from '@testing-library/react'
import * as React from 'react'
import { useStore } from '@/app/components/app/store'
import { ToastContext } from '@/app/components/base/toast'
import ProviderContext, { baseProviderContextValue } from '@/context/provider-context'
import { AppModeEnum } from '@/types/app'
import { getAppModeI18nKey, useAppInfoActions } from '../hooks/use-app-info-actions'

const mockReplace = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
}))

const mockUpdateAppInfo = vi.fn()
const mockCopyApp = vi.fn()
const mockDeleteApp = vi.fn()
const mockExportAppConfig = vi.fn()
vi.mock('@/service/apps', () => ({
  updateAppInfo: (...args: unknown[]) => mockUpdateAppInfo(...args),
  copyApp: (...args: unknown[]) => mockCopyApp(...args),
  deleteApp: (...args: unknown[]) => mockDeleteApp(...args),
  exportAppConfig: (...args: unknown[]) => mockExportAppConfig(...args),
}))

const mockFetchWorkflowDraft = vi.fn()
vi.mock('@/service/workflow', () => ({
  fetchWorkflowDraft: (...args: unknown[]) => mockFetchWorkflowDraft(...args),
}))

const mockInvalidateAppList = vi.fn()
vi.mock('@/service/use-apps', () => ({
  useInvalidateAppList: () => mockInvalidateAppList,
}))

vi.mock('@/utils/app-redirection', () => ({
  getRedirection: vi.fn(),
}))

const mockDownloadBlob = vi.fn()
vi.mock('@/utils/download', () => ({
  downloadBlob: (...args: unknown[]) => mockDownloadBlob(...args),
}))

const mockAppDetail = {
  id: 'app-1',
  name: 'Test App',
  mode: AppModeEnum.ADVANCED_CHAT,
  icon: '🤖',
  icon_type: 'emoji' as const,
  icon_background: '#FFEAD5',
  icon_url: '',
  description: 'A test application',
  use_icon_as_answer_icon: false,
  max_active_requests: null,
}

const mockNotify = vi.fn()
const mockOnPlanInfoChanged = vi.fn()
const mockClosePanel = vi.fn()

function createWrapper() {
  return ({ children }: PropsWithChildren) => (
    <ProviderContext.Provider value={{ ...baseProviderContextValue, onPlanInfoChanged: mockOnPlanInfoChanged }}>
      <ToastContext.Provider value={{ notify: mockNotify, close: vi.fn() }}>
        {children}
      </ToastContext.Provider>
    </ProviderContext.Provider>
  )
}

describe('getAppModeI18nKey', () => {
  it.each([
    [AppModeEnum.ADVANCED_CHAT, 'types.advanced'],
    [AppModeEnum.AGENT_CHAT, 'types.agent'],
    [AppModeEnum.CHAT, 'types.chatbot'],
    [AppModeEnum.COMPLETION, 'types.completion'],
    [AppModeEnum.WORKFLOW, 'types.workflow'],
  ] as const)('should map %s to %s', (mode, expected) => {
    expect(getAppModeI18nKey(mode)).toBe(expected)
  })

  it('should fallback to types.workflow for unknown mode', () => {
    expect(getAppModeI18nKey('unknown')).toBe('types.workflow')
    expect(getAppModeI18nKey('')).toBe('types.workflow')
  })
})

describe('useAppInfoActions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useStore.setState({ appDetail: mockAppDetail } as never)
  })

  function renderActions() {
    return renderHook(() => useAppInfoActions({ closePanel: mockClosePanel }), { wrapper: createWrapper() })
  }

  describe('initial state', () => {
    it('should return null activeModal and empty state', () => {
      const { result } = renderActions()
      expect(result.current.activeModal).toBeNull()
      expect(result.current.showExportWarning).toBe(false)
      expect(result.current.secretEnvList).toEqual([])
      expect(result.current.appDetail).toEqual(mockAppDetail)
    })
  })

  describe('modal management', () => {
    it('should open modal and close panel', () => {
      const { result } = renderActions()
      act(() => {
        result.current.primaryOperations[0].onClick()
      })
      expect(result.current.activeModal).toBe('edit')
      expect(mockClosePanel).toHaveBeenCalledTimes(1)
    })

    it('should close modal', () => {
      const { result } = renderActions()
      act(() => {
        result.current.primaryOperations[0].onClick()
      })
      act(() => {
        result.current.closeModal()
      })
      expect(result.current.activeModal).toBeNull()
    })
  })

  describe('onEdit', () => {
    const editPayload = {
      name: 'Updated App',
      icon_type: 'emoji' as const,
      icon: '🚀',
      icon_background: '#fff',
      description: 'new desc',
      use_icon_as_answer_icon: false,
      max_active_requests: null,
    }

    it('should update app detail on success', async () => {
      const updatedApp = { ...mockAppDetail, ...editPayload }
      mockUpdateAppInfo.mockResolvedValue(updatedApp)

      const { result } = renderActions()
      await act(async () => {
        await result.current.onEdit(editPayload)
      })

      expect(mockUpdateAppInfo).toHaveBeenCalledWith(expect.objectContaining({
        appID: 'app-1',
        name: 'Updated App',
      }))
      expect(useStore.getState().appDetail).toEqual(updatedApp)
      expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }))
      expect(result.current.activeModal).toBeNull()
    })

    it('should notify error on failure', async () => {
      mockUpdateAppInfo.mockRejectedValue(new Error('fail'))
      const { result } = renderActions()
      await act(async () => {
        await result.current.onEdit(editPayload)
      })
      expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))
    })

    it('should return early when appDetail is null', async () => {
      useStore.setState({ appDetail: undefined } as never)
      const { result } = renderActions()
      await act(async () => {
        await result.current.onEdit(editPayload)
      })
      expect(mockUpdateAppInfo).not.toHaveBeenCalled()
    })
  })

  describe('onCopy', () => {
    const copyPayload = { name: 'Copy', icon_type: 'emoji' as const, icon: '🤖', icon_background: '#fff' }

    it('should copy app and redirect on success', async () => {
      const newApp = { ...mockAppDetail, id: 'app-2' }
      mockCopyApp.mockResolvedValue(newApp)

      const { result } = renderActions()
      await act(async () => {
        await result.current.onCopy(copyPayload)
      })

      expect(mockCopyApp).toHaveBeenCalled()
      expect(mockOnPlanInfoChanged).toHaveBeenCalled()
      expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }))
    })

    it('should notify error on failure', async () => {
      mockCopyApp.mockRejectedValue(new Error('fail'))
      const { result } = renderActions()
      await act(async () => {
        await result.current.onCopy(copyPayload)
      })
      expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))
    })

    it('should return early when appDetail is null', async () => {
      useStore.setState({ appDetail: undefined } as never)
      const { result } = renderActions()
      await act(async () => {
        await result.current.onCopy(copyPayload)
      })
      expect(mockCopyApp).not.toHaveBeenCalled()
    })
  })

  describe('onExport', () => {
    it('should download YAML blob on success', async () => {
      mockExportAppConfig.mockResolvedValue({ data: 'yaml-content' })
      const { result } = renderActions()
      await act(async () => {
        await result.current.onExport()
      })
      expect(mockDownloadBlob).toHaveBeenCalledWith(expect.objectContaining({
        fileName: 'Test App.yml',
      }))
    })

    it('should call with include=true when specified', async () => {
      mockExportAppConfig.mockResolvedValue({ data: 'yaml' })
      const { result } = renderActions()
      await act(async () => {
        await result.current.onExport(true)
      })
      expect(mockExportAppConfig).toHaveBeenCalledWith({ appID: 'app-1', include: true })
    })

    it('should notify error on failure', async () => {
      mockExportAppConfig.mockRejectedValue(new Error('fail'))
      const { result } = renderActions()
      await act(async () => {
        await result.current.onExport()
      })
      expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))
    })

    it('should return early when appDetail is null', async () => {
      useStore.setState({ appDetail: undefined } as never)
      const { result } = renderActions()
      await act(async () => {
        await result.current.onExport()
      })
      expect(mockExportAppConfig).not.toHaveBeenCalled()
    })
  })

  describe('exportCheck', () => {
    it('should show export warning for workflow-like modes', async () => {
      const { result } = renderActions()
      await act(async () => {
        await result.current.exportCheck()
      })
      expect(result.current.showExportWarning).toBe(true)
    })

    it('should directly export for non-workflow modes', async () => {
      useStore.setState({ appDetail: { ...mockAppDetail, mode: AppModeEnum.CHAT } } as never)
      mockExportAppConfig.mockResolvedValue({ data: 'yaml' })

      const { result } = renderActions()
      await act(async () => {
        await result.current.exportCheck()
      })
      expect(result.current.showExportWarning).toBe(false)
      expect(mockExportAppConfig).toHaveBeenCalled()
    })

    it('should return early when appDetail is null', async () => {
      useStore.setState({ appDetail: undefined } as never)
      const { result } = renderActions()
      await act(async () => {
        await result.current.exportCheck()
      })
      expect(result.current.showExportWarning).toBe(false)
    })
  })

  describe('handleConfirmExport', () => {
    it('should export directly when no secret envs', async () => {
      mockFetchWorkflowDraft.mockResolvedValue({ environment_variables: [] })
      mockExportAppConfig.mockResolvedValue({ data: 'yaml' })

      const { result } = renderActions()
      await act(async () => {
        await result.current.handleConfirmExport()
      })
      expect(result.current.showExportWarning).toBe(false)
      expect(mockExportAppConfig).toHaveBeenCalled()
    })

    it('should set secretEnvList when secrets exist', async () => {
      const secrets = [{ id: 'e1', key: 'KEY', value: '***', value_type: 'secret' }]
      mockFetchWorkflowDraft.mockResolvedValue({ environment_variables: secrets })

      const { result } = renderActions()
      await act(async () => {
        await result.current.handleConfirmExport()
      })
      expect(result.current.secretEnvList).toHaveLength(1)
      expect(mockExportAppConfig).not.toHaveBeenCalled()
    })

    it('should notify error on failure', async () => {
      mockFetchWorkflowDraft.mockRejectedValue(new Error('fail'))
      const { result } = renderActions()
      await act(async () => {
        await result.current.handleConfirmExport()
      })
      expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))
    })

    it('should return early when appDetail is null', async () => {
      useStore.setState({ appDetail: undefined } as never)
      const { result } = renderActions()
      await act(async () => {
        await result.current.handleConfirmExport()
      })
      expect(mockFetchWorkflowDraft).not.toHaveBeenCalled()
    })
  })

  describe('onConfirmDelete', () => {
    it('should delete app and redirect', async () => {
      mockDeleteApp.mockResolvedValue(undefined)
      const { result } = renderActions()
      await act(async () => {
        await result.current.onConfirmDelete()
      })

      expect(mockDeleteApp).toHaveBeenCalledWith('app-1')
      expect(mockInvalidateAppList).toHaveBeenCalled()
      expect(mockOnPlanInfoChanged).toHaveBeenCalled()
      expect(mockReplace).toHaveBeenCalledWith('/apps')
      expect(useStore.getState().appDetail).toBeUndefined()
    })

    it('should include error message from object error', async () => {
      mockDeleteApp.mockRejectedValue({ message: 'not found' })
      const { result } = renderActions()
      await act(async () => {
        await result.current.onConfirmDelete()
      })
      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining('not found') }),
      )
    })

    it('should handle non-object error gracefully', async () => {
      mockDeleteApp.mockRejectedValue('string error')
      const { result } = renderActions()
      await act(async () => {
        await result.current.onConfirmDelete()
      })
      expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))
    })

    it('should return early when appDetail is null', async () => {
      useStore.setState({ appDetail: undefined } as never)
      const { result } = renderActions()
      await act(async () => {
        await result.current.onConfirmDelete()
      })
      expect(mockDeleteApp).not.toHaveBeenCalled()
    })
  })

  describe('closeExportWarning', () => {
    it('should reset showExportWarning to false', async () => {
      const { result } = renderActions()
      await act(async () => {
        await result.current.exportCheck()
      })
      expect(result.current.showExportWarning).toBe(true)
      act(() => {
        result.current.closeExportWarning()
      })
      expect(result.current.showExportWarning).toBe(false)
    })
  })

  describe('clearSecretEnvList', () => {
    it('should reset secretEnvList to empty', async () => {
      mockFetchWorkflowDraft.mockResolvedValue({
        environment_variables: [{ id: 'e1', key: 'K', value: '***', value_type: 'secret' }],
      })
      const { result } = renderActions()
      await act(async () => {
        await result.current.handleConfirmExport()
      })
      expect(result.current.secretEnvList).toHaveLength(1)
      act(() => {
        result.current.clearSecretEnvList()
      })
      expect(result.current.secretEnvList).toHaveLength(0)
    })
  })

  describe('operation lists', () => {
    it('should build primaryOperations with 3 items', () => {
      const { result } = renderActions()
      expect(result.current.primaryOperations).toHaveLength(3)
      expect(result.current.primaryOperations.map(op => op.id)).toEqual(['edit', 'duplicate', 'export'])
    })

    it('should include import in secondaryOperations for workflow-like mode', () => {
      const { result } = renderActions()
      expect(result.current.secondaryOperations.some(op => op.id === 'import')).toBe(true)
      expect(result.current.secondaryOperations.some(op => op.id === 'delete')).toBe(true)
    })

    it('should exclude import for non-workflow mode', () => {
      useStore.setState({ appDetail: { ...mockAppDetail, mode: AppModeEnum.CHAT } } as never)
      const { result } = renderActions()
      expect(result.current.secondaryOperations.some(op => op.id === 'import')).toBe(false)
    })

    it('should return switchOperation for basic app modes', () => {
      useStore.setState({ appDetail: { ...mockAppDetail, mode: AppModeEnum.CHAT } } as never)
      const { result } = renderActions()
      expect(result.current.switchOperation).not.toBeNull()
      expect(result.current.switchOperation!.id).toBe('switch')
    })

    it('should return null switchOperation for workflow-like modes', () => {
      const { result } = renderActions()
      expect(result.current.switchOperation).toBeNull()
    })

    it('should return switchOperation for completion mode', () => {
      useStore.setState({ appDetail: { ...mockAppDetail, mode: AppModeEnum.COMPLETION } } as never)
      const { result } = renderActions()
      expect(result.current.switchOperation).not.toBeNull()
    })

    it('should open duplicate modal via primaryOperations onClick', () => {
      const { result } = renderActions()
      act(() => {
        result.current.primaryOperations[1].onClick()
      })
      expect(result.current.activeModal).toBe('duplicate')
    })

    it('should trigger exportCheck via primaryOperations onClick', async () => {
      const { result } = renderActions()
      await act(async () => {
        result.current.primaryOperations[2].onClick()
      })
      expect(result.current.showExportWarning).toBe(true)
    })

    it('should open importDSL modal via secondaryOperations onClick', () => {
      const { result } = renderActions()
      const importOp = result.current.secondaryOperations.find(op => op.id === 'import')!
      act(() => {
        importOp.onClick()
      })
      expect(result.current.activeModal).toBe('importDSL')
    })

    it('should open confirmDelete modal via secondaryOperations onClick', () => {
      const { result } = renderActions()
      const deleteOp = result.current.secondaryOperations.find(op => op.id === 'delete')!
      act(() => {
        deleteOp.onClick()
      })
      expect(result.current.activeModal).toBe('confirmDelete')
    })

    it('should open switch modal via switchOperation onClick', () => {
      useStore.setState({ appDetail: { ...mockAppDetail, mode: AppModeEnum.CHAT } } as never)
      const { result } = renderActions()
      act(() => {
        result.current.switchOperation!.onClick()
      })
      expect(result.current.activeModal).toBe('switch')
    })

    it('should have divider in secondaryOperations', () => {
      const { result } = renderActions()
      expect(result.current.secondaryOperations.some(op => op.type === 'divider')).toBe(true)
    })
  })
})
