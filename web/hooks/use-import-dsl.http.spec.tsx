import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { useStore } from '@/app/components/workflow/plugin-dependency/store'
import { renderHookWithConsoleQuery } from '@/test/console/query-data'
import { useImportDSL } from './use-import-dsl'

const mocks = vi.hoisted(() => ({
  success: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  redirect: vi.fn(),
  push: vi.fn(),
}))
vi.mock('@/app/notifications', () => ({ toast: mocks }))
vi.mock('@/next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }))
vi.mock('@/utils/app-redirection', () => ({ getRedirection: mocks.redirect }))
vi.mock('@/utils/client', () => ({ isClient: true, isServer: false }))

const input = { mode: 'yaml-content' as const, yaml_content: 'app: demo' }
const completed = {
  id: 'import-1',
  status: 'completed',
  app_id: 'app-1',
  app_mode: 'workflow',
  permission_keys: [],
}

// Keep the import action, dependency hook, generated client, and HTTP decoder real.
// A failed follow-up must never turn an already-created app into an import failure.
describe('import action feedback across HTTP requests', () => {
  beforeEach(() => {
    useStore.getState().setDependencies([])
  })
  afterEach(() => vi.unstubAllGlobals())

  it.each([false, true])(
    'reports one warning after dependency failure (confirmation: %s)',
    async (confirm) => {
      const fetch = vi.fn(async (request: RequestInfo | URL) => {
        const url = request instanceof Request ? request.url : String(request)
        if (url.endsWith('/check-dependencies'))
          return Response.json(
            { code: 'unavailable', message: 'Dependency service unavailable' },
            { status: 503 },
          )
        if (url.endsWith('/confirm') || !confirm) return Response.json(completed)
        return Response.json({
          id: 'import-1',
          status: 'pending',
          imported_dsl_version: '2',
          current_dsl_version: '1',
        })
      })
      vi.stubGlobal('fetch', fetch)
      const { result } = renderHookWithConsoleQuery(() => useImportDSL())
      const onSuccess = vi.fn()
      const onFailed = vi.fn()
      await act(async () => {
        await result.current.handleImportDSL(input, { onSuccess, onFailed })
      })
      if (confirm) {
        expect(mocks.warning).not.toHaveBeenCalled()
        await act(async () => {
          await result.current.handleImportDSLConfirm({ onSuccess, onFailed })
        })
      }
      expect(mocks.warning).toHaveBeenCalledTimes(1)
      expect(mocks.success).not.toHaveBeenCalled()
      expect(mocks.error).not.toHaveBeenCalled()
      expect(onSuccess).toHaveBeenCalledTimes(1)
      expect(onFailed).not.toHaveBeenCalled()
      expect(mocks.redirect).toHaveBeenCalledTimes(1)
      expect(result.current.isFetching).toBe(false)
      render(<>{mocks.warning.mock.calls[0]![1].description}</>)
      expect(screen.getByText('Dependency service unavailable')).toBeInTheDocument()
    },
  )

  it('waits for follow-up requests and combines all warnings into one notification', async () => {
    let finishDependencies!: (response: Response) => void
    const dependencies = new Promise<Response>((resolve) => {
      finishDependencies = resolve
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: RequestInfo | URL) => {
        const url = request instanceof Request ? request.url : String(request)
        if (url.endsWith('/check-dependencies')) return dependencies
        return Response.json({
          ...completed,
          status: 'completed-with-warnings',
          warnings: [{ message: 'Tool authorization required' }],
        })
      }),
    )
    const { result } = renderHookWithConsoleQuery(() => useImportDSL())
    let completion!: Promise<void>
    act(() => {
      completion = result.current.handleImportDSL(input, {})
    })
    await waitFor(() => expect(result.current.isFetching).toBe(true))
    expect(mocks.warning).not.toHaveBeenCalled()
    expect(mocks.success).not.toHaveBeenCalled()
    await act(async () => {
      finishDependencies(
        Response.json({ message: 'Dependency service unavailable' }, { status: 503 }),
      )
      await completion
    })
    expect(mocks.warning).toHaveBeenCalledTimes(1)
    expect(mocks.error).not.toHaveBeenCalled()
    expect(mocks.success).not.toHaveBeenCalled()
    render(<>{mocks.warning.mock.calls[0]![1].description}</>)
    expect(screen.getByText('Tool authorization required')).toBeInTheDocument()
    expect(screen.getByText('Dependency service unavailable')).toBeInTheDocument()
  })

  it('reports each failed user attempt once and preserves the draft for retry', async () => {
    const fetch = vi.fn(async () =>
      Response.json(
        { code: 'unavailable', message: 'Import service unavailable' },
        { status: 503 },
      ),
    )
    vi.stubGlobal('fetch', fetch)
    const { result } = renderHookWithConsoleQuery(() => useImportDSL())
    for (const attempt of [1, 2]) {
      await act(async () => {
        await result.current.handleImportDSL(input, {})
      })
      expect(mocks.error).toHaveBeenCalledTimes(attempt)
      expect(fetch).toHaveBeenCalledTimes(attempt)
      expect(result.current.isFetching).toBe(false)
    }
    expect(mocks.warning).not.toHaveBeenCalled()
    expect(mocks.success).not.toHaveBeenCalled()
    expect(mocks.redirect).not.toHaveBeenCalled()
  })

  it.each(['import', 'dependencies'])('keeps cancellation quiet during %s', async (stage) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (request: RequestInfo | URL) => {
        const url = request instanceof Request ? request.url : String(request)
        if (stage === 'import' || url.endsWith('/check-dependencies'))
          throw new DOMException('Cancelled', 'AbortError')
        return Response.json(completed)
      }),
    )
    const { result } = renderHookWithConsoleQuery(() => useImportDSL())
    await act(async () => {
      await result.current.handleImportDSL(input, {})
    })
    expect(mocks.error).not.toHaveBeenCalled()
    expect(mocks.warning).not.toHaveBeenCalled()
    expect(mocks.success).not.toHaveBeenCalled()
    expect(result.current.isFetching).toBe(false)
  })
})
