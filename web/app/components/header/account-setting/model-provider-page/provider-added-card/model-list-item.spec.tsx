import type { ModelItem, ModelProvider } from '../declarations'
import { render, screen } from '@testing-library/react'
import ModelListItem from './model-list-item'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    isCurrentWorkspaceManager: true,
  }),
}))

vi.mock('@/context/provider-context', () => ({
  useProviderContext: () => ({
    plan: { type: 'pro' },
  }),
  useProviderContextSelector: () => false,
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
  ConfigModel: () => <div data-testid="config-model" />,
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

  it('should render switch toggle', () => {
    render(
      <ModelListItem
        model={mockModel}
        provider={mockProvider}
        isConfigurable={false}
      />,
    )
    expect(screen.getByRole('switch')).toBeInTheDocument()
  })

  it('should show disabled switch when model is deprecated', () => {
    const deprecatedModel = { ...mockModel, deprecated: true }
    render(
      <ModelListItem
        model={deprecatedModel}
        provider={mockProvider}
        isConfigurable={false}
      />,
    )
    const switchEl = screen.getByRole('switch')
    expect(switchEl).toBeInTheDocument()
    expect(switchEl).toHaveClass('!opacity-50')
  })
})
