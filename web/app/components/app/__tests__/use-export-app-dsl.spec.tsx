import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
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
      options: { success: (format: unknown) => { title: string }; error: { title: string } },
    ) => {
      const format = await promise
      mocks.toastSuccess(options.success(format).title)
      return format
    },
  ),
}))

vi.mock('@/service/console', () => ({
  consoleClient: {
    apps: {
      byAppId: {
        export: {
          get: mocks.exportAppDsl,
        },
        workflows: {
          draft: {
            environmentVariables: {
              get: mocks.getEnvironmentVariables,
            },
          },
        },
      },
    },
  },
}))

vi.mock('@/utils/download', () => ({
  downloadBlob: mocks.downloadBlob,
}))

vi.mock('@/app/notifications', () => ({
  toast: {
    error: mocks.toastError,
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
    mocks.getEnvironmentVariables.mockResolvedValue({ items: [] })
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
      { context: { silent: true } },
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
      { context: { silent: true } },
    )
    expect(mocks.downloadBlob).toHaveBeenCalledWith({
      data: archive,
      fileName: 'Support Agent.ifpkg',
    })
    expect(mocks.getEnvironmentVariables).not.toHaveBeenCalled()
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
      { context: { silent: true } },
    )
    expect(mocks.downloadBlob).toHaveBeenCalledTimes(1)
    expect(mocks.downloadBlob).toHaveBeenCalledWith({
      data: archive,
      fileName: 'published-agent.ifpkg',
    })
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
      { context: { silent: true } },
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

  it.each([undefined, 'ifpkg'] as const)(
    'lets the promise toast own %s export errors without triggering a download',
    async (format) => {
      mocks.exportAppDsl.mockRejectedValue(new Error('Export failed'))
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
          error: { title: format === 'ifpkg' ? 'app.exportAppFailed' : 'app.exportFailed' },
        }),
      )
      expect(mocks.downloadBlob).not.toHaveBeenCalled()
    },
  )
})

describe('useExportWorkflowAppDsl', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
      { context: { silent: true } },
    )
    expect(mocks.getEnvironmentVariables.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.exportAppDsl.mock.invocationCallOrder[0]!,
    )
    expect(mocks.downloadBlob).toHaveBeenCalledWith({
      data: expect.any(Blob),
      fileName: 'Support Workflow.yml',
    })
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

    expect(mocks.toastError).toHaveBeenCalledWith('app.exportFailed')
    expect(mocks.exportAppDsl).not.toHaveBeenCalled()
  })

  it('keeps one pending lifecycle across the draft check and export', async () => {
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

    await act(async () => {
      resolveEnvironmentVariables?.({ items: [] })
      await waitFor(() => expect(mocks.exportAppDsl).toHaveBeenCalledTimes(1))
    })
    expect(result.current.isExporting).toBe(true)

    await act(async () => {
      resolveExport?.({ data: 'kind: app\n' })
      await exportPromise
    })
    await waitFor(() => expect(result.current.isExporting).toBe(false))
  })
})
