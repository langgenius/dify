import type { ModelProvider } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { fireEvent, render, screen } from '@testing-library/react'
import { ConfigurationMethodEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import AddCustomModel from './add-custom-model'

// Mock hooks
const mockHandleOpenModalForAddNewCustomModel = vi.fn()
const mockHandleOpenModalForAddCustomModelToModelList = vi.fn()

vi.mock('./hooks/use-auth', () => ({
  useAuth: (_provider: unknown, _configMethod: unknown, _fixedFields: unknown, options: { mode: string }) => {
    if (options.mode === 'config-custom-model') {
      return { handleOpenModal: mockHandleOpenModalForAddNewCustomModel }
    }
    if (options.mode === 'add-custom-model-to-model-list') {
      return { handleOpenModal: mockHandleOpenModalForAddCustomModelToModelList }
    }
    return { handleOpenModal: vi.fn() }
  },
}))

let mockCanAddedModels: { model: string, model_type: string }[] = []
vi.mock('./hooks/use-custom-models', () => ({
  useCanAddedModels: () => mockCanAddedModels,
}))

// Mock components
vi.mock('../model-icon', () => ({
  default: () => <div data-testid="model-icon" />,
}))

vi.mock('@remixicon/react', () => ({
  RiAddCircleFill: () => <div data-testid="add-circle-icon" />,
  RiAddLine: () => <div data-testid="add-line-icon" />,
}))

vi.mock('@/app/components/base/tooltip', () => ({
  default: ({ children, popupContent }: { children: React.ReactNode, popupContent: string }) => (
    <div data-testid="tooltip-mock">
      {children}
      <div>{popupContent}</div>
    </div>
  ),
}))

// Mock portal components to avoid async/jsdom issues (consistent with sibling tests)
vi.mock('@/app/components/base/portal-to-follow-elem', () => ({
  PortalToFollowElem: ({ children, open }: { children: React.ReactNode, open: boolean, onOpenChange: (open: boolean) => void }) => (
    <div data-testid="portal" data-open={open}>
      {children}
    </div>
  ),
  PortalToFollowElemTrigger: ({ children, onClick }: { children: React.ReactNode, onClick: () => void }) => (
    <div data-testid="portal-trigger" onClick={onClick}>{children}</div>
  ),
  PortalToFollowElemContent: ({ children }: { children: React.ReactNode, open?: boolean }) => {
    // In many tests, we need to find elements inside the content even if "closed" in state
    // but not yet "removed" from DOM. However, to avoid multiple elements issues,
    // we should be careful.
    // For AddCustomModel, we need the content to be present when we click a model.
    return <div data-testid="portal-content" style={{ display: 'block' }}>{children}</div>
  },
}))

describe('AddCustomModel', () => {
  const mockProvider = {
    provider: 'openai',
    allow_custom_token: true,
  } as unknown as ModelProvider

  beforeEach(() => {
    vi.clearAllMocks()
    mockCanAddedModels = []
  })

  it('should render the add model button', () => {
    render(
      <AddCustomModel
        provider={mockProvider}
        configurationMethod={ConfigurationMethodEnum.predefinedModel}
      />,
    )

    expect(screen.getByText(/modelProvider.addModel/)).toBeInTheDocument()
    expect(screen.getByTestId('add-circle-icon')).toBeInTheDocument()
  })

  it('should call handleOpenModal directly when no models available and allowed', () => {
    mockCanAddedModels = []
    render(
      <AddCustomModel
        provider={mockProvider}
        configurationMethod={ConfigurationMethodEnum.predefinedModel}
      />,
    )

    fireEvent.click(screen.getByTestId('portal-trigger'))
    expect(mockHandleOpenModalForAddNewCustomModel).toHaveBeenCalled()
  })

  it('should show models list when models are available', () => {
    mockCanAddedModels = [{ model: 'gpt-4', model_type: 'llm' }]
    render(
      <AddCustomModel
        provider={mockProvider}
        configurationMethod={ConfigurationMethodEnum.predefinedModel}
      />,
    )

    fireEvent.click(screen.getByTestId('portal-trigger'))

    // The portal should be "open"
    expect(screen.getByTestId('portal')).toHaveAttribute('data-open', 'true')
    expect(screen.getByText('gpt-4')).toBeInTheDocument()
    expect(screen.getByTestId('model-icon')).toBeInTheDocument()
  })

  it('should call handleOpenModalForAddCustomModelToModelList when clicking a model', () => {
    const model = { model: 'gpt-4', model_type: 'llm' }
    mockCanAddedModels = [model]
    render(
      <AddCustomModel
        provider={mockProvider}
        configurationMethod={ConfigurationMethodEnum.predefinedModel}
      />,
    )

    fireEvent.click(screen.getByTestId('portal-trigger'))
    fireEvent.click(screen.getByText('gpt-4'))

    expect(mockHandleOpenModalForAddCustomModelToModelList).toHaveBeenCalledWith(undefined, model)
  })

  it('should call handleOpenModalForAddNewCustomModel when clicking "Add New Model" in list', () => {
    mockCanAddedModels = [{ model: 'gpt-4', model_type: 'llm' }]
    render(
      <AddCustomModel
        provider={mockProvider}
        configurationMethod={ConfigurationMethodEnum.predefinedModel}
      />,
    )

    fireEvent.click(screen.getByTestId('portal-trigger'))
    fireEvent.click(screen.getByText(/modelProvider.auth.addNewModel/))

    expect(mockHandleOpenModalForAddNewCustomModel).toHaveBeenCalled()
  })

  it('should show tooltip when no models and custom tokens not allowed', () => {
    const restrictedProvider = { ...mockProvider, allow_custom_token: false }
    mockCanAddedModels = []
    render(
      <AddCustomModel
        provider={restrictedProvider}
        configurationMethod={ConfigurationMethodEnum.predefinedModel}
      />,
    )

    expect(screen.getByTestId('tooltip-mock')).toBeInTheDocument()
    expect(screen.getByText('plugin.auth.credentialUnavailable')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('portal-trigger'))
    expect(mockHandleOpenModalForAddNewCustomModel).not.toHaveBeenCalled()
  })
})
