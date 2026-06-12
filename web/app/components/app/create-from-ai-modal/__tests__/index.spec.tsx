/* eslint-disable ts/no-explicit-any */
import { act, fireEvent, render, screen } from '@testing-library/react'
import { NEED_REFRESH_APP_LIST_KEY } from '@/config'
import { DSLImportMode, DSLImportStatus } from '@/models/app'
import CreateFromAIModal from '../index'

const mockPush = vi.fn()
const mockCreateDSLRun = vi.fn()
const mockGetDSLRun = vi.fn()
const mockImportDSL = vi.fn()
const mockImportDSLConfirm = vi.fn()
const mockDebugAndRepairDSLAgentDraftRun = vi.fn()
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
let mockDefaultModel = {
  provider: {
    provider: 'langgenius/openai/openai',
  },
  model: 'gpt-5.5',
}
let mockModelList = [
  {
    provider: 'langgenius/openai/openai',
    models: [
      { model: 'gpt-4o-mini' },
      { model: 'gpt-5.5' },
    ],
  },
]

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
  debugAndRepairDSLAgentDraftRun: (...args: unknown[]) => mockDebugAndRepairDSLAgentDraftRun(...args),
  getDSLRun: (...args: unknown[]) => mockGetDSLRun(...args),
  importDSL: (...args: unknown[]) => mockImportDSL(...args),
  importDSLConfirm: (...args: unknown[]) => mockImportDSLConfirm(...args),
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useModelListAndDefaultModel: () => ({
    defaultModel: mockDefaultModel,
    modelList: mockModelList,
  }),
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/model-selector', () => ({
  default: ({
    defaultModel,
    onSelect,
    triggerClassName,
    popupClassName,
    popupPlacement,
    positionerProps,
  }: {
    defaultModel?: { provider: string, model: string }
    onSelect: (model: { provider: string, model: string }) => void
    triggerClassName?: string
    popupClassName?: string
    popupPlacement?: string
    positionerProps?: { collisionAvoidance?: { fallbackAxisSide?: string } }
  }) => (
    <div>
      <div data-testid="selected-model">{defaultModel ? `${defaultModel.provider}/${defaultModel.model}` : 'none'}</div>
      <div data-testid="model-selector-trigger-class">{triggerClassName}</div>
      <div data-testid="model-selector-popup-class">{popupClassName}</div>
      <div data-testid="model-selector-popup-placement">{popupPlacement}</div>
      <div data-testid="model-selector-fallback-axis-side">{positionerProps?.collisionAvoidance?.fallbackAxisSide}</div>
      <button
        type="button"
        onClick={() => onSelect({ provider: 'langgenius/openai/openai', model: 'gpt-4o' })}
      >
        Select GPT-4o
      </button>
    </div>
  ),
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

describe('CreateFromAIModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ahooksMocks.handlers.length = 0
    mockPlanUsage = 0
    mockPlanTotal = 10
    mockDefaultModel = {
      provider: {
        provider: 'langgenius/openai/openai',
      },
      model: 'gpt-5.5',
    }
    mockModelList = [
      {
        provider: 'langgenius/openai/openai',
        models: [
          { model: 'gpt-4o-mini' },
          { model: 'gpt-5.5' },
        ],
      },
    ]
    localStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const getCreateButton = () => screen.getByRole('button', { name: /newApp\.dslAgent(Generate|Refine)AndImport/i })
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

  it('should generate DSL with the workspace default model and import the generated YAML', async () => {
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
      <CreateFromAIModal
        show
        onClose={handleClose}
        onSuccess={handleSuccess}
      />,
    )

    expect(screen.getByTestId('selected-model')).toHaveTextContent('langgenius/openai/openai/gpt-5.5')
    expect(screen.getByTestId('model-selector-trigger-class')).toHaveTextContent('h-10 gap-2 px-2')
    expect(screen.getByTestId('model-selector-popup-class')).toHaveTextContent('!z-[1200]')
    expect(screen.getByTestId('model-selector-popup-placement')).toHaveTextContent('top-start')
    expect(screen.getByTestId('model-selector-fallback-axis-side')).toHaveTextContent('none')

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
      model: 'gpt-5.5',
      input_variable: 'input',
      resolve_dependencies: true,
    })
    expect(mockImportDSL).toHaveBeenCalledWith({
      mode: DSLImportMode.YAML_CONTENT,
      yaml_content: 'app: generated',
      name: 'Generated App',
      description: 'Generated description',
    })
    expect(mockTrackEvent).toHaveBeenCalledWith('create_app_with_ai', expect.objectContaining({
      app_mode: 'workflow',
    }))
    expect(handleSuccess).toHaveBeenCalledTimes(1)
    expect(handleClose).not.toHaveBeenCalled()
    expect(localStorage.getItem(NEED_REFRESH_APP_LIST_KEY)).toBe('1')
    expect(mockHandleCheckPluginDependencies).toHaveBeenCalledWith('app-ai')
    expect(screen.getByText('newApp.dslAgentGeneratedYaml')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /newApp\.dslAgentExecuteAndRepair/i })).toBeEnabled()
    expect(screen.getByRole('button', { name: /newApp\.dslAgentOpenApp/i })).toBeEnabled()
  })

  it('should open an imported app from the builder panel', async () => {
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
      <CreateFromAIModal
        show
        onClose={handleClose}
        onSuccess={handleSuccess}
      />,
    )

    fireEvent.change(screen.getByPlaceholderText('newApp.dslAgentPromptPlaceholder'), {
      target: { value: 'Summarize customer support tickets.' },
    })

    await act(async () => {
      fireEvent.click(getCreateButton())
    })

    expect(handleSuccess).toHaveBeenCalledTimes(1)
    expect(handleClose).not.toHaveBeenCalled()
    expect(mockGetRedirection).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /newApp\.dslAgentOpenApp/i }))

    expect(handleClose).toHaveBeenCalledTimes(1)
    expect(mockGetRedirection).toHaveBeenCalled()
    expect(toastMocks.error).not.toHaveBeenCalled()
  })

  it('should compose guided fields into the DSL agent prompt', async () => {
    mockCreateDSLRun.mockResolvedValue(buildDslRun())
    mockImportDSL.mockResolvedValue({
      id: 'import-ai',
      status: DSLImportStatus.COMPLETED,
      app_id: 'app-ai',
      app_mode: 'workflow',
    })

    render(
      <CreateFromAIModal
        show
        onClose={vi.fn()}
      />,
    )

    fireEvent.change(screen.getByPlaceholderText('newApp.dslAgentPromptPlaceholder'), {
      target: { value: 'Build an onboarding workflow.' },
    })
    fireEvent.change(screen.getByPlaceholderText('newApp.dslAgentGuide.triggerPlaceholder'), {
      target: { value: 'Manual run from sales team' },
    })
    fireEvent.change(screen.getByPlaceholderText('newApp.dslAgentGuide.dataSourcePlaceholder'), {
      target: { value: 'HubSpot company notes' },
    })
    fireEvent.change(screen.getByPlaceholderText('newApp.dslAgentGuide.processingPlaceholder'), {
      target: { value: 'Extract pain points and classify urgency' },
    })
    fireEvent.change(screen.getByPlaceholderText('newApp.dslAgentGuide.outputPlaceholder'), {
      target: { value: 'Structured customer brief' },
    })
    fireEvent.change(screen.getByPlaceholderText('newApp.dslAgentGuide.testInputPlaceholder'), {
      target: { value: 'Mock account: ACME api_key=sk-testSecret1234567890' },
    })

    await act(async () => {
      fireEvent.click(getCreateButton())
    })

    const prompt = mockCreateDSLRun.mock.calls[0][0].prompt
    expect(prompt).toContain('Build an onboarding workflow.')
    expect(prompt).toContain('Guided workflow requirements:')
    expect(prompt).toContain('- Trigger: Manual run from sales team')
    expect(prompt).toContain('- Data source: HubSpot company notes')
    expect(prompt).toContain('- Processing: Extract pain points and classify urgency')
    expect(prompt).toContain('- Output: Structured customer brief')
    expect(prompt).toContain('- Credentials/Test input: Mock account: ACME api_key=[redacted]')
    expect(prompt).not.toContain('sk-testSecret1234567890')
  })

  it('should execute and repair the imported draft app', async () => {
    mockCreateDSLRun.mockResolvedValue(buildDslRun())
    mockImportDSL
      .mockResolvedValueOnce({
        id: 'import-ai',
        status: DSLImportStatus.COMPLETED,
        app_id: 'app-ai',
        app_mode: 'workflow',
      })
      .mockResolvedValueOnce({
        id: 'repair-import',
        status: DSLImportStatus.COMPLETED,
        app_id: 'app-ai',
        app_mode: 'workflow',
      })
    mockDebugAndRepairDSLAgentDraftRun
      .mockResolvedValueOnce({
        draft_run: {
          mode: 'workflow',
          event_count: 2,
          summary: {
            event_count: 2,
            status: 'failed',
            succeeded: false,
            outputs: null,
            node_statuses: [],
            failed_nodes: [{ node_id: 'llm-1', error: 'bad selector' }],
            errors: [{ message: 'bad selector' }],
          },
          events: [],
        },
        needs_repair: true,
        repair: {
          yaml_content: 'app: repaired',
          changed: true,
          input_validation: {},
          validation: { valid: true },
          repair: {},
        },
      })
      .mockResolvedValueOnce({
        draft_run: {
          mode: 'workflow',
          event_count: 3,
          summary: {
            event_count: 3,
            status: 'succeeded',
            succeeded: true,
            outputs: { answer: 'ok' },
            node_statuses: [],
            failed_nodes: [],
            errors: [],
          },
          events: [],
        },
        needs_repair: false,
        repair: {
          yaml_content: 'app: repaired',
          changed: false,
          input_validation: {},
          validation: { valid: true },
          repair: {},
        },
      })

    render(
      <CreateFromAIModal
        show
        onClose={vi.fn()}
      />,
    )

    fireEvent.change(screen.getByPlaceholderText('newApp.dslAgentPromptPlaceholder'), {
      target: { value: 'Build a workflow that needs runtime repair.' },
    })
    fireEvent.change(screen.getByPlaceholderText('newApp.dslAgentGuide.testInputPlaceholder'), {
      target: { value: 'Mock input for draft execution' },
    })

    await act(async () => {
      fireEvent.click(getCreateButton())
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /newApp\.dslAgentExecuteAndRepair/i }))
    })

    expect(mockDebugAndRepairDSLAgentDraftRun).toHaveBeenCalledWith('app-ai', expect.objectContaining({
      yaml_content: 'app: generated',
      inputs: {
        input: 'Mock input for draft execution',
      },
      query: 'Mock input for draft execution',
      include_events: true,
    }))
    expect(mockDebugAndRepairDSLAgentDraftRun).toHaveBeenCalledWith('app-ai', expect.objectContaining({
      yaml_content: 'app: repaired',
      validation: { valid: true },
    }))
    expect(mockDebugAndRepairDSLAgentDraftRun).toHaveBeenCalledTimes(2)
    expect(mockImportDSL).toHaveBeenLastCalledWith({
      mode: DSLImportMode.YAML_CONTENT,
      yaml_content: 'app: repaired',
      app_id: 'app-ai',
      name: 'Generated App',
      description: 'Generated description',
    })
    expect(toastMocks.success).toHaveBeenCalledWith('newApp.dslAgentRepairVerifiedNotice')
    expect(screen.getByText('newApp.dslAgentTestResultTitle')).toBeInTheDocument()
    expect(screen.getByText('app: repaired')).toBeInTheDocument()
  })

  it('should clear builder context when starting over', async () => {
    mockCreateDSLRun.mockResolvedValue(buildDslRun())
    mockImportDSL.mockResolvedValue({
      id: 'import-ai',
      status: DSLImportStatus.COMPLETED,
      app_id: 'app-ai',
      app_mode: 'workflow',
    })

    render(
      <CreateFromAIModal
        show
        onClose={vi.fn()}
      />,
    )

    fireEvent.change(screen.getByPlaceholderText('newApp.dslAgentPromptPlaceholder'), {
      target: { value: 'Build a workflow.' },
    })

    await act(async () => {
      fireEvent.click(getCreateButton())
    })

    expect(screen.getByText('app: generated')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /newApp\.dslAgentStartOver/i }))

    expect(screen.queryByText('app: generated')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /newApp\.dslAgentExecuteAndRepair/i })).not.toBeInTheDocument()
    expect(screen.getByPlaceholderText('newApp.dslAgentPromptPlaceholder')).toHaveValue('')
  })

  it('should use the model selected from the model selector', async () => {
    mockCreateDSLRun.mockResolvedValue(buildDslRun())
    mockImportDSL.mockResolvedValue({
      id: 'import-ai',
      status: DSLImportStatus.COMPLETED,
      app_id: 'app-ai',
      app_mode: 'workflow',
    })

    render(
      <CreateFromAIModal
        show
        onClose={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByText('Select GPT-4o'))
    fireEvent.change(screen.getByPlaceholderText('newApp.dslAgentPromptPlaceholder'), {
      target: { value: 'Build a workflow with a better model.' },
    })

    await act(async () => {
      fireEvent.click(getCreateButton())
    })

    expect(mockCreateDSLRun).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'langgenius/openai/openai',
      model: 'gpt-4o',
    }))
  })

  it('should show staged progress while generation is running', async () => {
    let resolveRun!: (value: ReturnType<typeof buildDslRun>) => void
    mockCreateDSLRun.mockImplementationOnce(() => new Promise((resolve) => {
      resolveRun = resolve as typeof resolveRun
    }))

    render(
      <CreateFromAIModal
        show
        onClose={vi.fn()}
      />,
    )

    fireEvent.change(screen.getByPlaceholderText('newApp.dslAgentPromptPlaceholder'), {
      target: { value: 'Build a slow workflow.' },
    })

    await act(async () => {
      fireEvent.click(getCreateButton())
    })

    expect(screen.getByText('newApp.dslAgentProgressTitle')).toBeInTheDocument()
    expect(screen.getAllByText('newApp.dslAgentStage.plan').length).toBeGreaterThan(0)
    expect(screen.getByText('newApp.dslAgentStage.plan.desc')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /newApp\.dslAgentStage\.plan/i })).toBeDisabled()

    await act(async () => {
      resolveRun(buildDslRun())
    })
  })

  it('should show an actionable message when the DSL agent API is unavailable', async () => {
    mockCreateDSLRun.mockRejectedValueOnce(new TypeError('Failed to fetch'))

    render(
      <CreateFromAIModal
        show
        onClose={vi.fn()}
      />,
    )

    fireEvent.change(screen.getByPlaceholderText('newApp.dslAgentPromptPlaceholder'), {
      target: { value: 'Build a workflow.' },
    })

    await act(async () => {
      fireEvent.click(getCreateButton())
    })

    expect(screen.getByText('newApp.dslAgentApiUnavailable')).toBeInTheDocument()
    expect(toastMocks.error).toHaveBeenCalledWith(
      'newApp.appCreateFailed',
      { description: 'newApp.dslAgentApiUnavailable' },
    )
  })

  it('should disable create when no model is available', () => {
    mockDefaultModel = {
      provider: {
        provider: '',
      },
      model: '',
    }
    mockModelList = []

    render(
      <CreateFromAIModal
        show
        onClose={vi.fn()}
      />,
    )

    fireEvent.change(screen.getByPlaceholderText('newApp.dslAgentPromptPlaceholder'), {
      target: { value: 'Build a workflow.' },
    })

    expect(getCreateButton()).toBeDisabled()
  })
})
