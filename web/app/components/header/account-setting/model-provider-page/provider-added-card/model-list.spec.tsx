import type { ModelItem, ModelProvider } from '../declarations'
import { render, screen } from '@testing-library/react'
import ModelList from './model-list'

const mockSetShowModelLoadBalancingModal: unknown = vi.fn()

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { num?: number }) => `${_key}${options?.num ? `:${options.num}` : ''}`,
  }),
}))

vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    isCurrentWorkspaceManager: true,
  }),
}))

vi.mock('@/context/modal-context', () => ({
  useModalContextSelector: () => mockSetShowModelLoadBalancingModal as (selector: (state: unknown) => unknown) => unknown,
}))

vi.mock('./model-list-item', () => ({
  default: ({ model }: { model: ModelItem }) => (
    <div data-testid={`model-item-${model.model}`}>{model.model}</div>
  ),
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/model-auth', () => ({
  ManageCustomModelCredentials: () => <div data-testid="manage-credentials" />,
  AddCustomModel: () => <div data-testid="add-custom-model" />,
}))

describe('ModelList', () => {
  const mockProvider = {
    provider: 'test-provider',
    configurate_methods: ['customizableModel'],
  } as unknown as ModelProvider

  const mockModels = [
    { model: 'gpt-4', model_type: 'llm', fetch_from: 'system' },
    { model: 'gpt-3.5', model_type: 'llm', fetch_from: 'system' },
  ] as unknown as ModelItem[]

  const mockOnCollapse = vi.fn()
  const mockOnChange = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render all models', () => {
    render(
      <ModelList
        provider={mockProvider}
        models={mockModels}
        onCollapse={mockOnCollapse}
        onChange={mockOnChange}
      />,
    )
    expect(screen.getByTestId('model-item-gpt-4')).toBeInTheDocument()
    expect(screen.getByTestId('model-item-gpt-3.5')).toBeInTheDocument()
  })

  it('should display model count text', () => {
    render(
      <ModelList
        provider={mockProvider}
        models={mockModels}
        onCollapse={mockOnCollapse}
        onChange={mockOnChange}
      />,
    )
    const countElements = screen.queryAllByText(/modelsNum:2/)
    expect(countElements.length).toBeGreaterThan(0)
  })

  it('should render all model items in the list', () => {
    render(
      <ModelList
        provider={mockProvider}
        models={mockModels}
        onCollapse={mockOnCollapse}
        onChange={mockOnChange}
      />,
    )
    const modelItems = screen.getAllByTestId(/model-item/)
    expect(modelItems.length).toBeGreaterThan(0)
  })

  it('should render model list container', () => {
    const { container } = render(
      <ModelList
        provider={mockProvider}
        models={mockModels}
        onCollapse={mockOnCollapse}
        onChange={mockOnChange}
      />,
    )
    expect(container.firstChild).toBeInTheDocument()
  })
})
