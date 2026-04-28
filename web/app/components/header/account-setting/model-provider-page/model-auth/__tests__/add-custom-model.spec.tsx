import type { ModelProvider } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { fireEvent, render, screen } from '@testing-library/react'
import { ConfigurationMethodEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import AddCustomModel from '../add-custom-model'

// Mock hooks
const mockHandleOpenModalForAddNewCustomModel = vi.fn()
const mockHandleOpenModalForAddCustomModelToModelList = vi.fn()

vi.mock('../hooks/use-auth', () => ({
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
vi.mock('../hooks/use-custom-models', () => ({
  useCanAddedModels: () => mockCanAddedModels,
}))

// Mock components
vi.mock('../../model-icon', () => ({
  default: () => <div data-testid="model-icon" />,
}))

vi.mock('@remixicon/react', () => ({
  RiAddCircleFill: () => <div data-testid="add-circle-icon" />,
  RiAddLine: () => <div data-testid="add-line-icon" />,
}))

vi.mock('@langgenius/dify-ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="tooltip-mock">
      {children}
    </div>
  ),
  TooltipTrigger: ({ render }: { render: React.ReactNode }) => <>{render}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('@langgenius/dify-ui/popover', async () => await import('@/__mocks__/base-ui-popover'))

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

    fireEvent.click(screen.getByRole('button', { name: /modelProvider.addModel/i }))
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

    fireEvent.click(screen.getByTestId('popover-trigger'))

    // The portal should be "open"
    expect(screen.getByTestId('popover')).toHaveAttribute('data-open', 'true')
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

    fireEvent.click(screen.getByTestId('popover-trigger'))
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

    fireEvent.click(screen.getByTestId('popover-trigger'))
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

    fireEvent.click(screen.getByRole('button', { name: /modelProvider.addModel/i }))
    expect(mockHandleOpenModalForAddNewCustomModel).not.toHaveBeenCalled()
  })
})
