import type { ComponentProps } from 'react'
import { render, screen } from '@testing-library/react'
import Trigger from '../trigger'

const mockUseCredentialPanelState = vi.fn()

vi.mock('../../hooks', () => ({
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

vi.mock('../../provider-added-card/use-credential-panel-state', () => ({
  useCredentialPanelState: () => mockUseCredentialPanelState(),
}))

vi.mock('../../model-icon', () => ({
  default: () => <div data-testid="model-icon">Icon</div>,
}))

vi.mock('../../model-name', () => ({
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

const activeCredentialState = {
  variant: 'api-active' as const,
  supportsCredits: true,
  isCreditsExhausted: false,
  priority: 'apiKey' as const,
  showPrioritySwitcher: true,
  hasCredentials: true,
  credentialName: 'Primary Key',
  credits: 10,
}

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
    mockUseCredentialPanelState.mockReturnValue(activeCredentialState)
  })

  describe('Rendering', () => {
    it('should render active state with model features in non-workflow mode', () => {
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

    it('should render split layout with workflow styles when workflow mode is enabled', () => {
      const { container } = render(
        <Trigger
          currentProvider={currentProvider}
          currentModel={currentModel}
          isInWorkflow
          providerName="openai"
          modelId="gpt-4"
        />,
      )

      const leftPanel = container.querySelector('.rounded-l-lg')
      expect(leftPanel).toBeInTheDocument()
      expect(leftPanel).toHaveClass('border-workflow-block-parma-bg')
      const rightPanel = container.querySelector('.rounded-r-lg')
      expect(rightPanel).toBeInTheDocument()
      expect(rightPanel).toHaveClass('border-workflow-block-parma-bg')
    })

    it('should render empty state when no provider or model is selected', () => {
      render(<Trigger isInWorkflow />)

      expect(screen.getByText('workflow:errorMsg.configureModel')).toBeInTheDocument()
    })

    it('should render non-workflow empty state with warning border', () => {
      const { container } = render(<Trigger />)

      expect(screen.getByText('workflow:errorMsg.configureModel')).toBeInTheDocument()
      expect(container.firstChild).toHaveClass('border-text-warning')
    })
  })

  describe('Status badges', () => {
    it('should render credits exhausted badge in non-workflow mode', () => {
      mockUseCredentialPanelState.mockReturnValue({
        ...activeCredentialState,
        variant: 'credits-exhausted',
        isCreditsExhausted: true,
        priority: 'credits',
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
      expect(screen.queryByTestId('model-name-mode')).not.toBeInTheDocument()
      expect(screen.queryByTestId('model-name-features')).not.toBeInTheDocument()
    })

    it('should render api unavailable badge in non-workflow mode', () => {
      mockUseCredentialPanelState.mockReturnValue({
        ...activeCredentialState,
        variant: 'api-unavailable',
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
        ...activeCredentialState,
        variant: 'credits-exhausted',
        isCreditsExhausted: true,
        priority: 'credits',
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
        ...activeCredentialState,
        variant: 'api-unavailable',
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

    it('should render incompatible badge when model is deprecated (currentModel missing)', () => {
      render(
        <Trigger
          currentProvider={currentProvider}
          providerName="openai"
          modelId="gpt-4"
        />,
      )

      expect(screen.getByText('common.modelProvider.selector.incompatible')).toBeInTheDocument()
    })

    it('should render credits exhausted badge when model is missing and AI credits are exhausted without api key', () => {
      mockUseCredentialPanelState.mockReturnValue({
        ...activeCredentialState,
        variant: 'no-usage',
        priority: 'apiKey',
        hasCredentials: false,
        isCreditsExhausted: true,
        credentialName: undefined,
      })

      render(
        <Trigger
          currentProvider={currentProvider}
          providerName="openai"
          modelId="gpt-4"
        />,
      )

      expect(screen.getByText('common.modelProvider.selector.creditsExhausted')).toBeInTheDocument()
    })

    it('should render configure required badge when model status is no-configure', () => {
      render(
        <Trigger
          currentProvider={currentProvider}
          currentModel={{ ...currentModel, status: 'no-configure' } as typeof currentModel}
          providerName="openai"
          modelId="gpt-4"
        />,
      )

      expect(screen.getByText('common.modelProvider.selector.configureRequired')).toBeInTheDocument()
    })

    it('should render disabled badge when model status is disabled', () => {
      render(
        <Trigger
          currentProvider={currentProvider}
          currentModel={{ ...currentModel, status: 'disabled' } as typeof currentModel}
          providerName="openai"
          modelId="gpt-4"
        />,
      )

      expect(screen.getByText('common.modelProvider.selector.disabled')).toBeInTheDocument()
    })

    it('should render incompatible badge when provider plugin is not installed', () => {
      render(
        <Trigger
          modelId="gpt-4"
          providerName="unknown-provider"
        />,
      )

      expect(screen.getByText('common.modelProvider.selector.incompatible')).toBeInTheDocument()
    })
  })

  describe('Split layout', () => {
    it('should use split layout with settings button in non-workflow mode', () => {
      const { container } = render(
        <Trigger
          currentProvider={currentProvider}
          currentModel={currentModel}
          providerName="openai"
          modelId="gpt-4"
        />,
      )

      const splitContainer = container.querySelector('.rounded-l-lg')
      expect(splitContainer).toBeInTheDocument()
      const settingsButton = container.querySelector('.rounded-r-lg')
      expect(settingsButton).toBeInTheDocument()
    })

    it('should use split layout for error states in non-workflow mode', () => {
      mockUseCredentialPanelState.mockReturnValue({
        ...activeCredentialState,
        variant: 'api-unavailable',
      })

      const { container } = render(
        <Trigger
          currentProvider={currentProvider}
          currentModel={currentModel}
          providerName="openai"
          modelId="gpt-4"
        />,
      )

      const splitContainer = container.querySelector('.rounded-l-lg')
      expect(splitContainer).toBeInTheDocument()
    })
  })
})
