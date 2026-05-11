/* eslint-disable ts/no-explicit-any */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { NEED_REFRESH_APP_LIST_KEY } from '@/config'
import { DSLImportMode, DSLImportStatus } from '@/models/app'
import { AppModeEnum } from '@/types/app'
import CreateFromDSLModal, { CreateFromDSLModalTab } from '../index'

const mockPush = vi.fn()
const mockImportDSL = vi.fn()
const mockImportDSLConfirm = vi.fn()
const mockTrackCreateApp = vi.fn()
const mockHandleCheckPluginDependencies = vi.fn()
const mockGetRedirection = vi.fn()
const toastMocks = vi.hoisted(() => ({
  call: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
}))
const ahooksMocks = vi.hoisted(() => ({
  handlers: [] as Array<{ keys: unknown, handler: () => void }>,
}))
let mockPlanUsage = 0
let mockPlanTotal = 10

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('ahooks', () => ({
  useDebounceFn: (fn: (...args: any[]) => any) => ({
    run: fn,
  }),
  useKeyPress: (keys: unknown, handler: () => void) => {
    ahooksMocks.handlers.push({ keys, handler })
  },
}))

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}))

vi.mock('@/utils/create-app-tracking', () => ({
  trackCreateApp: (...args: unknown[]) => mockTrackCreateApp(...args),
}))

vi.mock('@/service/apps', () => ({
  importDSL: (...args: unknown[]) => mockImportDSL(...args),
  importDSLConfirm: (...args: unknown[]) => mockImportDSLConfirm(...args),
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
    plan: {
      usage: {
        buildApps: mockPlanUsage,
      },
      total: {
        buildApps: mockPlanTotal,
      },
    },
    enableBilling: true,
  }),
}))

vi.mock('@/utils/app-redirection', () => ({
  getRedirection: (...args: unknown[]) => mockGetRedirection(...args),
}))

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: Object.assign(
    (...args: unknown[]) => toastMocks.call(...args),
    {
      success: (...args: unknown[]) => toastMocks.success(...args),
      error: (...args: unknown[]) => toastMocks.error(...args),
      warning: (...args: unknown[]) => toastMocks.warning(...args),
    },
  ),
}))

vi.mock('@/app/components/billing/apps-full-in-dialog', () => ({
  default: () => <div>apps-full</div>,
}))

vi.mock('../../workflow/shortcuts-name', () => ({
  default: ({ keys }: { keys: string[] }) => <span>{keys.join('+')}</span>,
}))

describe('CreateFromDSLModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ahooksMocks.handlers.length = 0
    mockPlanUsage = 0
    mockPlanTotal = 10
    localStorage.clear()

    class MockFileReader {
      result = 'app: demo'
      onload: ((event: { target: { result: string } }) => void) | null = null
      readAsText() {
        this.onload?.({ target: { result: this.result } })
      }
    }

    // @ts-expect-error test-only file reader shim
    globalThis.FileReader = MockFileReader
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const getCreateButton = () => screen.getByRole('button', { name: /newApp\.Create/i })

  it('should render the file tab and show the dropped file', async () => {
    render(
      <CreateFromDSLModal
        show
        onClose={vi.fn()}
        droppedFile={new File(['app: demo'], 'demo.yml', { type: 'text/yaml' })}
      />,
    )

    expect(screen.getByText('importApp'))!.toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText('demo.yml'))!.toBeInTheDocument()
    })
  })

  it('should switch tabs, close from the header icon, and ignore shortcuts without valid input', async () => {
    const handleClose = vi.fn()
    render(
      <CreateFromDSLModal
        show
        onClose={handleClose}
      />,
    )

    ahooksMocks.handlers.find(item => Array.isArray(item.keys))?.handler()
    expect(mockImportDSL).not.toHaveBeenCalled()

    await act(async () => {
      fireEvent.click(screen.getByText('importFromDSLUrl'))
    })
    expect(screen.getByPlaceholderText('importFromDSLUrlPlaceholder'))!.toBeInTheDocument()

    const closeTrigger = screen.getByText('importApp').parentElement?.querySelector('.cursor-pointer.items-center') as HTMLElement
    fireEvent.click(closeTrigger)
    expect(handleClose).toHaveBeenCalledTimes(1)
  })

  it('should import from a URL and redirect after a successful import', async () => {
    const handleClose = vi.fn()
    const handleSuccess = vi.fn()
    mockImportDSL.mockResolvedValue({
      id: 'import-1',
      status: DSLImportStatus.COMPLETED,
      app_id: 'app-1',
      app_mode: AppModeEnum.CHAT,
    })

    render(
      <CreateFromDSLModal
        show
        onClose={handleClose}
        onSuccess={handleSuccess}
        activeTab={CreateFromDSLModalTab.FROM_URL}
      />,
    )

    fireEvent.change(screen.getByPlaceholderText('importFromDSLUrlPlaceholder'), {
      target: { value: 'https://example.com/app.yml' },
    })

    await act(async () => {
      fireEvent.click(getCreateButton())
    })

    expect(mockImportDSL).toHaveBeenCalledWith({
      mode: DSLImportMode.YAML_URL,
      yaml_url: 'https://example.com/app.yml',
    })
    expect(mockTrackCreateApp).toHaveBeenCalledWith({ appMode: AppModeEnum.CHAT })
    expect(handleSuccess).toHaveBeenCalledTimes(1)
    expect(handleClose).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem(NEED_REFRESH_APP_LIST_KEY)).toBe('1')
    expect(mockHandleCheckPluginDependencies).toHaveBeenCalledWith('app-1')
    expect(mockGetRedirection).toHaveBeenCalledWith(true, { id: 'app-1', mode: 'chat' }, mockPush)
  })

  it('should import from a file with the loaded file content', async () => {
    mockImportDSL.mockResolvedValue({
      id: 'import-2',
      status: DSLImportStatus.COMPLETED_WITH_WARNINGS,
      app_id: 'app-2',
      app_mode: AppModeEnum.CHAT,
    })

    render(
      <CreateFromDSLModal
        show
        onClose={vi.fn()}
        droppedFile={new File(['app: demo'], 'demo.yml', { type: 'text/yaml' })}
      />,
    )

    await waitFor(() => {
      expect(screen.getByText('demo.yml'))!.toBeInTheDocument()
    })

    await act(async () => {
      fireEvent.click(getCreateButton())
    })

    expect(mockImportDSL).toHaveBeenCalledWith({
      mode: DSLImportMode.YAML_CONTENT,
      yaml_content: 'app: demo',
    })
  })

  it('should remove the current file and keep the create shortcut guarded', async () => {
    render(
      <CreateFromDSLModal
        show
        onClose={vi.fn()}
        droppedFile={new File(['app: demo'], 'demo.yml', { type: 'text/yaml' })}
      />,
    )

    await waitFor(() => {
      expect(screen.getByText('demo.yml'))!.toBeInTheDocument()
    })

    const removeButton = screen.getByText('demo.yml').closest('.group')?.querySelector('button') as HTMLButtonElement
    await act(async () => {
      fireEvent.click(removeButton)
    })

    await waitFor(() => {
      expect(screen.queryByText('demo.yml')).not.toBeInTheDocument()
      expect(getCreateButton())!.toBeDisabled()
    })

    const latestHandlerAfterRemove = [...ahooksMocks.handlers].reverse().find(item => Array.isArray(item.keys))
    latestHandlerAfterRemove?.handler()
    expect(mockImportDSL).not.toHaveBeenCalled()
  })

  it('should show the DSL mismatch modal and confirm a pending import', async () => {
    vi.useFakeTimers()
    mockImportDSL.mockResolvedValue({
      id: 'import-3',
      status: DSLImportStatus.PENDING,
      imported_dsl_version: '1.0.0',
      current_dsl_version: '2.0.0',
    })
    mockImportDSLConfirm.mockResolvedValue({
      status: DSLImportStatus.COMPLETED,
      app_id: 'app-3',
      app_mode: AppModeEnum.WORKFLOW,
    })

    render(
      <CreateFromDSLModal
        show
        onClose={vi.fn()}
        onSuccess={vi.fn()}
        activeTab={CreateFromDSLModalTab.FROM_URL}
        dslUrl="https://example.com/app.yml"
      />,
    )

    await act(async () => {
      fireEvent.click(getCreateButton())
    })

    await act(async () => {
      vi.advanceTimersByTime(300)
    })

    expect(screen.getAllByText('newApp.appCreateDSLErrorTitle')[0])!.toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: 'newApp.Confirm' })[0]!)
    })

    expect(mockImportDSLConfirm).toHaveBeenCalledWith({
      import_id: 'import-3',
    })
    expect(mockTrackCreateApp).toHaveBeenCalledWith({ appMode: AppModeEnum.WORKFLOW })
  })

  it('should close the DSL mismatch modal when dialog requests close', async () => {
    vi.useFakeTimers()
    mockImportDSL.mockResolvedValue({
      id: 'import-close',
      status: DSLImportStatus.PENDING,
      imported_dsl_version: '1.0.0',
      current_dsl_version: '2.0.0',
    })

    render(
      <CreateFromDSLModal
        show
        onClose={vi.fn()}
        activeTab={CreateFromDSLModalTab.FROM_URL}
        dslUrl="https://example.com/app.yml"
      />,
    )

    await act(async () => {
      fireEvent.click(getCreateButton())
    })

    await act(async () => {
      vi.advanceTimersByTime(300)
    })

    expect(screen.getByText('newApp.appCreateDSLErrorTitle'))!.toBeInTheDocument()

    vi.useRealTimers()
    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' })

    await waitFor(() => {
      expect(screen.queryByText('newApp.appCreateDSLErrorTitle')).not.toBeInTheDocument()
    })
  })

  it('should close the DSL mismatch modal when cancel is clicked', async () => {
    vi.useFakeTimers()
    mockImportDSL.mockResolvedValue({
      id: 'import-cancel',
      status: DSLImportStatus.PENDING,
      imported_dsl_version: '1.0.0',
      current_dsl_version: '2.0.0',
    })

    render(
      <CreateFromDSLModal
        show
        onClose={vi.fn()}
        activeTab={CreateFromDSLModalTab.FROM_URL}
        dslUrl="https://example.com/app.yml"
      />,
    )

    await act(async () => {
      fireEvent.click(getCreateButton())
    })

    await act(async () => {
      vi.advanceTimersByTime(300)
    })

    expect(screen.getByText('newApp.appCreateDSLErrorTitle'))!.toBeInTheDocument()

    vi.useRealTimers()
    fireEvent.click(screen.getAllByRole('button', { name: 'newApp.Cancel' }).at(-1)!)

    await waitFor(() => {
      expect(screen.queryByText('newApp.appCreateDSLErrorTitle')).not.toBeInTheDocument()
    })
  })

  it('should ignore empty import responses and prevent duplicate submissions while a request is in flight', async () => {
    let resolveImport!: (value: { id: string, status: DSLImportStatus, app_id: string, app_mode: string }) => void
    mockImportDSL.mockImplementationOnce(() => new Promise((resolve) => {
      resolveImport = resolve as typeof resolveImport
    }))

    render(
      <CreateFromDSLModal
        show
        onClose={vi.fn()}
        activeTab={CreateFromDSLModalTab.FROM_URL}
        dslUrl="https://example.com/app.yml"
      />,
    )

    fireEvent.click(getCreateButton())
    fireEvent.click(getCreateButton())

    expect(mockImportDSL).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveImport({
        id: 'import-in-flight',
        status: DSLImportStatus.COMPLETED,
        app_id: 'app-1',
        app_mode: AppModeEnum.CHAT,
      })
    })

    mockImportDSL.mockResolvedValueOnce(undefined)

    await act(async () => {
      fireEvent.click(getCreateButton())
    })

    expect(mockImportDSL).toHaveBeenCalledTimes(2)
    expect(toastMocks.error).not.toHaveBeenCalled()
  })

  it('should handle keyboard shortcuts, quota guard, and escape close', async () => {
    const handleClose = vi.fn()
    mockImportDSL.mockResolvedValue({
      id: 'import-shortcut',
      status: DSLImportStatus.COMPLETED,
      app_id: 'app-shortcut',
      app_mode: 'chat',
    })

    render(
      <CreateFromDSLModal
        show
        onClose={handleClose}
        activeTab={CreateFromDSLModalTab.FROM_URL}
        dslUrl="https://example.com/app.yml"
      />,
    )

    ahooksMocks.handlers.find(item => Array.isArray(item.keys))?.handler()

    await waitFor(() => {
      expect(mockImportDSL).toHaveBeenCalledWith({
        mode: DSLImportMode.YAML_URL,
        yaml_url: 'https://example.com/app.yml',
      })
    })

    ahooksMocks.handlers.find(item => item.keys === 'esc')?.handler()
    expect(handleClose).toHaveBeenCalled()

    mockPlanUsage = 1
    mockPlanTotal = 1
    render(
      <CreateFromDSLModal
        show
        onClose={vi.fn()}
        activeTab={CreateFromDSLModalTab.FROM_URL}
        dslUrl="https://example.com/app.yml"
      />,
    )

    expect(screen.getByText('apps-full'))!.toBeInTheDocument()
    const latestPlanLimitHandler = [...ahooksMocks.handlers].reverse().find(item => Array.isArray(item.keys))
    latestPlanLimitHandler?.handler()
    expect(mockImportDSL).toHaveBeenCalledTimes(1)
  })

  it('should show failure toasts for failed and rejected imports', async () => {
    mockImportDSL.mockResolvedValueOnce({
      id: 'import-failed',
      status: DSLImportStatus.FAILED,
      error: 'Invalid YAML format',
    })
    mockImportDSL.mockRejectedValueOnce(new Error('boom'))

    const { rerender } = render(
      <CreateFromDSLModal
        show
        onClose={vi.fn()}
        activeTab={CreateFromDSLModalTab.FROM_URL}
        dslUrl="https://example.com/app.yml"
      />,
    )

    await act(async () => {
      fireEvent.click(getCreateButton())
    })
    expect(toastMocks.error).toHaveBeenCalledWith('Invalid YAML format')

    rerender(
      <CreateFromDSLModal
        show
        onClose={vi.fn()}
        activeTab={CreateFromDSLModalTab.FROM_URL}
        dslUrl="https://example.com/app.yml"
      />,
    )

    await act(async () => {
      fireEvent.click(getCreateButton())
    })
    expect(toastMocks.error).toHaveBeenCalledTimes(2)
    expect(toastMocks.error).toHaveBeenLastCalledWith('newApp.appCreateFailed')
  })

  it('should handle pending import confirmation failures and cancellation', async () => {
    vi.useFakeTimers()
    mockImportDSL.mockResolvedValue({
      id: 'import-4',
      status: DSLImportStatus.PENDING,
      imported_dsl_version: '1.0.0',
      current_dsl_version: '2.0.0',
    })
    mockImportDSLConfirm
      .mockResolvedValueOnce({ status: DSLImportStatus.FAILED, error: 'Confirm failed' })
      .mockRejectedValueOnce(new Error('boom'))

    render(
      <CreateFromDSLModal
        show
        onClose={vi.fn()}
        activeTab={CreateFromDSLModalTab.FROM_URL}
        dslUrl="https://example.com/app.yml"
      />,
    )

    await act(async () => {
      fireEvent.click(getCreateButton())
      vi.advanceTimersByTime(300)
    })

    fireEvent.click(screen.getAllByRole('button', { name: 'newApp.Cancel' }).at(-1)!)
    expect(screen.queryByText('newApp.appCreateDSLErrorTitle')).not.toBeInTheDocument()

    await act(async () => {
      fireEvent.click(getCreateButton())
      vi.advanceTimersByTime(300)
    })
    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: 'newApp.Confirm' })[0]!)
    })
    expect(toastMocks.error).toHaveBeenCalledWith('Confirm failed')

    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: 'newApp.Confirm' })[0]!)
    })
    expect(toastMocks.error).toHaveBeenCalledTimes(2)
    expect(toastMocks.error).toHaveBeenLastCalledWith('newApp.appCreateFailed')
  })
})
