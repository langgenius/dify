import type { ModelItem, ModelProvider } from '../declarations'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { disableModel, enableModel } from '@/service/common'
import { ModelStatusEnum } from '../declarations'
import ModelListItem from './model-list-item'

let mockModelLoadBalancingEnabled = false

vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    isCurrentWorkspaceManager: true,
  }),
}))

vi.mock('@/context/provider-context', () => ({
  useProviderContext: () => ({
    plan: { type: 'pro' },
  }),
  useProviderContextSelector: () => mockModelLoadBalancingEnabled,
}))

vi.mock('@/service/common', () => ({
  enableModel: vi.fn(),
  disableModel: vi.fn(),
}))

vi.mock('../hooks', () => ({
  useUpdateModelList: () => vi.fn(),
}))

vi.mock('../model-icon', () => ({
  default: () => <div data-testid="model-icon" />,
}))

vi.mock('../model-name', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="model-name">{children}</div>,
}))

vi.mock('../model-auth', () => ({
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
  })

  it('should render model item with icon and name', () => {
    render(
      <ModelListItem
        model={mockModel}
        provider={mockProvider}
        isConfigurable={false}
      />,
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
    )

    fireEvent.click(screen.getByRole('button', { name: 'modify load balancing' }))
    expect(onModifyLoadBalancing).toHaveBeenCalledWith(mockModel)
  })
})
