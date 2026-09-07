import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useExportAppDsl, useExportWorkflowAppDsl } from '../use-export-app-dsl'

const mocks = vi.hoisted(() => ({
  downloadBlob: vi.fn(),
  exportAppDsl: vi.fn(),
  getEnvironmentVariables: vi.fn(),
  toastError: vi.fn(),
  toastPromise: vi.fn((promise: Promise<unknown>) => promise),
}))

vi.mock('@/service/client', () => ({
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

vi.mock('@langgenius/dify-ui/toast', () => ({
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

  it('lets the promise toast own errors without triggering a download', async () => {
    mocks.exportAppDsl.mockRejectedValue(new Error('Export failed'))
    const { result } = renderHook(() => useExportAppDsl(), { wrapper: createWrapper() })

    await act(async () => {
      await expect(
        result.current.exportAppDsl({
          appId: '4f6ae8f8-86c8-4ec8-82ef-e27f5932692b',
          appName: 'Support Agent',
        }),
      ).resolves.toEqual({ status: 'failed' })
    })

    expect(mocks.downloadBlob).not.toHaveBeenCalled()
  })
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
