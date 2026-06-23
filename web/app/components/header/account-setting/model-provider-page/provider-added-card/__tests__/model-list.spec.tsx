import type { ModelItem, ModelProvider } from '../../declarations'
import { fireEvent, render, screen } from '@testing-library/react'
import { ConfigurationMethodEnum } from '../../declarations'
import ModelList from '../model-list'

const mockSetShowModelLoadBalancingModal = vi.fn()
let mockWorkspacePermissionKeys: string[] = ['plugin.manage', 'credential.manage', 'credential.use']

vi.mock('@/context/app-context', () => ({
  useSelector: (selector: (state: { workspacePermissionKeys: string[] }) => unknown) =>
    selector({ workspacePermissionKeys: mockWorkspacePermissionKeys }),
}))

vi.mock('@/context/modal-context', () => ({
  useModalContextSelector: (selector: (state: { setShowModelLoadBalancingModal: typeof mockSetShowModelLoadBalancingModal }) => unknown) =>
    selector({ setShowModelLoadBalancingModal: mockSetShowModelLoadBalancingModal }),
}))

vi.mock('../model-list-item', () => ({
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
    mockWorkspacePermissionKeys = ['plugin.manage', 'credential.manage', 'credential.use']
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
    expect(screen.getByRole('button', { name: 'gpt-4' }))!.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'gpt-3.5' }))!.toBeInTheDocument()
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
    fireEvent.click(countElements[1]!)
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

  it('should hide custom model actions without plugin.manage', () => {
    mockWorkspacePermissionKeys = []
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

  it('should hide custom model actions when provider uses predefinedModel only', () => {
    const predefinedProvider = {
      provider: 'test-provider',
      configurate_methods: ['predefinedModel'],
    } as unknown as ModelProvider

    render(
      <ModelList
        provider={predefinedProvider}
        models={mockModels}
        onCollapse={mockOnCollapse}
        onChange={mockOnChange}
      />,
    )

    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    expect(screen.queryByTestId('manage-credentials')).not.toBeInTheDocument()
    expect(screen.queryByTestId('add-custom-model')).not.toBeInTheDocument()
  })

  it('should call onSave (onChange) and onClose from the load balancing modal callbacks', () => {
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

    const callArg = mockSetShowModelLoadBalancingModal.mock.calls[0]![0]

    callArg.onSave('test-provider')
    expect(mockOnChange).toHaveBeenCalledWith('test-provider')

    callArg.onClose()
    expect(mockSetShowModelLoadBalancingModal).toHaveBeenCalledWith(null)
  })

  it('should hide custom model actions when provider uses fetchFromRemote only', () => {
    const fetchOnlyProvider = {
      provider: 'test-provider',
      configurate_methods: ['fetchFromRemote'],
    } as unknown as ModelProvider

    render(
      <ModelList
        provider={fetchOnlyProvider}
        models={mockModels}
        onCollapse={mockOnCollapse}
        onChange={mockOnChange}
      />,
    )

    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    // Assert
    expect(screen.queryByTestId('manage-credentials')).not.toBeInTheDocument()
    expect(screen.queryByTestId('add-custom-model')).not.toBeInTheDocument()
  })

  it('should show custom model actions when provider is configurable and user can manage plugins', () => {
    const configurableProvider = {
      provider: 'test-provider',
      configurate_methods: [ConfigurationMethodEnum.customizableModel],
    } as unknown as ModelProvider

    mockWorkspacePermissionKeys = ['plugin.manage']

    render(
      <ModelList
        provider={configurableProvider}
        models={mockModels}
        onCollapse={mockOnCollapse}
        onChange={mockOnChange}
      />,
    )

    expect(screen.getByTestId('manage-credentials'))!.toBeInTheDocument()
    expect(screen.getByTestId('add-custom-model'))!.toBeInTheDocument()
  })

  it('should hide custom model actions when provider is configurable but user cannot manage plugins', () => {
    const configurableProvider = {
      provider: 'test-provider',
      configurate_methods: [ConfigurationMethodEnum.customizableModel],
    } as unknown as ModelProvider

    mockWorkspacePermissionKeys = []

    render(
      <ModelList
        provider={configurableProvider}
        models={mockModels}
        onCollapse={mockOnCollapse}
        onChange={mockOnChange}
      />,
    )

    expect(screen.queryByTestId('manage-credentials')).not.toBeInTheDocument()
    expect(screen.queryByTestId('add-custom-model')).not.toBeInTheDocument()
  })
})
