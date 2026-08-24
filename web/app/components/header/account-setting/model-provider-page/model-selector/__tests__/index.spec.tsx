import type { ModelProviderSummaryResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { ReactNode } from 'react'
import type { Model, ModelItem } from '../../declarations'
import { QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { consoleQuery } from '@/service/client'
import { createConsoleQueryClient } from '@/test/console/query-data'
import { ConfigurationMethodEnum, ModelStatusEnum, ModelTypeEnum } from '../../declarations'
import { ModelSelector, SplitModelSelector } from '../index'

const makeModelItem = (overrides: Partial<ModelItem> = {}): ModelItem => ({
  model: 'gpt-4',
  label: { en_US: 'GPT-4', zh_Hans: 'GPT-4' },
  model_type: ModelTypeEnum.textGeneration,
  fetch_from: ConfigurationMethodEnum.predefinedModel,
  status: ModelStatusEnum.active,
  model_properties: {},
  load_balancing_enabled: false,
  ...overrides,
})

const mockModelProviders = vi.hoisted(() => ({ current: [] as Model[] }))
const mockSetSettingsDestination = vi.hoisted(() => vi.fn())

vi.mock('nuqs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('nuqs')>()
  return {
    ...actual,
    useQueryState: () => [null, mockSetSettingsDestination],
  }
})

vi.mock('@/context/provider-context', () => ({
  useProviderContext: () => ({ modelProviders: mockModelProviders.current }),
}))
vi.mock('../../provider-added-card/use-credential-panel-state', () => ({
  useCredentialPanelState: () => ({
    variant: 'credits-active',
    priority: 'credits',
    supportsCredits: true,
    showPrioritySwitcher: true,
    hasCredentials: false,
    isCreditsExhausted: false,
    credentialName: undefined,
    credits: 100,
  }),
}))

vi.mock('../popup', () => {
  return {
    default: ({
      onConfigureEmptyState,
      onHide,
      onOpenProviderSettings,
      onSelect,
    }: {
      onConfigureEmptyState?: () => void
      onHide: () => void
      onOpenProviderSettings?: () => void
      onSelect: (provider: string, model: ModelItem) => void
    }) => (
      <>
        <button type="button" onClick={() => onSelect('openai', makeModelItem())}>
          select
        </button>
        <button type="button" onClick={onHide}>
          hide
        </button>
        {onOpenProviderSettings && (
          <button type="button" onClick={onOpenProviderSettings}>
            provider-settings
          </button>
        )}
        {onConfigureEmptyState && (
          <button type="button" onClick={onConfigureEmptyState}>
            configure-empty-state
          </button>
        )}
      </>
    ),
  }
})

const makeModel = (overrides: Partial<Model> = {}): Model => ({
  provider: 'openai',
  icon_small: { en_US: '', zh_Hans: '' },
  label: { en_US: 'OpenAI', zh_Hans: 'OpenAI' },
  models: [makeModelItem()],
  status: ModelStatusEnum.active,
  ...overrides,
})

const makeProviderSummary = (): ModelProviderSummaryResponse => ({
  provider: 'openai',
  plugin_id: 'langgenius/openai',
  label: { en_US: 'OpenAI', zh_Hans: 'OpenAI' },
  supported_model_types: ['llm'],
  configurate_methods: ['predefined-model'],
  preferred_provider_type: 'system',
  is_configured: true,
  custom_configuration: {
    status: 'active',
    has_custom_models: false,
    available_credentials: [],
    current_credential_usable: false,
  },
  system_configuration: { enabled: true },
})

const renderWithQueryClient = (node: ReactNode) => {
  const queryClient = createConsoleQueryClient()
  queryClient.setQueryData(consoleQuery.workspaces.current.modelProviders.summary.get.key(), {
    data: [makeProviderSummary()],
    plugins: {},
  })
  return render(<QueryClientProvider client={queryClient}>{node}</QueryClientProvider>)
}

describe('ModelSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockModelProviders.current = [makeModel()]
  })

  it('should toggle popup and close it after selecting a model', () => {
    renderWithQueryClient(<ModelSelector models={[makeModel()]} />)

    const triggerButton = screen.getByRole('button', { name: 'plugin.detailPanel.configureModel' })

    fireEvent.click(triggerButton)
    expect(triggerButton).toHaveAttribute('aria-expanded', 'true')
    expect(
      screen.getByRole('dialog', { name: 'plugin.detailPanel.configureModel' }),
    ).toBeInTheDocument()
    expect(screen.getByText('select')).toBeInTheDocument()

    fireEvent.click(screen.getByText('select'))
    expect(triggerButton).toHaveAttribute('aria-expanded', 'false')
  })

  it('should call onValueChange when provided', () => {
    const onValueChange = vi.fn()
    renderWithQueryClient(<ModelSelector models={[makeModel()]} onValueChange={onValueChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'plugin.detailPanel.configureModel' }))
    fireEvent.click(screen.getByText('select'))

    expect(onValueChange).toHaveBeenCalledWith({
      provider: 'openai',
      model: 'gpt-4',
      plugin_id: 'langgenius/openai',
    })
  })

  it('should close popup when popup requests hide', () => {
    renderWithQueryClient(<ModelSelector models={[makeModel()]} />)

    const triggerButton = screen.getByRole('button', { name: 'plugin.detailPanel.configureModel' })
    fireEvent.click(triggerButton)
    expect(triggerButton).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('hide')).toBeInTheDocument()

    fireEvent.click(screen.getByText('hide'))
    expect(triggerButton).toHaveAttribute('aria-expanded', 'false')
  })

  it('should close popup before running the empty-state configure action', () => {
    const onConfigureEmptyState = vi.fn()
    renderWithQueryClient(
      <ModelSelector models={[makeModel()]} onConfigureEmptyState={onConfigureEmptyState} />,
    )

    const triggerButton = screen.getByRole('button', { name: 'plugin.detailPanel.configureModel' })
    fireEvent.click(triggerButton)
    expect(triggerButton).toHaveAttribute('aria-expanded', 'true')

    fireEvent.click(screen.getByText('configure-empty-state'))

    expect(triggerButton).toHaveAttribute('aria-expanded', 'false')
    expect(onConfigureEmptyState).toHaveBeenCalledTimes(1)
  })

  it('should close the popup before opening provider settings', async () => {
    const user = userEvent.setup()
    const onHide = vi.fn()
    renderWithQueryClient(<ModelSelector models={[makeModel()]} onHide={onHide} />)

    const triggerButton = screen.getByRole('button', { name: 'plugin.detailPanel.configureModel' })
    await user.click(triggerButton)
    await user.click(screen.getByRole('button', { name: 'provider-settings' }))

    expect(triggerButton).toHaveAttribute('aria-expanded', 'false')
    expect(onHide).toHaveBeenCalledTimes(1)
    expect(mockSetSettingsDestination).toHaveBeenCalledWith('provider')
  })

  it('should not open popup when disabled', () => {
    renderWithQueryClient(<ModelSelector models={[makeModel()]} disabled />)

    fireEvent.click(screen.getByRole('button', { name: 'plugin.detailPanel.configureModel' }))
    expect(screen.queryByText('select')).not.toBeInTheDocument()
  })

  it('should let the split trigger own the combobox interaction', () => {
    renderWithQueryClient(<SplitModelSelector models={[makeModel()]} />)

    const trigger = screen.getByRole('button', { name: 'plugin.detailPanel.configureModel' })
    expect(trigger).toHaveAttribute('data-shape', 'split')
  })

  it('should render deprecated trigger when value is not in list', () => {
    renderWithQueryClient(
      <ModelSelector
        value={{ provider: 'openai', model: 'missing-model' }}
        models={[makeModel()]}
      />,
    )

    expect(screen.getByText('missing-model')).toBeInTheDocument()
  })

  it('should render model trigger when value matches', () => {
    renderWithQueryClient(
      <ModelSelector value={{ provider: 'openai', model: 'gpt-4' }} models={[makeModel()]} />,
    )

    expect(screen.getByText('GPT-4')).toBeInTheDocument()
  })
})
