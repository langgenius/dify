import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import CreateFromDSLModal, { CreateFromDSLModalTab } from './index'

const mockPush = vi.fn()
const mockNotify = vi.fn()
const mockImportDSL = vi.fn()
const mockImportDSLConfirm = vi.fn()
const mockHandleCheckPluginDependencies = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}))

vi.mock('ahooks', () => ({
  useDebounceFn: <T extends (...args: unknown[]) => unknown>(fn: T) => ({ run: fn }),
  useKeyPress: vi.fn(),
}))

vi.mock('use-context-selector', async () => {
  const actual = await vi.importActual<typeof import('use-context-selector')>('use-context-selector')
  return {
    ...actual,
    useContext: () => ({ notify: mockNotify }),
  }
})

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

vi.mock('@/app/components/workflow/plugin-dependency/hooks', () => ({
  usePluginDependencies: () => ({
    handleCheckPluginDependencies: mockHandleCheckPluginDependencies,
  }),
}))

vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    isCurrentWorkspaceEditor: true,
  }),
}))

vi.mock('@/context/provider-context', () => ({
  useProviderContext: () => ({
    enableBilling: false,
    plan: {
      usage: { buildApps: 0 },
      total: { buildApps: 10 },
    },
  }),
}))

vi.mock('@/app/components/base/amplitude', () => ({
  trackEvent: vi.fn(),
}))

describe('CreateFromDSLModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    class MockFileReader {
      onload: ((event: ProgressEvent<FileReader>) => void) | null = null

      readAsText(_file: Blob) {
        act(() => {
          this.onload?.({
            target: { result: 'kind: claude-workflow' },
          } as ProgressEvent<FileReader>)
        })
      }
    }

    vi.stubGlobal('FileReader', MockFileReader as unknown as typeof FileReader)
  })

  // Covers file-mode imports for Claude workflow uploads.
  it('should import the dropped Claude workflow file content through the app import API', async () => {
    mockImportDSL.mockResolvedValue({
      id: 'import-1',
      status: 'failed',
      error: 'compile failed',
    })

    render(
      <CreateFromDSLModal
        show={true}
        onClose={vi.fn()}
        activeTab={CreateFromDSLModalTab.FROM_FILE}
        droppedFile={new File(['kind: claude-workflow'], 'claude_workflow.yaml', { type: 'text/yaml' })}
      />,
    )

    const importButton = screen.getByText('app.newApp.Create').closest('button')

    await waitFor(() => {
      expect(importButton).not.toBeDisabled()
    })

    fireEvent.click(importButton!)

    await waitFor(() => {
      expect(mockImportDSL).toHaveBeenCalledWith(
        {
          mode: 'yaml-content',
          yaml_content: 'kind: claude-workflow',
        },
        { silent: true },
      )
    })
  })

  // Covers backend validation/compiler errors for Claude workflow uploads.
  it('should display the backend Claude workflow error instead of the generic import failure message', async () => {
    mockImportDSL.mockRejectedValue(
      new Response(JSON.stringify({
        error: 'Invalid selector payload',
        message: 'Invalid selector payload',
      }), {
        status: 422,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    render(
      <CreateFromDSLModal
        show={true}
        onClose={vi.fn()}
        activeTab={CreateFromDSLModalTab.FROM_FILE}
        droppedFile={new File(['kind: claude-workflow'], 'claude_workflow.yaml', { type: 'text/yaml' })}
      />,
    )

    const importButton = screen.getByText('app.newApp.Create').closest('button')

    await waitFor(() => {
      expect(importButton).not.toBeDisabled()
    })

    fireEvent.click(importButton!)

    await waitFor(() => {
      expect(mockNotify).toHaveBeenCalledWith({
        type: 'error',
        message: 'Invalid selector payload',
      })
    })
  })
})
