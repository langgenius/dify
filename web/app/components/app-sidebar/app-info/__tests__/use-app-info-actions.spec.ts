import type { AppDetailWithSite } from '@dify/contracts/api/console/apps/types.gen'
import { act, waitFor } from '@testing-library/react'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient, renderHookWithConsoleQuery } from '@/test/console/query-data'
import { createAppDetailFixture } from '@/test/fixtures/app'
import { AppModeEnum } from '@/types/app'
import { getRedirection } from '@/utils/app-redirection'
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

let mockAppDetail: AppDetailWithSite | undefined

const appDetailQueryKey = consoleQuery.apps.byAppId.get.queryKey({
  input: { params: { app_id: 'app-1' } },
})
const appListQueryKeys = [
  consoleQuery.apps.get.key(),
  consoleQuery.apps.starred.get.key(),
  consoleQuery.apps.recent.get.key(),
]

const createDeferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

const renderActions = () => {
  const queryClient = createConsoleQueryClient()
  if (mockAppDetail) queryClient.setQueryData(appDetailQueryKey, mockAppDetail)
  for (const queryKey of appListQueryKeys) queryClient.setQueryData(queryKey, { data: [] })
  return renderHookWithConsoleQuery(() => useAppInfoActions(), {
    queryClient,
    systemFeatures: { rbac_enabled: true },
  })
}

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
  useParams: () => ({ appId: mockAppDetail?.id }),
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

vi.mock('@/app/notifications', () => ({
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

vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  request: async (url: string, _init: RequestInit, { request }: { request: Request }) => {
    if (request.method === 'GET') return Response.json(await mockFetchAppDetail(url))
    if (request.method === 'PUT') {
      const result = await mockUpdateAppInfo(url, await request.json())
      mockFetchAppDetail.mockResolvedValue(result)
      return Response.json(result)
    }
    if (request.method === 'POST' && new URL(url).pathname.endsWith('/copy'))
      return Response.json(await mockCopyApp(url, await request.json()))
    if (request.method === 'DELETE') {
      await mockDeleteApp(url)
      return new Response(null, { status: 204 })
    }
    throw new Error(`Unexpected request: ${request.method} ${url}`)
  },
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

describe('useAppInfoActions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockExportState.isExporting = false
    mockExportAppDsl.mockResolvedValue({ status: 'downloaded' })
    mockWorkflowExportState.isExporting = false
    mockExportWorkflowAppDsl.mockResolvedValue({ status: 'downloaded' })
    mockGetSocket.mockReturnValue(null)
    mockAppDetail = createAppDetailFixture({
      id: 'app-1',
      name: 'Test App',
      mode: AppModeEnum.CHAT,
      icon: '🤖',
      icon_type: 'emoji',
      icon_background: '#FFEAD5',
    })
  })

  describe('Initial state', () => {
    it('should return initial state correctly', () => {
      const { result } = renderActions()
      expect(result.current.appDetail).toEqual(mockAppDetail)
      expect(result.current.activeModal).toBeNull()
      expect(result.current.secretEnvList).toEqual([])
    })
  })

  describe('Modal management', () => {
    it('should open modal', () => {
      const { result } = renderActions()

      act(() => {
        result.current.openModal('edit')
      })

      expect(result.current.activeModal).toBe('edit')
    })

    it('should close modal', () => {
      const { result } = renderActions()

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
      const updatedApp = createAppDetailFixture({
        ...mockAppDetail,
        name: 'Updated',
        max_active_requests: null,
      })
      mockUpdateAppInfo.mockResolvedValue(updatedApp)

      const { result, queryClient } = renderActions()

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

      expect(mockUpdateAppInfo).toHaveBeenCalledWith(expect.stringContaining('/apps/app-1'), {
        name: 'Updated',
        icon_type: 'emoji',
        icon: '🤖',
        icon_background: '#fff',
        description: '',
        use_icon_as_answer_icon: false,
      })
      expect(queryClient.getQueryData(appDetailQueryKey)).toEqual(updatedApp)
      for (const queryKey of appListQueryKeys)
        expect(queryClient.getQueryState(queryKey)?.isInvalidated).toBe(true)
      expect(toastMocks.call).toHaveBeenCalledWith({ type: 'success', message: 'app.editDone' })
    })

    it('should emit app_meta_update after successful edit when collaboration socket exists', async () => {
      const updatedApp = createAppDetailFixture({ ...mockAppDetail, name: 'Updated' })
      const socket = { emit: vi.fn() }
      mockUpdateAppInfo.mockResolvedValue(updatedApp)
      mockGetSocket.mockReturnValue(socket)

      const { result } = renderActions()

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
      await waitFor(() => expect(socket.emit).toHaveBeenCalled())

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

      const { result } = renderActions()

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

      const { result } = renderActions()

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
    it.each(['completed', 'pending'] as const)(
      'should redirect only when the copy is completed (%s)',
      async (status) => {
        const newApp = createAppDetailFixture({ id: 'app-2', name: 'Copy' })
        mockCopyApp.mockResolvedValue(
          status === 'completed'
            ? newApp
            : {
                id: 'import-1',
                status: 'pending',
                current_dsl_version: '1.0.0',
              },
        )

        const { result } = renderActions()

        await act(async () => {
          await result.current.onCopy({
            name: 'Copy',
            icon_type: 'emoji',
            icon: '🤖',
            icon_background: '#fff',
          })
        })

        expect(mockCopyApp).toHaveBeenCalledWith(expect.stringContaining('/apps/app-1/copy'), {
          name: 'Copy',
          icon_type: 'emoji',
          icon: '🤖',
          icon_background: '#fff',
        })
        if (status === 'completed') {
          expect(toastMocks.call).toHaveBeenCalledWith({
            type: 'success',
            message: 'app.newApp.appCreated',
          })
          expect(getRedirection).toHaveBeenCalledWith(newApp, mockReplace, { isRbacEnabled: true })
        } else {
          expect(toastMocks.call).toHaveBeenCalledWith({
            type: 'error',
            message: 'app.newApp.appCreateFailed',
          })
          expect(getRedirection).not.toHaveBeenCalled()
        }
      },
    )

    it('should notify error on copy failure', async () => {
      mockCopyApp.mockRejectedValue(new Error('fail'))

      const { result } = renderActions()

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

      const { result } = renderActions()

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
      const { result } = renderActions()

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

  it('preserves the export failure result for the confirmation dialog', async () => {
    mockExportAppDsl.mockResolvedValue({ status: 'failed' })
    const { result } = renderActions()
    await act(async () => {
      await expect(result.current.onExport(true)).resolves.toBe(false)
    })
  })

  describe('onExport - early return', () => {
    it('should not export when appDetail is undefined', async () => {
      mockAppDetail = undefined

      const { result } = renderActions()

      await act(async () => {
        await result.current.onExport()
      })

      expect(mockExportAppDsl).not.toHaveBeenCalled()
    })
  })

  describe('exportCheck', () => {
    it('should call onExport directly for non-workflow modes', async () => {
      const { result } = renderActions()

      await act(async () => {
        await result.current.exportCheck()
      })

      expect(mockExportAppDsl).toHaveBeenCalled()
    })

    it('should open export warning modal for workflow mode', async () => {
      mockAppDetail = createAppDetailFixture({ ...mockAppDetail, mode: AppModeEnum.WORKFLOW })

      const { result } = renderActions()

      await act(async () => {
        await result.current.exportCheck()
      })

      expect(result.current.activeModal).toBe('exportWarning')
    })

    it('should open export warning modal for advanced_chat mode', async () => {
      mockAppDetail = createAppDetailFixture({ ...mockAppDetail, mode: AppModeEnum.ADVANCED_CHAT })

      const { result } = renderActions()

      await act(async () => {
        await result.current.exportCheck()
      })

      expect(result.current.activeModal).toBe('exportWarning')
    })
  })

  describe('exportCheck - early return', () => {
    it('should not do anything when appDetail is undefined', async () => {
      mockAppDetail = undefined

      const { result } = renderActions()

      await act(async () => {
        await result.current.exportCheck()
      })

      expect(mockExportAppDsl).not.toHaveBeenCalled()
    })
  })

  describe('handleConfirmExport', () => {
    it('keeps the warning open after failure so the user can retry', async () => {
      mockAppDetail = createAppDetailFixture({ ...mockAppDetail, mode: AppModeEnum.WORKFLOW })
      mockExportWorkflowAppDsl
        .mockResolvedValueOnce({ status: 'failed' })
        .mockResolvedValueOnce({ status: 'downloaded' })
      const { result } = renderActions()
      await act(async () => {
        await result.current.exportCheck()
      })
      await act(async () => {
        await result.current.handleConfirmExport()
      })
      expect(result.current.activeModal).toBe('exportWarning')
      await act(async () => {
        await result.current.handleConfirmExport()
      })
      expect(result.current.activeModal).toBeNull()
    })

    it('should export directly when no secret env variables', async () => {
      mockAppDetail = createAppDetailFixture({ ...mockAppDetail, mode: AppModeEnum.WORKFLOW })
      const { result } = renderActions()

      await act(async () => {
        await result.current.handleConfirmExport()
      })

      expect(mockExportWorkflowAppDsl).toHaveBeenCalledWith({
        appId: 'app-1',
        appName: 'Test App',
      })
    })

    it('should set secret env list when secret variables exist', async () => {
      mockAppDetail = createAppDetailFixture({ ...mockAppDetail, mode: AppModeEnum.WORKFLOW })
      const secretVars = [{ value_type: 'secret', name: 'API_KEY', value: 'secret' }]
      mockExportWorkflowAppDsl.mockResolvedValue({
        status: 'confirmation-required',
        secretEnvList: secretVars,
      })

      const { result } = renderActions()

      await act(async () => {
        await result.current.handleConfirmExport()
      })

      expect(result.current.secretEnvList).toEqual(secretVars)
    })
  })

  describe('handleConfirmExport - early return', () => {
    it('should not do anything when appDetail is undefined', async () => {
      mockAppDetail = undefined

      const { result } = renderActions()

      await act(async () => {
        await result.current.handleConfirmExport()
      })

      expect(mockExportWorkflowAppDsl).not.toHaveBeenCalled()
    })
  })

  describe('onConfirmDelete', () => {
    it('should delete app and redirect on success', async () => {
      mockDeleteApp.mockResolvedValue({})

      const { result } = renderActions()

      await act(async () => {
        await result.current.onConfirmDelete()
      })

      expect(mockDeleteApp).toHaveBeenCalledWith(expect.stringContaining('/apps/app-1'))
      expect(mockMarkAppDeletionStarted).toHaveBeenCalledWith('app-1')
      expect(mockMarkAppDeletionSucceeded).toHaveBeenCalledWith('app-1')
      expect(mockMarkAppDeletionFailed).not.toHaveBeenCalled()
      expect(toastMocks.call).toHaveBeenCalledWith({ type: 'success', message: 'app.appDeleted' })
      expect(mockReplace).toHaveBeenCalledWith('/apps')
    })

    it('should not delete when appDetail is undefined', async () => {
      mockAppDetail = undefined

      const { result } = renderActions()

      await act(async () => {
        await result.current.onConfirmDelete()
      })

      expect(mockDeleteApp).not.toHaveBeenCalled()
    })

    it('should notify error on delete failure', async () => {
      mockDeleteApp.mockRejectedValue({ message: 'cannot delete' })

      const { result } = renderActions()

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

    it('does not navigate away from another app when an old sidebar deletion finishes', async () => {
      const deletion = createDeferred<void>()
      mockDeleteApp.mockReturnValue(deletion.promise)
      const view = renderActions()
      let submitted: Promise<void> | undefined
      act(() => {
        submitted = view.result.current.onConfirmDelete()
      })
      await waitFor(() => expect(mockDeleteApp).toHaveBeenCalledOnce())
      view.unmount()

      await act(async () => {
        deletion.resolve()
        await submitted
      })

      expect(mockMarkAppDeletionSucceeded).toHaveBeenCalledWith('app-1')
      expect(mockReplace).not.toHaveBeenCalled()
    })
  })

  it('does not navigate away from another app when an old sidebar copy finishes', async () => {
    const copy = createDeferred<AppDetailWithSite>()
    mockCopyApp.mockReturnValue(copy.promise)
    const view = renderActions()
    let submitted: void | Promise<void>
    act(() => {
      submitted = view.result.current.onCopy({
        name: 'Copy',
        icon_type: 'emoji',
        icon: '🤖',
        icon_background: '#fff',
      })
    })
    await waitFor(() => expect(mockCopyApp).toHaveBeenCalledOnce())
    view.unmount()

    await act(async () => {
      copy.resolve(createAppDetailFixture({ id: 'copied-app', name: 'Copy' }))
      await submitted
    })

    expect(getRedirection).not.toHaveBeenCalled()
  })
})
