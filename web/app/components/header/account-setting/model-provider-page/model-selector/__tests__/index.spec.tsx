import type { ReactNode } from 'react'
import type { Model, ModelItem } from '../../declarations'
import { QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createConsoleQueryClient } from '@/test/console/query-data'
import { ConfigurationMethodEnum, ModelStatusEnum, ModelTypeEnum } from '../../declarations'
import { ModelSelector, SplitModelSelector } from '../index'

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

vi.mock('../popup', async () => {
  const { ComboboxItem } = await vi.importActual<typeof import('@langgenius/dify-ui/combobox')>(
    '@langgenius/dify-ui/combobox',
  )

  return {
    default: ({
      onConfigureEmptyState,
      onHide,
      onOpenProviderSettings,
    }: {
      onConfigureEmptyState?: () => void
      onHide: () => void
      onOpenProviderSettings?: () => void
    }) => (
      <>
        <ComboboxItem value={{ provider: 'openai', model: 'gpt-4' }}>select</ComboboxItem>
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

const makeModel = (overrides: Partial<Model> = {}): Model => ({
  provider: 'openai',
  icon_small: { en_US: '', zh_Hans: '' },
  label: { en_US: 'OpenAI', zh_Hans: 'OpenAI' },
  models: [makeModelItem()],
  status: ModelStatusEnum.active,
  ...overrides,
})

const renderWithQueryClient = (node: ReactNode) => {
  const queryClient = createConsoleQueryClient()
  return render(<QueryClientProvider client={queryClient}>{node}</QueryClientProvider>)
}

describe('ModelSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockModelProviders.current = [makeModel()]
  })

  it('uses the visible field label as its accessible name', () => {
    renderWithQueryClient(
      <>
        <span id="reasoning-model-label">System reasoning model</span>
        <ModelSelector ariaLabelledBy="reasoning-model-label" models={[makeModel()]} />
      </>,
    )

    expect(screen.getByRole('combobox', { name: 'System reasoning model' })).toBeInTheDocument()
  })

  it('exposes required and invalid field guidance on the combobox trigger', () => {
    renderWithQueryClient(
      <>
        <span id="embedding-model-label">Embedding model</span>
        <span id="embedding-model-error">Select an embedding model.</span>
        <ModelSelector
          ariaDescribedBy="embedding-model-error"
          ariaInvalid
          ariaLabelledBy="embedding-model-label"
          ariaRequired
          models={[makeModel()]}
        />
      </>,
    )

    const trigger = screen.getByRole('combobox', { name: 'Embedding model' })
    expect(trigger).toHaveAccessibleDescription('Select an embedding model.')
    expect(trigger).toHaveAttribute('aria-invalid', 'true')
    expect(trigger).toHaveAttribute('aria-required', 'true')
  })

  it('should toggle popup and close it after selecting a model', () => {
    renderWithQueryClient(<ModelSelector models={[makeModel()]} />)

    const triggerButton = screen.getByRole('combobox')

    fireEvent.click(triggerButton)
    expect(triggerButton).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('select')).toBeInTheDocument()

    fireEvent.click(screen.getByText('select'))
    expect(triggerButton).toHaveAttribute('aria-expanded', 'false')
  })

  it('should call onValueChange when provided', () => {
    const onValueChange = vi.fn()
    renderWithQueryClient(<ModelSelector models={[makeModel()]} onValueChange={onValueChange} />)

    fireEvent.click(screen.getByRole('combobox'))
    fireEvent.click(screen.getByText('select'))

    expect(onValueChange).toHaveBeenCalledWith({
      provider: 'openai',
      model: 'gpt-4',
      plugin_id: 'langgenius/openai',
    })
  })

  it('should close popup when popup requests hide', () => {
    renderWithQueryClient(<ModelSelector models={[makeModel()]} />)

    const triggerButton = screen.getByRole('combobox')
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

    const triggerButton = screen.getByRole('combobox')
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

    const triggerButton = screen.getByRole('combobox')
    await user.click(triggerButton)
    await user.click(screen.getByRole('button', { name: 'provider-settings' }))

    expect(triggerButton).toHaveAttribute('aria-expanded', 'false')
    expect(onHide).toHaveBeenCalledTimes(1)
    expect(mockSetSettingsDestination).toHaveBeenCalledWith('provider')
  })

  it('should not open popup when disabled', () => {
    renderWithQueryClient(<ModelSelector models={[makeModel()]} disabled />)

    fireEvent.click(screen.getByRole('combobox'))
    expect(screen.queryByText('select')).not.toBeInTheDocument()
  })

  it('should let the split trigger own the combobox interaction', () => {
    renderWithQueryClient(<SplitModelSelector models={[makeModel()]} />)

    const trigger = screen.getByRole('combobox')
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
