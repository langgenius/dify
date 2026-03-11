import type { ComponentProps } from 'react'
import { render, screen } from '@testing-library/react'
import Trigger from './trigger'

const mockUseCredentialPanelState = vi.fn()

vi.mock('../hooks', () => ({
  useLanguage: () => 'en_US',
}))

vi.mock('@/context/provider-context', () => ({
  useProviderContext: () => ({
    modelProviders: [{
      provider: 'openai',
      label: { en_US: 'OpenAI', zh_Hans: 'OpenAI' },
    }],
  }),
}))

vi.mock('../provider-added-card/use-credential-panel-state', () => ({
  useCredentialPanelState: () => mockUseCredentialPanelState(),
}))

vi.mock('../model-icon', () => ({
  default: () => <div data-testid="model-icon">Icon</div>,
}))

vi.mock('../model-name', () => ({
  default: ({
    modelItem,
    showMode,
    showFeatures,
  }: {
    modelItem: { model: string }
    showMode?: boolean
    showFeatures?: boolean
  }) => (
    <div>
      <span>{modelItem.model}</span>
      {showMode && <span data-testid="model-name-mode">mode</span>}
      {showFeatures && <span data-testid="model-name-features">features</span>}
    </div>
  ),
}))

describe('Trigger', () => {
  const currentProvider = {
    provider: 'openai',
    label: { en_US: 'OpenAI', zh_Hans: 'OpenAI' },
  } as unknown as ComponentProps<typeof Trigger>['currentProvider']

  const currentModel = {
    model: 'gpt-4',
    status: 'active',
  } as unknown as ComponentProps<typeof Trigger>['currentModel']

  beforeEach(() => {
    vi.clearAllMocks()
    mockUseCredentialPanelState.mockReturnValue({
      variant: 'api-active',
      supportsCredits: true,
      isCreditsExhausted: false,
      priority: 'apiKey',
      showPrioritySwitcher: true,
      hasCredentials: true,
      credentialName: 'Primary Key',
      credits: 10,
    })
  })

  describe('Rendering', () => {
    it('should render initialized state when provider and model are available', () => {
      render(
        <Trigger
          currentProvider={currentProvider}
          currentModel={currentModel}
          providerName="openai"
          modelId="gpt-4"
        />,
      )

      expect(screen.getByText('gpt-4')).toBeInTheDocument()
      expect(screen.getByTestId('model-icon')).toBeInTheDocument()
      expect(screen.getByTestId('model-name-mode')).toBeInTheDocument()
      expect(screen.getByTestId('model-name-features')).toBeInTheDocument()
    })

    it('should render fallback model id when current model is missing', () => {
      render(
        <Trigger
          modelId="gpt-4"
          providerName="openai"
        />,
      )

      expect(screen.getByText('gpt-4')).toBeInTheDocument()
    })

    it('should render workflow styles when workflow mode is enabled', () => {
      const { container } = render(
        <Trigger
          currentProvider={currentProvider}
          currentModel={currentModel}
          isInWorkflow
          providerName="openai"
          modelId="gpt-4"
        />,
      )

      expect(container.firstChild).toHaveClass('border-workflow-block-parma-bg')
      expect(container.firstChild).toHaveClass('bg-workflow-block-parma-bg')
    })

    it('should render workflow empty state when no provider or model is selected', () => {
      const { container } = render(<Trigger isInWorkflow />)

      expect(screen.getByText('workflow:errorMsg.configureModel')).toBeInTheDocument()
      expect(container.firstChild).toHaveClass('border-text-warning')
      expect(container.firstChild).toHaveClass('bg-state-warning-hover')
    })
  })

  describe('Status badges', () => {
    it('should render credits exhausted split layout in non-workflow mode', () => {
      mockUseCredentialPanelState.mockReturnValue({
        variant: 'credits-exhausted',
        supportsCredits: true,
        isCreditsExhausted: true,
        priority: 'credits',
        showPrioritySwitcher: true,
        hasCredentials: false,
        credentialName: undefined,
        credits: 0,
      })

      render(
        <Trigger
          currentProvider={currentProvider}
          currentModel={currentModel}
          providerName="openai"
          modelId="gpt-4"
        />,
      )

      expect(screen.getByText('common.modelProvider.selector.creditsExhausted')).toBeInTheDocument()
      expect(screen.getByTestId('model-icon')).toBeInTheDocument()
      expect(screen.queryByTestId('model-name-mode')).not.toBeInTheDocument()
      expect(screen.queryByTestId('model-name-features')).not.toBeInTheDocument()
    })

    it('should resolve provider from context when currentProvider is missing in split layout', () => {
      mockUseCredentialPanelState.mockReturnValue({
        variant: 'credits-exhausted',
        supportsCredits: true,
        isCreditsExhausted: true,
        priority: 'credits',
        showPrioritySwitcher: true,
        hasCredentials: false,
        credentialName: undefined,
        credits: 0,
      })

      render(
        <Trigger
          currentModel={currentModel}
          providerName="openai"
          modelId="gpt-4"
        />,
      )

      expect(screen.getByText('common.modelProvider.selector.creditsExhausted')).toBeInTheDocument()
      expect(screen.getByTestId('model-icon')).toBeInTheDocument()
    })

    it('should render api unavailable split layout in non-workflow mode', () => {
      mockUseCredentialPanelState.mockReturnValue({
        variant: 'api-unavailable',
        supportsCredits: true,
        isCreditsExhausted: false,
        priority: 'apiKey',
        showPrioritySwitcher: true,
        hasCredentials: true,
        credentialName: 'Primary Key',
        credits: 0,
      })

      render(
        <Trigger
          currentProvider={currentProvider}
          currentModel={currentModel}
          providerName="openai"
          modelId="gpt-4"
        />,
      )

      expect(screen.getByText('common.modelProvider.selector.apiKeyUnavailable')).toBeInTheDocument()
    })

    it('should render credits exhausted badge in workflow mode', () => {
      mockUseCredentialPanelState.mockReturnValue({
        variant: 'credits-exhausted',
        supportsCredits: true,
        isCreditsExhausted: true,
        priority: 'credits',
        showPrioritySwitcher: true,
        hasCredentials: false,
        credentialName: undefined,
        credits: 0,
      })

      render(
        <Trigger
          currentProvider={currentProvider}
          currentModel={currentModel}
          providerName="openai"
          modelId="gpt-4"
          isInWorkflow
        />,
      )

      expect(screen.getByText('common.modelProvider.selector.creditsExhausted')).toBeInTheDocument()
    })

    it('should render api unavailable badge in workflow mode', () => {
      mockUseCredentialPanelState.mockReturnValue({
        variant: 'api-unavailable',
        supportsCredits: true,
        isCreditsExhausted: false,
        priority: 'apiKey',
        showPrioritySwitcher: true,
        hasCredentials: true,
        credentialName: 'Primary Key',
        credits: 0,
      })

      render(
        <Trigger
          currentProvider={currentProvider}
          currentModel={currentModel}
          providerName="openai"
          modelId="gpt-4"
          isInWorkflow
        />,
      )

      expect(screen.getByText('common.modelProvider.selector.apiKeyUnavailable')).toBeInTheDocument()
    })

    it('should render incompatible badge when deprecated model is disabled', () => {
      render(
        <Trigger
          currentProvider={currentProvider}
          currentModel={currentModel}
          disabled
          hasDeprecated
          providerName="openai"
          modelId="gpt-4"
        />,
      )

      expect(screen.getByText('common.modelProvider.selector.incompatible')).toBeInTheDocument()
      expect(screen.queryByTestId('model-name-mode')).not.toBeInTheDocument()
      expect(screen.queryByTestId('model-name-features')).not.toBeInTheDocument()
    })

    it('should render incompatible badge when model status is disabled but not deprecated', () => {
      render(
        <Trigger
          currentProvider={currentProvider}
          currentModel={{ ...currentModel, status: 'no-configure' } as typeof currentModel}
          disabled
          modelDisabled
          providerName="openai"
          modelId="gpt-4"
        />,
      )

      expect(screen.getByText('common.modelProvider.selector.incompatible')).toBeInTheDocument()
    })
  })

  describe('Edge cases', () => {
    it('should render without crashing when providerName does not match any provider', () => {
      render(
        <Trigger
          modelId="gpt-4"
          providerName="unknown-provider"
        />,
      )

      expect(screen.getByText('gpt-4')).toBeInTheDocument()
    })
  })
})
