import type { ReactElement, ReactNode } from 'react'
import type { DefaultModel, Model, ModelItem } from '../../declarations'
import { Combobox } from '@langgenius/dify-ui/combobox'
import { createPreviewCardHandle } from '@langgenius/dify-ui/preview-card'
import { fireEvent, render, screen } from '@testing-library/react'
import {
  ConfigurationMethodEnum,
  CustomConfigurationStatusEnum,
  ModelFeatureEnum,
  ModelStatusEnum,
  ModelTypeEnum,
  PreferredProviderTypeEnum,
} from '../../declarations'
import PopupItem from '../popup-item'

const mockUpdateModelList = vi.hoisted(() => vi.fn())
const mockUpdateModelProviders = vi.hoisted(() => vi.fn())
const mockUseLanguage = vi.hoisted(() => vi.fn(() => 'en_US'))

vi.mock('../../hooks', async () => {
  const actual = await vi.importActual<typeof import('../../hooks')>('../../hooks')
  return {
    ...actual,
    useLanguage: mockUseLanguage,
    useUpdateModelList: () => mockUpdateModelList,
    useUpdateModelProviders: () => mockUpdateModelProviders,
  }
})

vi.mock('../../model-badge', () => ({
  default: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}))

vi.mock('../../model-icon', () => ({
  default: ({ modelName }: { modelName: string }) => <span>{modelName}</span>,
}))

vi.mock('../../model-name', () => ({
  default: ({ modelItem }: { modelItem: ModelItem }) => <span>{modelItem.label.en_US}</span>,
}))

vi.mock('../feature-icon', () => ({
  default: ({ feature }: { feature: string }) => <span data-testid="feature-icon">{feature}</span>,
}))

const mockCredentialPanelState = vi.hoisted(() => vi.fn())
vi.mock('../../provider-added-card/use-credential-panel-state', () => ({
  useCredentialPanelState: mockCredentialPanelState,
}))

vi.mock('../../provider-added-card/use-change-provider-priority', () => ({
  useChangeProviderPriority: () => ({
    isChangingPriority: false,
    handleChangePriority: vi.fn(),
  }),
}))

vi.mock('../../provider-added-card/model-auth-dropdown/dropdown-content', () => ({
  default: ({ onClose }: { onClose: () => void }) => <button type="button" onClick={onClose}>close dropdown</button>,
}))

const mockSetShowModelModal = vi.hoisted(() => vi.fn())
vi.mock('@/context/modal-context', () => ({
  useModalContext: () => ({
    setShowModelModal: mockSetShowModelModal,
  }),
}))

const mockUseProviderContext = vi.hoisted(() => vi.fn())
vi.mock('@/context/provider-context', () => ({
  useProviderContext: mockUseProviderContext,
}))

const mockUseAppContext = vi.hoisted(() => vi.fn())
vi.mock('@/context/app-context', () => ({
  useAppContext: mockUseAppContext,
}))

const makeModelItem = (overrides: Partial<ModelItem> = {}): ModelItem => ({
  model: 'gpt-4',
  label: { en_US: 'GPT-4', zh_Hans: 'GPT-4' },
  model_type: ModelTypeEnum.textGeneration,
  features: [ModelFeatureEnum.vision],
  fetch_from: ConfigurationMethodEnum.predefinedModel,
  status: ModelStatusEnum.active,
  model_properties: { mode: 'chat', context_size: 4096 },
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

const makeProvider = (overrides: Record<string, unknown> = {}) => ({
  provider: 'openai',
  preferred_provider_type: PreferredProviderTypeEnum.custom,
  custom_configuration: {
    status: CustomConfigurationStatusEnum.active,
    current_credential_name: 'my-api-key',
  },
  ...overrides,
})

const previewCardProps = () => ({
  previewCardHandle: createPreviewCardHandle(),
  onPreviewCardClose: vi.fn(),
})

const createComboboxNode = (
  node: ReactElement,
  onValueChange = vi.fn(),
) => (
  <Combobox filter={null} open onValueChange={onValueChange}>
    {node}
  </Combobox>
)

const renderWithCombobox = (
  node: ReactElement,
  onValueChange = vi.fn(),
) => {
  return render(
    createComboboxNode(node, onValueChange),
  )
}

describe('PopupItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseLanguage.mockReturnValue('en_US')
    mockUseProviderContext.mockReturnValue({
      modelProviders: [makeProvider()],
    })
    mockUseAppContext.mockReturnValue({
      currentWorkspace: { trial_credits: 200, trial_credits_used: 0 },
    })
    mockCredentialPanelState.mockReturnValue({
      variant: 'api-active',
      priority: 'apiKey',
      supportsCredits: false,
      showPrioritySwitcher: false,
      hasCredentials: true,
      isCreditsExhausted: false,
      credentialName: 'my-api-key',
      credits: 200,
    })
  })

  it('should render nothing when provider is not found in modelProviders', () => {
    mockUseProviderContext.mockReturnValue({
      modelProviders: [],
    })

    const { container } = renderWithCombobox(
      <PopupItem {...previewCardProps()} model={makeModel()} onHide={vi.fn()} />,
    )

    expect(container.textContent).toBe('')
  })

  it('should select the combobox value when clicking an active model', () => {
    const onValueChange = vi.fn()
    renderWithCombobox(<PopupItem {...previewCardProps()} model={makeModel()} onHide={vi.fn()} />, onValueChange)

    fireEvent.click(screen.getByText('GPT-4'))

    expect(onValueChange).toHaveBeenCalledWith(
      { provider: 'openai', model: 'gpt-4' },
      expect.objectContaining({ reason: 'item-press' }),
    )
  })

  it('should close the shared preview before pressing an active model', () => {
    const onPreviewCardClose = vi.fn()
    renderWithCombobox(
      <PopupItem
        previewCardHandle={createPreviewCardHandle()}
        onPreviewCardClose={onPreviewCardClose}
        model={makeModel()}
        onHide={vi.fn()}
      />,
    )

    fireEvent.pointerDown(screen.getByText('GPT-4'))

    expect(onPreviewCardClose).toHaveBeenCalledTimes(1)
  })

  it('should not select the combobox value when model is not active', () => {
    const onValueChange = vi.fn()
    renderWithCombobox(
      <PopupItem
        {...previewCardProps()}
        model={makeModel({ models: [makeModelItem({ status: ModelStatusEnum.disabled })] })}
        onHide={vi.fn()}
      />,
      onValueChange,
    )

    fireEvent.click(screen.getByText('GPT-4'))

    expect(onValueChange).not.toHaveBeenCalled()
  })

  it('should open model modal when clicking add on unconfigured model', () => {
    const onValueChange = vi.fn()
    const { rerender } = renderWithCombobox(
      <PopupItem {...previewCardProps()} model={makeModel({ models: [makeModelItem({ status: ModelStatusEnum.noConfigure })] })} onHide={vi.fn()} />,
      onValueChange,
    )

    fireEvent.click(screen.getByText('GPT-4'))
    fireEvent.click(screen.getByText('COMMON.OPERATION.ADD'))

    expect(onValueChange).not.toHaveBeenCalled()
    expect(mockSetShowModelModal).toHaveBeenCalled()

    const call = mockSetShowModelModal.mock.calls[0]![0] as { onSaveCallback?: () => void }
    call.onSaveCallback?.()

    expect(mockUpdateModelProviders).toHaveBeenCalled()
    expect(mockUpdateModelList).toHaveBeenCalledWith(ModelTypeEnum.textGeneration)

    rerender(createComboboxNode(
      <PopupItem
        {...previewCardProps()}
        model={makeModel({
          models: [makeModelItem({ status: ModelStatusEnum.noConfigure, model_type: undefined as unknown as ModelTypeEnum })],
        })}
        onHide={vi.fn()}
      />,
    ))

    fireEvent.click(screen.getByText('COMMON.OPERATION.ADD'))
    const call2 = mockSetShowModelModal.mock.calls.at(-1)?.[0] as { onSaveCallback?: () => void } | undefined
    call2?.onSaveCallback?.()

    expect(mockUpdateModelProviders).toHaveBeenCalled()
    expect(mockUpdateModelList).toHaveBeenCalledTimes(1)
  })

  it('should show selected state when defaultModel matches', () => {
    const defaultModel: DefaultModel = { provider: 'openai', model: 'gpt-4' }
    renderWithCombobox(
      <PopupItem
        {...previewCardProps()}
        defaultModel={defaultModel}
        model={makeModel()}
        onHide={vi.fn()}
      />,
    )

    expect(screen.getByText('GPT-4'))!.toBeInTheDocument()
  })

  it('should fall back to english labels when the current language is unavailable', () => {
    mockUseLanguage.mockReturnValue('zh_Hans')

    renderWithCombobox(
      <PopupItem
        {...previewCardProps()}
        model={makeModel({
          label: { en_US: 'OpenAI only' } as Model['label'],
          models: [makeModelItem({ label: { en_US: 'GPT-4 only' } as ModelItem['label'] })],
        })}
        onHide={vi.fn()}
      />,
    )

    expect(screen.getByText('OpenAI only'))!.toBeInTheDocument()
    expect(screen.getByText('GPT-4 only'))!.toBeInTheDocument()
  })

  it('should toggle collapsed state when clicking provider header', () => {
    renderWithCombobox(<PopupItem {...previewCardProps()} model={makeModel()} onHide={vi.fn()} />)

    expect(screen.getByText('GPT-4'))!.toBeInTheDocument()

    fireEvent.click(screen.getByText('OpenAI'))

    expect(screen.queryByText('GPT-4')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('OpenAI'))

    expect(screen.getByText('GPT-4'))!.toBeInTheDocument()
  })

  it('should show credential name when using custom provider', () => {
    renderWithCombobox(<PopupItem {...previewCardProps()} model={makeModel()} onHide={vi.fn()} />)

    expect(screen.getByText('my-api-key'))!.toBeInTheDocument()
  })

  it('should render the inactive credential badge when the api key is not active', () => {
    mockCredentialPanelState.mockReturnValue({
      variant: 'api-inactive',
      priority: 'apiKey',
      supportsCredits: false,
      showPrioritySwitcher: false,
      hasCredentials: true,
      isCreditsExhausted: false,
      credentialName: 'stale-key',
      credits: 200,
    })

    renderWithCombobox(<PopupItem {...previewCardProps()} model={makeModel()} onHide={vi.fn()} />)

    expect(screen.getByText('stale-key'))!.toBeInTheDocument()
    expect(document.querySelector('.bg-components-badge-status-light-error-bg')).not.toBeNull()
  })

  it('should show configure required when no credential name', () => {
    mockUseProviderContext.mockReturnValue({
      modelProviders: [makeProvider({
        custom_configuration: {
          status: CustomConfigurationStatusEnum.noConfigure,
          current_credential_name: '',
        },
      })],
    })
    mockCredentialPanelState.mockReturnValue({
      variant: 'api-required-configure',
      priority: 'apiKey',
      supportsCredits: false,
      showPrioritySwitcher: false,
      hasCredentials: false,
      isCreditsExhausted: false,
      credentialName: undefined,
      credits: 0,
    })

    renderWithCombobox(<PopupItem {...previewCardProps()} model={makeModel()} onHide={vi.fn()} />)

    expect(screen.getByText(/modelProvider\.selector\.configureRequired/))!.toBeInTheDocument()
  })

  it('should show credits info when using system provider with remaining credits', () => {
    mockUseProviderContext.mockReturnValue({
      modelProviders: [makeProvider({
        preferred_provider_type: PreferredProviderTypeEnum.system,
      })],
    })
    mockCredentialPanelState.mockReturnValue({
      variant: 'credits-active',
      priority: 'credits',
      supportsCredits: true,
      showPrioritySwitcher: true,
      hasCredentials: false,
      isCreditsExhausted: false,
      credentialName: undefined,
      credits: 200,
    })

    renderWithCombobox(<PopupItem {...previewCardProps()} model={makeModel()} onHide={vi.fn()} />)

    expect(screen.getByText(/modelProvider\.selector\.aiCredits/))!.toBeInTheDocument()
  })

  it('should show credits exhausted when system provider has no credits', () => {
    mockUseProviderContext.mockReturnValue({
      modelProviders: [makeProvider({
        preferred_provider_type: PreferredProviderTypeEnum.system,
      })],
    })
    mockUseAppContext.mockReturnValue({
      currentWorkspace: { trial_credits: 100, trial_credits_used: 100 },
    })
    mockCredentialPanelState.mockReturnValue({
      variant: 'credits-exhausted',
      priority: 'credits',
      supportsCredits: true,
      showPrioritySwitcher: true,
      hasCredentials: false,
      isCreditsExhausted: true,
      credentialName: undefined,
      credits: 0,
    })

    renderWithCombobox(<PopupItem {...previewCardProps()} model={makeModel()} onHide={vi.fn()} />)

    expect(screen.getByText(/modelProvider\.selector\.creditsExhausted/))!.toBeInTheDocument()
  })

  it('should close the dropdown through dropdown content callbacks', () => {
    const onHide = vi.fn()

    renderWithCombobox(<PopupItem {...previewCardProps()} model={makeModel()} onHide={onHide} />)

    fireEvent.click(screen.getByRole('button', { name: /my-api-key/ }))
    fireEvent.click(screen.getByRole('button', { name: 'close dropdown' }))

    expect(onHide).toHaveBeenCalled()
  })
})
