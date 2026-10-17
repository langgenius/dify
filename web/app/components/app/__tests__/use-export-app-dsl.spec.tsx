import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { ExportAppDialog } from '@/app/components/app-sidebar/app-info/export-app-dialog'
import { createHttpError, httpErrorFromResponse } from '@/service/http-error'
import { createAppDetailFixture } from '@/test/fixtures/app'
import AppExportConfirmModal from '../export-confirm-modal'
import { useExportAppDsl, useExportWorkflowAppDsl } from '../use-export-app-dsl'

const mocks = vi.hoisted(() => ({
  downloadBlob: vi.fn(),
  exportAppDsl: vi.fn(),
  getEnvironmentVariables: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  toastPromise: vi.fn(
    async (
      promise: Promise<unknown>,
      options: {
        success: (format: unknown) => { title: string }
        error: (error: unknown) => { title: string; description?: string }
      },
    ) => {
      try {
        const format = await promise
        mocks.toastSuccess(options.success(format).title)
        return format
      } catch (error) {
        const { title, description } = options.error(error)
        mocks.toastError(title, { description })
        throw error
      }
    },
  ),
}))

vi.mock('@/service/console', async () => {
  const { createTanstackQueryUtils } = await import('@orpc/tanstack-query')
  return {
    consoleQuery: createTanstackQueryUtils(
      {
        apps: {
          byAppId: {
            export: { get: mocks.exportAppDsl },
            workflows: {
              draft: { environmentVariables: { get: mocks.getEnvironmentVariables } },
            },
          },
        },
      },
      { path: ['console'] },
    ),
  }
})

vi.mock('@/utils/download', () => ({
  downloadBlob: mocks.downloadBlob,
}))

vi.mock('@/app/notifications', () => ({
  toast: {
    error: mocks.toastError,
    success: mocks.toastSuccess,
    promise: mocks.toastPromise,
  },
}))

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
    },
  })

  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

describe('useExportAppDsl', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.exportAppDsl.mockReset()
    mocks.getEnvironmentVariables.mockResolvedValue({ items: [] })
  })

  it('keeps the secret confirmation open after a failed request and retries the same choice', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    let rejectExport!: (reason: unknown) => void
    mocks.exportAppDsl
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectExport = reject
          }),
      )
      .mockResolvedValueOnce(new File(['package'], 'app.ifpkg'))

    function ExportConfirmation() {
      const { exportAppDsl, isExporting, errorMessage } = useExportAppDsl()
      return (
        <AppExportConfirmModal
          envList={[{ name: 'TOKEN', value: 'masked' }]}
          isExporting={isExporting}
          errorMessage={errorMessage}
          onClose={onClose}
          onConfirm={async (includeSecret) => {
            const result = await exportAppDsl({
              appId: 'app-1',
              appName: 'App',
              includeSecret,
              feedback: 'dialog',
            })
            return result.status === 'downloaded'
          }}
        />
      )
    }
    render(<ExportConfirmation />, { wrapper: createWrapper() })
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'app.exportSecret.title' }))
    const pendingButton = await screen.findByRole('button', { name: 'common.operation.exporting' })
    expect(screen.getByRole('checkbox')).toHaveAttribute('aria-disabled', 'true')
    await user.click(pendingButton)
    expect(mocks.exportAppDsl).toHaveBeenCalledTimes(1)

    await act(async () => {
      rejectExport(
        createHttpError(new Response(null, { status: 400 }), { message: 'Skill unavailable' }),
      )
    })
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('checkbox')).toBeChecked()
    expect(await screen.findByRole('alert')).toHaveTextContent('Skill unavailable')
    expect(mocks.toastError).not.toHaveBeenCalled()
    expect(mocks.toastPromise).not.toHaveBeenCalled()
    await user.click(await screen.findByRole('button', { name: 'app.exportSecret.title' }))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(mocks.exportAppDsl).toHaveBeenLastCalledWith(
      expect.objectContaining({ query: expect.objectContaining({ include_secret: true }) }),
      expect.objectContaining({ context: expect.objectContaining({ silent: true }) }),
    )
    expect(mocks.downloadBlob).toHaveBeenCalledTimes(1)
    expect(mocks.toastSuccess).not.toHaveBeenCalled()
  })

  it.each([
    ['download.ifpkg', 'download.ifpkg'],
    ['blob', 'Support Agent.ifpkg'],
  ])('downloads binary exports using %s without rebuilding their bytes', async (name, fileName) => {
    const archive = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff])], name, {
      type: 'application/zip',
    })
    mocks.exportAppDsl.mockResolvedValue(archive)
    const { result } = renderHook(() => useExportAppDsl(), { wrapper: createWrapper() })

    await act(async () => {
      await expect(
        result.current.exportAppDsl({
          format: 'ifpkg',
          appId: 'agent-app-id',
          appName: 'Support Agent',
        }),
      ).resolves.toEqual({ status: 'downloaded' })
    })

    expect(mocks.toastSuccess).toHaveBeenCalledWith('app.exportAppSuccess')
    expect(mocks.exportAppDsl).toHaveBeenCalledWith(
      { params: { app_id: 'agent-app-id' }, query: { include_secret: false, format: 'ifpkg' } },
      expect.objectContaining({ context: expect.objectContaining({ silent: true }) }),
    )
    expect(mocks.downloadBlob).toHaveBeenCalledWith({ data: archive, fileName })
    const [{ data }] = mocks.downloadBlob.mock.calls[0] as [{ data: Blob }]
    expect(new Uint8Array(await data.arrayBuffer())).toEqual(
      new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff]),
    )
    expect(mocks.getEnvironmentVariables).not.toHaveBeenCalled()
  })

  it('downloads the selected published Agent version as an ifpkg package', async () => {
    const archive = new Blob(['published agent package'], { type: 'application/zip' })
    mocks.exportAppDsl.mockResolvedValue(archive)
    const { result } = renderHook(() => useExportAppDsl(), { wrapper: createWrapper() })

    await act(async () => {
      await expect(
        result.current.exportAppDsl({
          appId: 'agent-app-id',
          appName: 'Support Agent',
          versionId: '11111111-1111-4111-8111-111111111111',
          format: 'ifpkg',
        }),
      ).resolves.toEqual({ status: 'downloaded' })
    })

    expect(mocks.exportAppDsl).toHaveBeenCalledWith(
      {
        params: { app_id: 'agent-app-id' },
        query: {
          include_secret: false,
          version_id: '11111111-1111-4111-8111-111111111111',
          format: 'ifpkg',
        },
      },
      expect.objectContaining({ context: expect.objectContaining({ silent: true }) }),
    )
    expect(mocks.downloadBlob).toHaveBeenCalledWith({
      data: archive,
      fileName: 'Support Agent.ifpkg',
    })
    expect(mocks.getEnvironmentVariables).not.toHaveBeenCalled()
  })

  it('fetches a fresh file on each export and releases the file query afterward', async () => {
    const first = new File(['first'], 'first.ifpkg')
    const second = new File(['second'], 'second.ifpkg')
    mocks.exportAppDsl.mockResolvedValueOnce(first).mockResolvedValueOnce(second)
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } })
    const { result } = renderHook(() => useExportAppDsl(), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      ),
    })
    const input = { appId: 'app-1', appName: 'App' }
    await act(async () => {
      await result.current.exportAppDsl(input)
    })
    await act(async () => {
      await result.current.exportAppDsl(input)
    })
    expect(mocks.exportAppDsl).toHaveBeenCalledTimes(2)
    expect(mocks.downloadBlob).toHaveBeenLastCalledWith({ data: second, fileName: 'second.ifpkg' })
    await waitFor(() => expect(queryClient.getQueryCache().getAll()).toHaveLength(0))
  })

  it('allows retrying a failed version export and downloads only the successful response', async () => {
    const archive = new File(['published agent package'], 'published-agent.ifpkg', {
      type: 'application/zip',
    })
    mocks.exportAppDsl.mockRejectedValueOnce(new Error('Export failed')).mockResolvedValue(archive)
    const { result } = renderHook(() => useExportAppDsl(), { wrapper: createWrapper() })
    const input = {
      appId: 'agent-app-id',
      appName: 'Support Agent',
      versionId: '11111111-1111-4111-8111-111111111111',
    }

    await act(async () => {
      await expect(result.current.exportAppDsl(input)).resolves.toEqual({ status: 'failed' })
    })
    await waitFor(() => expect(result.current.isExporting).toBe(false))
    expect(mocks.downloadBlob).not.toHaveBeenCalled()

    await act(async () => {
      await expect(result.current.exportAppDsl(input)).resolves.toEqual({ status: 'downloaded' })
    })
    await waitFor(() => expect(result.current.isExporting).toBe(false))

    expect(mocks.exportAppDsl).toHaveBeenCalledTimes(2)
    expect(mocks.exportAppDsl).toHaveBeenLastCalledWith(
      {
        params: { app_id: input.appId },
        query: { include_secret: false, version_id: input.versionId },
      },
      expect.objectContaining({ context: expect.objectContaining({ silent: true }) }),
    )
    expect(mocks.downloadBlob).toHaveBeenCalledTimes(1)
    expect(mocks.downloadBlob).toHaveBeenCalledWith({
      data: archive,
      fileName: 'published-agent.ifpkg',
    })
  })

  it('keeps the localized failure title and exposes the HTTP status when the response has no readable message', async () => {
    mocks.exportAppDsl.mockRejectedValue(
      await httpErrorFromResponse(new Response('Bad gateway', { status: 502 })),
    )
    const { result } = renderHook(() => useExportAppDsl(), { wrapper: createWrapper() })
    await act(async () => {
      await result.current.exportAppDsl({ appId: 'app-id', appName: 'App' })
    })
    expect(mocks.toastError).toHaveBeenCalledExactlyOnceWith('app.exportAppFailed', {
      description: 'HTTP 502',
    })
    expect(mocks.downloadBlob).not.toHaveBeenCalled()
  })

  it('exports through the generated client and hands the YAML file to the browser', async () => {
    mocks.exportAppDsl.mockResolvedValue({ data: 'kind: app\nversion: 0.1.5\n' })
    const { result } = renderHook(() => useExportAppDsl(), { wrapper: createWrapper() })

    await act(async () => {
      await result.current.exportAppDsl({
        appId: '4f6ae8f8-86c8-4ec8-82ef-e27f5932692b',
        appName: 'Support Agent',
      })
    })

    expect(mocks.exportAppDsl).toHaveBeenCalledWith(
      {
        params: { app_id: '4f6ae8f8-86c8-4ec8-82ef-e27f5932692b' },
        query: { include_secret: false },
      },
      expect.objectContaining({ context: expect.objectContaining({ silent: true }) }),
    )
    expect(mocks.toastPromise).toHaveBeenCalledTimes(1)
    expect(mocks.getEnvironmentVariables).not.toHaveBeenCalled()
    expect(mocks.downloadBlob).toHaveBeenCalledWith({
      data: expect.any(Blob),
      fileName: 'Support Agent.yml',
    })
    const [{ data }] = mocks.downloadBlob.mock.calls[0] as [{ data: Blob }]
    expect(await data.text()).toBe('kind: app\nversion: 0.1.5\n')
    expect(mocks.toastSuccess).toHaveBeenCalledWith('common.operation.downloadSuccess')
  })

  it('exposes pending state until the export command settles', async () => {
    let resolveExport: ((value: { data: string }) => void) | undefined
    mocks.exportAppDsl.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveExport = resolve
        }),
    )
    const { result } = renderHook(() => useExportAppDsl(), { wrapper: createWrapper() })

    let exportPromise: Promise<unknown> | undefined
    await act(async () => {
      exportPromise = result.current.exportAppDsl({
        appId: '4f6ae8f8-86c8-4ec8-82ef-e27f5932692b',
        appName: 'Support Agent',
        includeSecret: true,
      })
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(result.current.isExporting).toBe(true)
    })

    await act(async () => {
      resolveExport?.({ data: 'kind: app\n' })
      await exportPromise
    })

    await waitFor(() => {
      expect(result.current.isExporting).toBe(false)
    })
    expect(mocks.exportAppDsl).toHaveBeenCalledWith(
      expect.objectContaining({ query: { include_secret: true } }),
      expect.anything(),
    )
  })

  it.each([undefined, 'ifpkg', 'yaml'] as const)(
    'lets the promise toast own %s export errors without triggering a download',
    async (format) => {
      mocks.exportAppDsl.mockRejectedValue(
        await httpErrorFromResponse(
          Response.json(
            { message: "Package contains unusable Skill 'news-source-verification'" },
            { status: 500 },
          ),
        ),
      )
      const { result } = renderHook(() => useExportAppDsl(), { wrapper: createWrapper() })

      await act(async () => {
        await expect(
          result.current.exportAppDsl({
            format,
            appId: '4f6ae8f8-86c8-4ec8-82ef-e27f5932692b',
            appName: 'Support Agent',
          }),
        ).resolves.toEqual({ status: 'failed' })
      })

      expect(mocks.toastPromise).toHaveBeenCalledWith(
        expect.any(Promise),
        expect.objectContaining({
          error: expect.any(Function),
        }),
      )
      expect(mocks.toastError).toHaveBeenCalledExactlyOnceWith(
        format === 'yaml' ? 'app.exportFailed' : 'app.exportAppFailed',
        { description: "Package contains unusable Skill 'news-source-verification'" },
      )
      expect(mocks.downloadBlob).not.toHaveBeenCalled()
    },
  )
})

describe('useExportWorkflowAppDsl', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('keeps dialog feedback inline through checking, failure, reopening and retry', async () => {
    const user = userEvent.setup()
    const app = createAppDetailFixture({ name: 'Workflow', mode: 'workflow' })
    mocks.getEnvironmentVariables
      .mockRejectedValueOnce(new Error('Draft unavailable'))
      .mockResolvedValue({ items: [] })
    mocks.exportAppDsl
      .mockRejectedValueOnce(new Error('Export unavailable'))
      .mockResolvedValueOnce(new File(['package'], 'workflow.ifpkg'))

    function ExportEntry() {
      const [open, setOpen] = useState(true)
      return (
        <>
          <button onClick={() => setOpen(true)}>Reopen</button>
          <ExportAppDialog appDetail={app} open={open} onOpenChange={setOpen} />
        </>
      )
    }

    render(<ExportEntry />, { wrapper: createWrapper() })
    await user.click(screen.getByRole('button', { name: 'common.operation.confirm' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Draft unavailable')
    expect(mocks.exportAppDsl).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Reopen' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'common.operation.confirm' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Export unavailable')
    expect(mocks.toastPromise).not.toHaveBeenCalled()
    expect(mocks.toastError).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'common.operation.confirm' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(mocks.toastSuccess).not.toHaveBeenCalled()
    expect(mocks.downloadBlob).toHaveBeenCalledTimes(1)
  })

  it('checks generated workflow environment variables before exporting', async () => {
    mocks.getEnvironmentVariables.mockResolvedValue({ items: [] })
    mocks.exportAppDsl.mockResolvedValue({ data: 'kind: app\n' })
    const { result } = renderHook(() => useExportWorkflowAppDsl(), {
      wrapper: createWrapper(),
    })

    await act(async () => {
      await result.current.exportWorkflowAppDsl({
        appId: 'workflow-app-id',
        appName: 'Support Workflow',
      })
    })

    expect(mocks.getEnvironmentVariables).toHaveBeenCalledWith(
      { params: { app_id: 'workflow-app-id' } },
      expect.objectContaining({ context: expect.objectContaining({ silent: true }) }),
    )
    expect(mocks.getEnvironmentVariables.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.exportAppDsl.mock.invocationCallOrder[0]!,
    )
    expect(mocks.downloadBlob).toHaveBeenCalledWith({
      data: expect.any(Blob),
      fileName: 'Support Workflow.yml',
    })
  })

  it('checks secrets again on a later export instead of reusing the previous environment list', async () => {
    mocks.getEnvironmentVariables
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce({ items: [{ name: 'TOKEN', value_type: 'secret', value: 'secret' }] })
    mocks.exportAppDsl.mockResolvedValue(new File(['package'], 'app.ifpkg'))
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } })
    const { result } = renderHook(() => useExportWorkflowAppDsl(), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      ),
    })
    const input = { appId: 'app-1', appName: 'App' }
    await act(async () => {
      await result.current.exportWorkflowAppDsl(input)
    })
    await act(async () => {
      await expect(result.current.exportWorkflowAppDsl(input)).resolves.toMatchObject({
        status: 'confirmation-required',
      })
    })
    expect(mocks.getEnvironmentVariables).toHaveBeenCalledTimes(2)
    expect(mocks.exportAppDsl).toHaveBeenCalledTimes(1)
  })

  it('returns generated secret variables without starting a download', async () => {
    const secretEnvList = [
      {
        id: 'secret-id',
        name: 'API_KEY',
        value: 'secret',
        value_type: 'secret',
      },
    ]
    mocks.getEnvironmentVariables.mockResolvedValue({ items: secretEnvList })
    const { result } = renderHook(() => useExportWorkflowAppDsl(), {
      wrapper: createWrapper(),
    })

    await act(async () => {
      await expect(
        result.current.exportWorkflowAppDsl({
          appId: 'workflow-app-id',
          appName: 'Support Workflow',
        }),
      ).resolves.toEqual({ status: 'confirmation-required', secretEnvList })
    })

    expect(mocks.exportAppDsl).not.toHaveBeenCalled()
    expect(mocks.toastPromise).not.toHaveBeenCalled()
    expect(mocks.toastSuccess).not.toHaveBeenCalled()
    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  it('owns workflow preflight errors without starting a download', async () => {
    mocks.getEnvironmentVariables.mockRejectedValue(new Error('Draft unavailable'))
    const { result } = renderHook(() => useExportWorkflowAppDsl(), {
      wrapper: createWrapper(),
    })

    await act(async () => {
      await expect(
        result.current.exportWorkflowAppDsl({
          appId: 'workflow-app-id',
          appName: 'Support Workflow',
        }),
      ).resolves.toEqual({ status: 'failed' })
    })

    expect(mocks.toastError).toHaveBeenCalledExactlyOnceWith('app.exportAppFailed', {
      description: 'Draft unavailable',
    })
    expect(mocks.toastPromise).not.toHaveBeenCalled()
    expect(mocks.exportAppDsl).not.toHaveBeenCalled()
  })

  it('reports an export failure once after a successful secret check', async () => {
    mocks.getEnvironmentVariables.mockResolvedValue({ items: [] })
    mocks.exportAppDsl.mockRejectedValue(new Error('Export unavailable'))
    const { result } = renderHook(() => useExportWorkflowAppDsl(), {
      wrapper: createWrapper(),
    })

    await act(async () => {
      await expect(
        result.current.exportWorkflowAppDsl({
          appId: 'workflow-app-id',
          appName: 'Support Workflow',
        }),
      ).resolves.toEqual({ status: 'failed' })
    })

    expect(mocks.toastPromise).toHaveBeenCalledTimes(1)
    expect(mocks.toastError).toHaveBeenCalledExactlyOnceWith('app.exportAppFailed', {
      description: 'Export unavailable',
    })
    expect(mocks.toastSuccess).not.toHaveBeenCalled()
    expect(mocks.downloadBlob).not.toHaveBeenCalled()
  })

  it('stays pending across both stages but only shows a toast for the export', async () => {
    let resolveEnvironmentVariables: ((value: { items: [] }) => void) | undefined
    let resolveExport: ((value: { data: string }) => void) | undefined
    mocks.getEnvironmentVariables.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveEnvironmentVariables = resolve
        }),
    )
    mocks.exportAppDsl.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveExport = resolve
        }),
    )
    const { result } = renderHook(() => useExportWorkflowAppDsl(), {
      wrapper: createWrapper(),
    })

    let exportPromise: Promise<unknown> | undefined
    await act(async () => {
      exportPromise = result.current.exportWorkflowAppDsl({
        appId: 'workflow-app-id',
        appName: 'Support Workflow',
      })
      await Promise.resolve()
    })

    await waitFor(() => expect(result.current.isExporting).toBe(true))
    expect(mocks.exportAppDsl).not.toHaveBeenCalled()
    expect(mocks.toastPromise).not.toHaveBeenCalled()
    expect(mocks.toastSuccess).not.toHaveBeenCalled()
    expect(mocks.toastError).not.toHaveBeenCalled()

    await act(async () => {
      resolveEnvironmentVariables?.({ items: [] })
      await waitFor(() => expect(mocks.exportAppDsl).toHaveBeenCalledTimes(1))
    })
    expect(result.current.isExporting).toBe(true)
    expect(mocks.toastPromise).toHaveBeenCalledWith(
      expect.any(Promise),
      expect.objectContaining({ loading: { title: 'common.operation.exporting' } }),
    )

    await act(async () => {
      resolveExport?.({ data: 'kind: app\n' })
      await exportPromise
    })
    await waitFor(() => expect(result.current.isExporting).toBe(false))
    expect(mocks.toastSuccess).toHaveBeenCalledExactlyOnceWith('common.operation.downloadSuccess')
    expect(mocks.toastPromise).toHaveBeenCalledTimes(1)
    expect(mocks.toastError).not.toHaveBeenCalled()
  })
})
