import type { ModelItem, ModelProvider } from '../declarations'
import { fireEvent, render, screen } from '@testing-library/react'
import ModelList from './model-list'

const mockSetShowModelLoadBalancingModal = vi.fn()
let mockIsCurrentWorkspaceManager = true

vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    isCurrentWorkspaceManager: mockIsCurrentWorkspaceManager,
  }),
}))

vi.mock('@/context/modal-context', () => ({
  useModalContextSelector: (selector: (state: { setShowModelLoadBalancingModal: typeof mockSetShowModelLoadBalancingModal }) => unknown) =>
    selector({ setShowModelLoadBalancingModal: mockSetShowModelLoadBalancingModal }),
}))

vi.mock('./model-list-item', () => ({
  default: ({ model, onModifyLoadBalancing }: { model: ModelItem, onModifyLoadBalancing: (model: ModelItem) => void }) => (
    <button type="button" onClick={() => onModifyLoadBalancing(model)}>
      {model.model}
    </button>
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
    mockIsCurrentWorkspaceManager = true
  })

  it('should render model count and model items', () => {
    render(
      <ModelList
        provider={mockProvider}
        models={mockModels}
        onCollapse={mockOnCollapse}
        onChange={mockOnChange}
      />,
    )
    expect(screen.getAllByText(/modelProvider\.modelsNum/).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'gpt-4' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'gpt-3.5' })).toBeInTheDocument()
  })

  it('should trigger collapse when collapsed label is clicked', () => {
    render(
      <ModelList
        provider={mockProvider}
        models={mockModels}
        onCollapse={mockOnCollapse}
        onChange={mockOnChange}
      />,
    )

    const countElements = screen.getAllByText(/modelProvider\.modelsNum/)
    fireEvent.click(countElements[1])
    expect(mockOnCollapse).toHaveBeenCalled()
  })

  it('should open load balancing modal for selected model', () => {
    render(
      <ModelList
        provider={mockProvider}
        models={mockModels}
        onCollapse={mockOnCollapse}
        onChange={mockOnChange}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'gpt-4' }))
    expect(mockSetShowModelLoadBalancingModal).toHaveBeenCalled()
  })

  it('should hide custom model actions for non-manager', () => {
    mockIsCurrentWorkspaceManager = false
    render(
      <ModelList
        provider={mockProvider}
        models={mockModels}
        onCollapse={mockOnCollapse}
        onChange={mockOnChange}
      />,
    )

    expect(screen.queryByTestId('manage-credentials')).not.toBeInTheDocument()
    expect(screen.queryByTestId('add-custom-model')).not.toBeInTheDocument()
  })
})
