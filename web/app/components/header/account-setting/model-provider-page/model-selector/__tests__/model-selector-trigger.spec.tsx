import type { ReactNode } from 'react'
import type { Model, ModelItem } from '../../declarations'
import { Popover } from '@langgenius/dify-ui/popover'
import { render as renderComponent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  ConfigurationMethodEnum,
  ModelFeatureEnum,
  ModelStatusEnum,
  ModelTypeEnum,
} from '../../declarations'
import { ModelSelectorTrigger } from '../model-selector-trigger'

const render = (node: ReactNode) => renderComponent(<Popover>{node}</Popover>)
const getTrigger = () => screen.getByRole('button', { name: 'plugin.detailPanel.configureModel' })

const mockUseQuery = vi.hoisted(() => vi.fn())
const mockUseCredentialPanelState = vi.hoisted(() => vi.fn())
vi.mock('@tanstack/react-query', () => ({
  useQuery: mockUseQuery,
}))
vi.mock('../../provider-added-card/use-credential-panel-state', () => ({
  useCredentialPanelState: mockUseCredentialPanelState,
}))

const createModelItem = (overrides: Partial<ModelItem> = {}): ModelItem => ({
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

const createModel = (overrides: Partial<Model> = {}): Model => ({
  provider: 'openai',
  icon_small: {
    en_US: 'https://example.com/openai-light.png',
    zh_Hans: 'https://example.com/openai-light.png',
  },
  icon_small_dark: {
    en_US: 'https://example.com/openai-dark.png',
    zh_Hans: 'https://example.com/openai-dark.png',
  },
  label: { en_US: 'OpenAI', zh_Hans: 'OpenAI' },
  models: [createModelItem()],
  status: ModelStatusEnum.active,
  ...overrides,
})

describe('ModelSelectorTrigger', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseQuery.mockReturnValue({ data: createModel() })
    mockUseCredentialPanelState.mockReturnValue({
      variant: 'credits-active',
      priority: 'credits',
      supportsCredits: true,
      showPrioritySwitcher: true,
      hasCredentials: false,
      isCreditsExhausted: false,
      credentialName: undefined,
      credits: 100,
    })
  })

  describe('Rendering', () => {
    it('should render empty state when no model is selected', () => {
      render(<ModelSelectorTrigger />)

      expect(screen.getByText('plugin.detailPanel.configureModel')).toBeInTheDocument()
      expect(getTrigger()).toBeEnabled()
    })

    it('should render selected model details when model is active', () => {
      const currentProvider = createModel()
      const currentModel = createModelItem()
      render(<ModelSelectorTrigger currentProvider={currentProvider} currentModel={currentModel} />)

      expect(screen.getByText('GPT-4')).toBeInTheDocument()
      expect(screen.getByText('CHAT')).toBeInTheDocument()
      expect(getTrigger()).toBeEnabled()
    })

    it('should render deprecated default model and disabled style when selection is missing', () => {
      render(<ModelSelectorTrigger defaultModel={{ provider: 'openai', model: 'legacy-model' }} />)

      expect(screen.getByText('legacy-model')).toBeInTheDocument()
      expect(screen.getByText('common.modelProvider.selector.incompatible')).toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should disable the combobox trigger', () => {
      render(
        <ModelSelectorTrigger
          currentProvider={createModel()}
          currentModel={createModelItem()}
          disabled
        />,
      )

      expect(getTrigger()).toBeDisabled()
    })
  })

  describe('Status Handling', () => {
    it('should show status badge when selected model is not active and enabled', () => {
      render(
        <ModelSelectorTrigger
          currentProvider={createModel()}
          currentModel={createModelItem({ status: ModelStatusEnum.noConfigure })}
        />,
      )

      expect(
        screen.getByText('common.modelProvider.selector.configureRequired'),
      ).toBeInTheDocument()
      expect(getTrigger()).toHaveAttribute('data-model-status', 'configure-required')
      expect(getTrigger()).toHaveClass(
        'data-[model-status=configure-required]:bg-components-input-bg-disabled',
      )
    })

    it('should show credits exhausted state when model quota is exceeded', () => {
      mockUseCredentialPanelState.mockReturnValue({
        variant: 'credits-exhausted',
        priority: 'credits',
        supportsCredits: true,
        showPrioritySwitcher: true,
        hasCredentials: false,
        isCreditsExhausted: true,
        credentialName: undefined,
        credits: 0,
      })

      render(
        <ModelSelectorTrigger currentProvider={createModel()} currentModel={createModelItem()} />,
      )

      expect(screen.getByText('common.modelProvider.selector.creditsExhausted')).toBeInTheDocument()
      expect(screen.queryByText('CHAT')).not.toBeInTheDocument()
    })

    it('should hide model meta when api key is unavailable', () => {
      mockUseCredentialPanelState.mockReturnValue({
        variant: 'api-unavailable',
        priority: 'apiKey',
        supportsCredits: true,
        showPrioritySwitcher: true,
        hasCredentials: true,
        isCreditsExhausted: false,
        credentialName: 'Primary Key',
        credits: 0,
      })

      render(
        <ModelSelectorTrigger currentProvider={createModel()} currentModel={createModelItem()} />,
      )

      expect(
        screen.getByText('common.modelProvider.selector.apiKeyUnavailable'),
      ).toBeInTheDocument()
      expect(screen.queryByText('CHAT')).not.toBeInTheDocument()
      expect(getTrigger()).toHaveClass(
        'data-[model-status=api-key-unavailable]:bg-components-input-bg-disabled',
      )
    })

    it('should show disabled badge when selected model is disabled', () => {
      render(
        <ModelSelectorTrigger
          currentProvider={createModel()}
          currentModel={createModelItem({ status: ModelStatusEnum.disabled })}
        />,
      )

      expect(screen.getByText('common.modelProvider.selector.disabled')).toBeInTheDocument()
      expect(screen.queryByText('CHAT')).not.toBeInTheDocument()
    })

    it('should not show status badge when selected model is disabled', () => {
      render(
        <ModelSelectorTrigger
          currentProvider={createModel()}
          currentModel={createModelItem({ status: ModelStatusEnum.noConfigure })}
          disabled
        />,
      )

      expect(
        screen.queryByText('common.modelProvider.selector.configureRequired'),
      ).not.toBeInTheDocument()
    })

    it('should show incompatible tooltip when hovering no-permission status badge', async () => {
      const user = userEvent.setup()
      render(
        <ModelSelectorTrigger
          currentProvider={createModel()}
          currentModel={createModelItem({ status: ModelStatusEnum.noPermission })}
        />,
      )

      expect(screen.queryByText('CHAT')).not.toBeInTheDocument()
      expect(getTrigger()).toHaveClass(
        'data-[model-status=incompatible]:bg-components-input-bg-disabled',
      )
      await user.hover(screen.getByText('common.modelProvider.selector.incompatible'))

      expect(
        await screen.findByText('common.modelProvider.selector.incompatibleTip'),
      ).toBeInTheDocument()
    })

    it('should show incompatible badge when selected model fails the compatibility predicate', () => {
      render(
        <ModelSelectorTrigger
          currentProvider={createModel()}
          currentModel={createModelItem()}
          isModelCompatible={false}
        />,
      )

      expect(screen.getByText('common.modelProvider.selector.incompatible')).toBeInTheDocument()
      expect(screen.queryByText('CHAT')).not.toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should show incompatible badge for deprecated selection', async () => {
      const user = userEvent.setup()
      render(<ModelSelectorTrigger defaultModel={{ provider: 'openai', model: 'legacy-model' }} />)

      expect(screen.getByText('common.modelProvider.selector.incompatible')).toBeInTheDocument()
      await user.hover(screen.getByText('common.modelProvider.selector.incompatible'))

      expect(
        await screen.findByText('common.modelProvider.selector.incompatibleTip'),
      ).toBeInTheDocument()
    })

    it('should show credits exhausted badge for deprecated selection when ai credits are exhausted without api key', async () => {
      const user = userEvent.setup()
      mockUseCredentialPanelState.mockImplementation((provider) => ({
        variant: provider ? 'no-usage' : 'credits-active',
        priority: provider ? 'apiKey' : 'credits',
        supportsCredits: !!provider,
        showPrioritySwitcher: true,
        hasCredentials: false,
        isCreditsExhausted: !!provider,
        credentialName: undefined,
        credits: provider ? 0 : 100,
      }))

      render(<ModelSelectorTrigger defaultModel={{ provider: 'openai', model: 'legacy-model' }} />)

      expect(mockUseCredentialPanelState).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'openai' }),
      )
      expect(screen.getByText('common.modelProvider.selector.creditsExhausted')).toBeInTheDocument()
      await user.hover(screen.getByText('common.modelProvider.selector.creditsExhausted'))

      expect(
        await screen.findByText('common.modelProvider.selector.creditsExhaustedTip'),
      ).toBeInTheDocument()
    })
  })
})
