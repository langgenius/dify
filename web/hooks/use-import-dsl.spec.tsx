import { act, renderHook, waitFor } from '@testing-library/react'
import { useImportDSL } from './use-import-dsl'

const mockNotify = vi.fn()
const mockPush = vi.fn()
const mockHandleCheckPluginDependencies = vi.fn()
const mockImportDSL = vi.fn()
const mockImportDSLConfirm = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}))

vi.mock('@/app/components/base/toast', () => ({
  useToastContext: () => ({
    notify: mockNotify,
  }),
}))

vi.mock('@/app/components/workflow/plugin-dependency/hooks', () => ({
  usePluginDependencies: () => ({
    handleCheckPluginDependencies: mockHandleCheckPluginDependencies,
  }),
}))

vi.mock('@/context/app-context', () => ({
  useSelector: (selector: (state: { isCurrentWorkspaceEditor: boolean }) => boolean) =>
    selector({ isCurrentWorkspaceEditor: true }),
}))

vi.mock('@/service/apps', () => ({
  importDSL: (...args: unknown[]) => mockImportDSL(...args),
  importDSLConfirm: (...args: unknown[]) => mockImportDSLConfirm(...args),
  getImportDSLFailureMessage: vi.fn(async (error: unknown) => {
    if (error instanceof Response) {
      const body = await error.json() as { error?: string, message?: string }
      return body.error || body.message || null
    }

    return null
  }),
}))

describe('useImportDSL', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Covers the success path for YAML file imports.
  it('should forward YAML content to the import API', async () => {
    mockImportDSL.mockResolvedValue({
      id: 'import-1',
      status: 'completed',
      app_id: 'app-1',
      app_mode: 'workflow',
      imported_dsl_version: '0.3.1',
      current_dsl_version: '0.3.1',
      error: '',
      leaked_dependencies: [],
    })
    mockHandleCheckPluginDependencies.mockResolvedValue(undefined)

    const { result } = renderHook(() => useImportDSL())

    await act(async () => {
      await result.current.handleImportDSL(
        {
          mode: 'yaml-content',
          yaml_content: 'kind: claude-workflow',
        },
        {},
      )
    })

    expect(mockImportDSL).toHaveBeenCalledWith(
      {
        mode: 'yaml-content',
        yaml_content: 'kind: claude-workflow',
      },
      { silent: true },
    )
  })

  // Covers schema/compile failures that should surface specific backend messages.
  it('should show the backend import error when the API returns a Claude workflow validation failure', async () => {
    mockImportDSL.mockRejectedValue(
      new Response(JSON.stringify({
        error: 'edges.1.target: unknown target',
        message: 'edges.1.target: unknown target',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const onFailed = vi.fn()
    const { result } = renderHook(() => useImportDSL())

    await act(async () => {
      await result.current.handleImportDSL(
        {
          mode: 'yaml-content',
          yaml_content: 'kind: claude-workflow',
        },
        { onFailed },
      )
    })

    await waitFor(() => {
      expect(mockNotify).toHaveBeenCalledWith({
        type: 'error',
        message: 'edges.1.target: unknown target',
      })
    })
    expect(onFailed).toHaveBeenCalled()
  })
})
