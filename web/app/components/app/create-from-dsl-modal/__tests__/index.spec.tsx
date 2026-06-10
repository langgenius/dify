/* eslint-disable ts/no-explicit-any */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { NEED_REFRESH_APP_LIST_KEY } from '@/config'
import { DSLImportMode, DSLImportStatus } from '@/models/app'
import CreateFromDSLModal, { CreateFromDSLModalTab } from '../index'

const mockPush = vi.fn()
const mockCreateDSLRun = vi.fn()
const mockGetDSLRun = vi.fn()
const mockImportDSL = vi.fn()
const mockImportDSLConfirm = vi.fn()
const mockTrackEvent = vi.fn()
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

vi.mock('@/app/components/base/amplitude', () => ({
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
}))

vi.mock('@/service/apps', () => ({
  createDSLRun: (...args: unknown[]) => mockCreateDSLRun(...args),
  getDSLRun: (...args: unknown[]) => mockGetDSLRun(...args),
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

vi.mock('@/app/components/base/ui/toast', () => ({
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
  const buildDslRun = (overrides: Record<string, any> = {}) => ({
    id: 'run-1',
    status: 'succeeded',
    created_at: '2026-06-10T00:00:00Z',
    updated_at: '2026-06-10T00:00:01Z',
    current_stage: null,
    request: {
      prompt: 'Summarize customer support tickets.',
    },
    result: {
      yaml_content: 'app: generated',
      name: 'Generated App',
      description: 'Generated description',
      warnings: [],
      metadata: {},
    },
    error: null,
    events: [
      { sequence: 1, stage: 'plan', status: 'completed', message: 'planned', created_at: '2026-06-10T00:00:00Z' },
      { sequence: 2, stage: 'generate', status: 'completed', message: 'generated', created_at: '2026-06-10T00:00:01Z' },
      { sequence: 3, stage: 'validate', status: 'completed', message: 'validated', created_at: '2026-06-10T00:00:01Z' },
      { sequence: 4, stage: 'repair', status: 'skipped', message: 'no repair needed', created_at: '2026-06-10T00:00:01Z' },
    ],
    ...overrides,
  })

  it('should render the file tab and show the dropped file', async () => {
    render(
      <CreateFromDSLModal
        show
        onClose={vi.fn()}
        droppedFile={new File(['app: demo'], 'demo.yml', { type: 'text/yaml' })}
      />,
    )

    expect(screen.getByText('importFromDSL')).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText('demo.yml')).toBeInTheDocument()
    })
  })

  it('should not show the AI generation tab inside the DSL import modal', () => {
    render(
      <CreateFromDSLModal
        show
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByText('importFromDSLFile')).toBeInTheDocument()
    expect(screen.getByText('importFromDSLUrl')).toBeInTheDocument()
    expect(screen.queryByText('importFromDSLAI')).not.toBeInTheDocument()
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
    expect(screen.getByPlaceholderText('importFromDSLUrlPlaceholder')).toBeInTheDocument()

    const closeTrigger = screen.getByText('importFromDSL').parentElement?.querySelector('.cursor-pointer.items-center') as HTMLElement
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
      app_mode: 'chat',
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
    expect(mockTrackEvent).toHaveBeenCalledWith('create_app_with_dsl', expect.objectContaining({
      creation_method: 'dsl_url',
      has_warnings: false,
    }))
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
      app_mode: 'chat',
    })

    render(
      <CreateFromDSLModal
        show
        onClose={vi.fn()}
        droppedFile={new File(['app: demo'], 'demo.yml', { type: 'text/yaml' })}
      />,
    )

    await waitFor(() => {
      expect(screen.getByText('demo.yml')).toBeInTheDocument()
    })

    await act(async () => {
      fireEvent.click(getCreateButton())
    })

    expect(mockImportDSL).toHaveBeenCalledWith({
      mode: DSLImportMode.YAML_CONTENT,
      yaml_content: 'app: demo',
    })
  })

  it('should generate DSL with the AI tab and import the generated YAML', async () => {
    const handleClose = vi.fn()
    const handleSuccess = vi.fn()
    mockCreateDSLRun.mockResolvedValue(buildDslRun())
    mockImportDSL.mockResolvedValue({
      id: 'import-ai',
      status: DSLImportStatus.COMPLETED,
      app_id: 'app-ai',
      app_mode: 'workflow',
    })

    render(
      <CreateFromDSLModal
        show
        onClose={handleClose}
        onSuccess={handleSuccess}
        activeTab={CreateFromDSLModalTab.FROM_AI}
      />,
    )

    fireEvent.change(screen.getByPlaceholderText('newApp.dslAgentPromptPlaceholder'), {
      target: { value: 'Summarize customer support tickets.' },
    })
    fireEvent.change(screen.getByPlaceholderText('newApp.appNamePlaceholder'), {
      target: { value: 'Support Summarizer' },
    })

    await act(async () => {
      fireEvent.click(getCreateButton())
    })

    expect(mockCreateDSLRun).toHaveBeenCalledWith({
      prompt: 'Summarize customer support tickets.',
      app_name: 'Support Summarizer',
      provider: 'langgenius/openai/openai',
      model: 'gpt-4o-mini',
      input_variable: 'input',
      resolve_dependencies: true,
    })
    expect(mockImportDSL).toHaveBeenCalledWith({
      mode: DSLImportMode.YAML_CONTENT,
      yaml_content: 'app: generated',
      name: 'Generated App',
      description: 'Generated description',
    })
    expect(mockTrackEvent).toHaveBeenCalledWith('create_app_with_dsl', expect.objectContaining({
      creation_method: 'dsl_agent',
    }))
    expect(handleSuccess).toHaveBeenCalledTimes(1)
    expect(handleClose).toHaveBeenCalledTimes(1)
    expect(mockHandleCheckPluginDependencies).toHaveBeenCalledWith('app-ai')
  })

  it('should show staged progress while AI generation, import, and dependency checks are running', async () => {
    let resolveRun!: (value: ReturnType<typeof buildDslRun>) => void
    let resolveImport!: (value: { id: string, status: DSLImportStatus, app_id: string, app_mode: string }) => void
    let resolveDependencies!: () => void

    mockCreateDSLRun.mockImplementationOnce(() => new Promise((resolve) => {
      resolveRun = resolve as typeof resolveRun
    }))
    mockImportDSL.mockImplementationOnce(() => new Promise((resolve) => {
      resolveImport = resolve as typeof resolveImport
    }))
    mockHandleCheckPluginDependencies.mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolveDependencies = resolve
    }))

    render(
      <CreateFromDSLModal
        show
        onClose={vi.fn()}
        activeTab={CreateFromDSLModalTab.FROM_AI}
      />,
    )

    fireEvent.change(screen.getByPlaceholderText('newApp.dslAgentPromptPlaceholder'), {
      target: { value: 'Build a slow workflow.' },
    })

    await act(async () => {
      fireEvent.click(getCreateButton())
    })

    expect(screen.getByText('newApp.dslAgentProgressTitle')).toBeInTheDocument()
    expect(screen.getByText('newApp.dslAgentStage.plan')).toBeInTheDocument()
    expect(screen.getByText('newApp.dslAgentStage.plan.desc')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /newApp\.dslAgentWorking/i })).toBeDisabled()

    await act(async () => {
      resolveRun(buildDslRun())
    })

    await waitFor(() => {
      expect(mockImportDSL).toHaveBeenCalled()
      expect(screen.getByText('newApp.dslAgentStage.import.desc')).toBeInTheDocument()
    })

    await act(async () => {
      resolveImport({
        id: 'import-ai',
        status: DSLImportStatus.COMPLETED,
        app_id: 'app-ai',
        app_mode: 'workflow',
      })
    })

    await waitFor(() => {
      expect(mockHandleCheckPluginDependencies).toHaveBeenCalledWith('app-ai')
      expect(screen.getByText('newApp.dslAgentStage.dependencies.desc')).toBeInTheDocument()
    })

    await act(async () => {
      resolveDependencies()
    })
  })

  it('should poll a running AI generation run until it succeeds', async () => {
    mockCreateDSLRun.mockResolvedValue(buildDslRun({
      status: 'running',
      current_stage: 'plan',
      result: null,
      events: [
        { sequence: 1, stage: 'plan', status: 'running', message: 'planning', created_at: '2026-06-10T00:00:00Z' },
      ],
    }))
    mockGetDSLRun.mockResolvedValue(buildDslRun({
      id: 'run-1',
      status: 'succeeded',
    }))
    mockImportDSL.mockResolvedValue({
      id: 'import-ai',
      status: DSLImportStatus.COMPLETED,
      app_id: 'app-ai',
      app_mode: 'workflow',
    })

    render(
      <CreateFromDSLModal
        show
        onClose={vi.fn()}
        activeTab={CreateFromDSLModalTab.FROM_AI}
      />,
    )

    fireEvent.change(screen.getByPlaceholderText('newApp.dslAgentPromptPlaceholder'), {
      target: { value: 'Build a polling workflow.' },
    })

    await act(async () => {
      fireEvent.click(getCreateButton())
    })

    await waitFor(() => {
      expect(mockCreateDSLRun).toHaveBeenCalled()
      expect(screen.getByText('planning')).toBeInTheDocument()
    })

    await waitFor(() => {
      expect(mockGetDSLRun).toHaveBeenCalledWith('run-1')
      expect(mockImportDSL).toHaveBeenCalledWith(expect.objectContaining({
        yaml_content: 'app: generated',
      }))
    }, { timeout: 2500 })
  })

  it('should show backend stage messages while a repair run is active', async () => {
    mockCreateDSLRun.mockResolvedValue(buildDslRun({
      status: 'running',
      current_stage: 'repair',
      result: null,
      events: [
        { sequence: 1, stage: 'plan', status: 'completed', message: 'planned', created_at: '2026-06-10T00:00:00Z' },
        { sequence: 2, stage: 'validate', status: 'completed', message: 'Generated YAML needs deterministic repair.', created_at: '2026-06-10T00:00:01Z' },
        { sequence: 3, stage: 'repair', status: 'running', message: 'Repairing generated YAML.', created_at: '2026-06-10T00:00:02Z' },
      ],
    }))
    mockGetDSLRun.mockResolvedValue(buildDslRun({ id: 'run-1', status: 'succeeded' }))
    mockImportDSL.mockResolvedValue({
      id: 'import-ai',
      status: DSLImportStatus.COMPLETED,
      app_id: 'app-ai',
      app_mode: 'workflow',
    })

    render(
      <CreateFromDSLModal
        show
        onClose={vi.fn()}
        activeTab={CreateFromDSLModalTab.FROM_AI}
      />,
    )

    fireEvent.change(screen.getByPlaceholderText('newApp.dslAgentPromptPlaceholder'), {
      target: { value: 'Build a workflow that needs repair.' },
    })

    await act(async () => {
      fireEvent.click(getCreateButton())
    })

    await waitFor(() => {
      expect(screen.getByText('Repairing generated YAML.')).toBeInTheDocument()
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
      expect(screen.getByText('demo.yml')).toBeInTheDocument()
    })

    const removeButton = screen.getByText('demo.yml').closest('.group')?.querySelector('button') as HTMLButtonElement
    await act(async () => {
      fireEvent.click(removeButton)
    })

    await waitFor(() => {
      expect(screen.queryByText('demo.yml')).not.toBeInTheDocument()
      expect(getCreateButton()).toBeDisabled()
    })

    ahooksMocks.handlers.findLast(item => Array.isArray(item.keys))?.handler()
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
      app_mode: 'workflow',
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

    expect(screen.getAllByText('newApp.appCreateDSLErrorTitle')[0]).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: 'newApp.Confirm' })[0])
    })

    expect(mockImportDSLConfirm).toHaveBeenCalledWith({
      import_id: 'import-3',
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
        app_mode: 'chat',
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

    expect(screen.getByText('apps-full')).toBeInTheDocument()
    ahooksMocks.handlers.findLast(item => Array.isArray(item.keys))?.handler()
    expect(mockImportDSL).toHaveBeenCalledTimes(1)
  })

  it('should show failure toasts for failed and rejected imports', async () => {
    mockImportDSL.mockResolvedValueOnce({
      id: 'import-failed',
      status: DSLImportStatus.FAILED,
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
    expect(toastMocks.error).toHaveBeenCalledWith('newApp.appCreateFailed')

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
      .mockResolvedValueOnce({ status: DSLImportStatus.FAILED })
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
      fireEvent.click(screen.getAllByRole('button', { name: 'newApp.Confirm' })[0])
    })
    expect(toastMocks.error).toHaveBeenCalledWith('newApp.appCreateFailed')

    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: 'newApp.Confirm' })[0])
    })
    expect(toastMocks.error).toHaveBeenCalledTimes(2)
  })
})
