import type { ModelItem, ModelProvider } from '../../declarations'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { disableModel, enableModel } from '@/service/common'
import { ModelStatusEnum } from '../../declarations'
import ModelListItem from '../model-list-item'

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

let mockModelLoadBalancingEnabled = false
let mockPlanType: string = 'pro'

vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    isCurrentWorkspaceManager: true,
  }),
}))

vi.mock('@/context/provider-context', () => ({
  useProviderContext: () => ({
    plan: { type: mockPlanType },
  }),
  useProviderContextSelector: () => mockModelLoadBalancingEnabled,
}))

vi.mock('@/service/common', () => ({
  enableModel: vi.fn(),
  disableModel: vi.fn(),
}))

vi.mock('../../hooks', () => ({
  useUpdateModelList: () => vi.fn(),
}))

vi.mock('../../model-icon', () => ({
  default: () => <div data-testid="model-icon" />,
}))

vi.mock('../../model-name', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="model-name">{children}</div>,
}))

vi.mock('../../model-auth', () => ({
  ConfigModel: ({ onClick }: { onClick: () => void }) => (
    <button type="button" onClick={onClick}>modify load balancing</button>
  ),
}))

describe('ModelListItem', () => {
  const mockProvider = {
    provider: 'test-provider',
  } as unknown as ModelProvider

  const mockModel = {
    model: 'gpt-4',
    model_type: 'llm',
    fetch_from: 'system',
    status: 'active',
    deprecated: false,
    load_balancing_enabled: false,
    has_invalid_load_balancing_configs: false,
  } as unknown as ModelItem

  beforeEach(() => {
    vi.clearAllMocks()
    mockModelLoadBalancingEnabled = false
    mockPlanType = 'pro'
  })

  it('should render model item with icon and name', () => {
    render(
      <ModelListItem
        model={mockModel}
        provider={mockProvider}
        isConfigurable={false}
      />,
      { wrapper: createWrapper() },
    )
    expect(screen.getByTestId('model-icon')).toBeInTheDocument()
    expect(screen.getByTestId('model-name')).toBeInTheDocument()
  })

  it('should disable an active model when switch is clicked', async () => {
    const onChange = vi.fn()
    render(
      <ModelListItem
        model={mockModel}
        provider={mockProvider}
        isConfigurable={false}
        onChange={onChange}
      />,
      { wrapper: createWrapper() },
    )
    fireEvent.click(screen.getByRole('switch'))

    await waitFor(() => {
      expect(disableModel).toHaveBeenCalled()
      expect(onChange).toHaveBeenCalledWith('test-provider')
    }, { timeout: 2000 })
  })

  it('should enable a disabled model when switch is clicked', async () => {
    const onChange = vi.fn()
    const disabledModel = { ...mockModel, status: ModelStatusEnum.disabled }
    render(
      <ModelListItem
        model={disabledModel}
        provider={mockProvider}
        isConfigurable={false}
        onChange={onChange}
      />,
      { wrapper: createWrapper() },
    )
    fireEvent.click(screen.getByRole('switch'))

    await waitFor(() => {
      expect(enableModel).toHaveBeenCalled()
      expect(onChange).toHaveBeenCalledWith('test-provider')
    }, { timeout: 2000 })
  })

  it('should open load balancing config action when available', () => {
    mockModelLoadBalancingEnabled = true
    const onModifyLoadBalancing = vi.fn()

    render(
      <ModelListItem
        model={mockModel}
        provider={mockProvider}
        isConfigurable={false}
        onModifyLoadBalancing={onModifyLoadBalancing}
      />,
      { wrapper: createWrapper() },
    )

    fireEvent.click(screen.getByRole('button', { name: 'modify load balancing' }))
    expect(onModifyLoadBalancing).toHaveBeenCalledWith(mockModel)
  })

  // Deprecated branches: opacity-60, disabled switch, no ConfigModel
  it('should show deprecated model with opacity and disabled switch', () => {
    // Arrange
    const deprecatedModel = { ...mockModel, deprecated: true } as unknown as ModelItem
    mockModelLoadBalancingEnabled = true

    // Act
    const { container } = render(
      <ModelListItem
        model={deprecatedModel}
        provider={mockProvider}
        isConfigurable={false}
      />,
      { wrapper: createWrapper() },
    )

    // Assert
    expect(container.querySelector('.opacity-60')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'modify load balancing' })).not.toBeInTheDocument()
  })

  // Load balancing badge: visible when all 4 conditions met
  it('should show load balancing badge when all conditions are met', () => {
    // Arrange
    mockModelLoadBalancingEnabled = true
    const lbModel = {
      ...mockModel,
      load_balancing_enabled: true,
      has_invalid_load_balancing_configs: false,
      deprecated: false,
    } as unknown as ModelItem

    // Act
    render(
      <ModelListItem
        model={lbModel}
        provider={mockProvider}
        isConfigurable={false}
      />,
      { wrapper: createWrapper() },
    )

    // Assert - Badge component should render
    const badge = document.querySelector('.border-text-accent-secondary')
    expect(badge).toBeInTheDocument()
  })

  // Plan.sandbox: ConfigModel shown without load balancing enabled
  it('should show ConfigModel for sandbox plan even without load balancing enabled', () => {
    // Arrange - set plan type to sandbox and keep load balancing disabled
    mockModelLoadBalancingEnabled = false
    mockPlanType = 'sandbox'

    // Act
    render(
      <ModelListItem
        model={mockModel}
        provider={mockProvider}
        isConfigurable={false}
      />,
      { wrapper: createWrapper() },
    )

    // Assert - ConfigModel should show because plan.type === 'sandbox'
    expect(screen.getByRole('button', { name: 'modify load balancing' })).toBeInTheDocument()
  })

  // Negative proof: non-sandbox plan without load balancing should NOT show ConfigModel
  it('should hide ConfigModel for non-sandbox plan without load balancing enabled', () => {
    // Arrange - set plan type to non-sandbox and keep load balancing disabled
    mockModelLoadBalancingEnabled = false
    mockPlanType = 'pro'

    // Act
    render(
      <ModelListItem
        model={mockModel}
        provider={mockProvider}
        isConfigurable={false}
      />,
      { wrapper: createWrapper() },
    )

    // Assert - ConfigModel should NOT show because plan.type !== 'sandbox' and load balancing is disabled
    expect(screen.queryByRole('button', { name: 'modify load balancing' })).not.toBeInTheDocument()
  })

  // model.status=credentialRemoved: switch disabled, no ConfigModel
  it('should disable switch and hide ConfigModel when status is credentialRemoved', () => {
    // Arrange
    const removedModel = { ...mockModel, status: ModelStatusEnum.credentialRemoved } as unknown as ModelItem
    mockModelLoadBalancingEnabled = true

    // Act
    render(
      <ModelListItem
        model={removedModel}
        provider={mockProvider}
        isConfigurable={false}
      />,
      { wrapper: createWrapper() },
    )

    // Assert - ConfigModel should not render because status is not active/disabled
    expect(screen.queryByRole('button', { name: 'modify load balancing' })).not.toBeInTheDocument()
    const statusSwitch = screen.getByRole('switch')
    expect(statusSwitch).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(statusSwitch)
    expect(statusSwitch).toHaveAttribute('aria-checked', 'false')
    expect(enableModel).not.toHaveBeenCalled()
    expect(disableModel).not.toHaveBeenCalled()
  })

  // isConfigurable=true: hover class on row
  it('should apply hover class when isConfigurable is true', () => {
    // Act
    const { container } = render(
      <ModelListItem
        model={mockModel}
        provider={mockProvider}
        isConfigurable={true}
      />,
      { wrapper: createWrapper() },
    )

    // Assert
    expect(container.querySelector('.hover\\:bg-components-panel-on-panel-item-bg-hover')).toBeInTheDocument()
  })
})
