import type { ComponentProps } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Trigger from '../trigger'

vi.mock('../../hooks', () => ({
  useLanguage: () => 'en_US',
}))

vi.mock('@/context/provider-context', () => ({
  useProviderContext: () => ({
    modelProviders: [{ provider: 'openai', label: { en_US: 'OpenAI' } }],
  }),
}))

vi.mock('../../model-icon', () => ({
  default: () => <div data-testid="model-icon">Icon</div>,
}))

vi.mock('../../model-name', () => ({
  default: ({ modelItem }: { modelItem: { model: string } }) => <div>{modelItem.model}</div>,
}))

describe('Trigger', () => {
  const currentProvider = { provider: 'openai', label: { en_US: 'OpenAI' } } as unknown as ComponentProps<typeof Trigger>['currentProvider']
  const currentModel = { model: 'gpt-4' } as unknown as ComponentProps<typeof Trigger>['currentModel']

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render initialized state', () => {
    render(
      <Trigger
        currentProvider={currentProvider}
        currentModel={currentModel}
      />,
    )
    expect(screen.getByText('gpt-4')).toBeInTheDocument()
    expect(screen.getByTestId('model-icon')).toBeInTheDocument()
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

  // isInWorkflow=true: workflow border class + RiArrowDownSLine arrow
  it('should render workflow styles when isInWorkflow is true', () => {
    // Act
    const { container } = render(
      <Trigger
        currentProvider={currentProvider}
        currentModel={currentModel}
        isInWorkflow
      />,
    )

    // Assert
    expect(container.firstChild).toHaveClass('border-workflow-block-parma-bg')
    expect(container.firstChild).toHaveClass('bg-workflow-block-parma-bg')
    expect(container.querySelectorAll('svg').length).toBe(2)
  })

  // disabled=true + hasDeprecated=true: AlertTriangle + deprecated tooltip
  it('should show deprecated warning when disabled with hasDeprecated', () => {
    // Act
    render(
      <Trigger
        currentProvider={currentProvider}
        currentModel={currentModel}
        disabled
        hasDeprecated
      />,
    )

    // Assert - AlertTriangle renders with warning color
    const warningIcon = document.querySelector('.text-\\[\\#F79009\\]')
    expect(warningIcon).toBeInTheDocument()
  })

  // disabled=true + modelDisabled=true: status text tooltip
  it('should show model status tooltip when disabled with modelDisabled', () => {
    // Act
    render(
      <Trigger
        currentProvider={currentProvider}
        currentModel={{ ...currentModel, status: 'no-configure' } as unknown as typeof currentModel}
        disabled
        modelDisabled
      />,
    )

    // Assert - AlertTriangle warning icon should be present
    const warningIcon = document.querySelector('.text-\\[\\#F79009\\]')
    expect(warningIcon).toBeInTheDocument()
  })

  it('should render empty tooltip content when disabled without deprecated or modelDisabled', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <Trigger
        currentProvider={currentProvider}
        currentModel={currentModel}
        disabled
        hasDeprecated={false}
        modelDisabled={false}
      />,
    )
    const warningIcon = document.querySelector('.text-\\[\\#F79009\\]')
    expect(warningIcon).toBeInTheDocument()
    const trigger = container.querySelector('[data-state]')
    expect(trigger).toBeInTheDocument()
    await user.hover(trigger as HTMLElement)
    const tooltip = screen.queryByRole('tooltip')
    if (tooltip)
      expect(tooltip).toBeEmptyDOMElement()
    expect(screen.queryByText('modelProvider.deprecated')).not.toBeInTheDocument()
    expect(screen.queryByText('No Configure')).not.toBeInTheDocument()
  })

  // providerName not matching any provider: find() returns undefined
  it('should render without crashing when providerName does not match any provider', () => {
    // Act
    render(
      <Trigger
        modelId="gpt-4"
        providerName="unknown-provider"
      />,
    )

    // Assert
    expect(screen.getByText('gpt-4')).toBeInTheDocument()
  })
})
