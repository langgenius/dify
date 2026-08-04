import type { ModelProvider } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConfigurationMethodEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { render } from '@/test/console/render'
import AddCustomModel from '../add-custom-model'

// Mock hooks
const mockHandleOpenModalForAddNewCustomModel = vi.fn()
const mockHandleOpenModalForAddCustomModelToModelList = vi.fn()

vi.mock('../hooks/use-auth', () => ({
  useAuth: (
    _provider: unknown,
    _configMethod: unknown,
    _fixedFields: unknown,
    options: { mode: string },
  ) => {
    if (options.mode === 'config-custom-model') {
      return { handleOpenModal: mockHandleOpenModalForAddNewCustomModel }
    }
    if (options.mode === 'add-custom-model-to-model-list') {
      return { handleOpenModal: mockHandleOpenModalForAddCustomModelToModelList }
    }
    return { handleOpenModal: vi.fn() }
  },
}))

let mockCanAddedModels: { model: string; model_type: string }[] = []
vi.mock('../hooks/use-custom-models', () => ({
  useCanAddedModels: () => mockCanAddedModels,
}))

const mockWorkspacePermissionKeys = vi.hoisted(() => ({
  value: ['credential.use', 'credential.create', 'credential.manage'],
}))

vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')
  return createPermissionStateModuleMock(() => ({
    workspacePermissionKeys: mockWorkspacePermissionKeys.value,
  }))
})

// Mock components
vi.mock('../../model-icon', () => ({
  default: () => <div data-testid="model-icon" />,
}))

vi.mock('@remixicon/react', () => ({
  RiAddCircleFill: () => <div data-testid="add-circle-icon" />,
  RiAddLine: () => <div data-testid="add-line-icon" />,
}))

describe('AddCustomModel', () => {
  const getAddModelTrigger = () =>
    screen
      .getAllByRole('button', { name: /modelProvider.addModel/i })
      .find((element) => element.getAttribute('aria-haspopup') === 'dialog') ??
    screen.getAllByRole('button', { name: /modelProvider.addModel/i })[0]!

  const mockProvider = {
    provider: 'openai',
    allow_custom_token: true,
  } as unknown as ModelProvider

  beforeEach(() => {
    vi.clearAllMocks()
    mockWorkspacePermissionKeys.value = ['credential.use', 'credential.create', 'credential.manage']
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

  it('should show models list when models are available', async () => {
    const user = userEvent.setup()
    mockCanAddedModels = [{ model: 'gpt-4', model_type: 'llm' }]
    render(
      <AddCustomModel
        provider={mockProvider}
        configurationMethod={ConfigurationMethodEnum.predefinedModel}
      />,
    )

    await user.click(getAddModelTrigger())

    expect(await screen.findByText('gpt-4')).toBeInTheDocument()
    expect(screen.getByTestId('model-icon')).toBeInTheDocument()
  })

  it('should call handleOpenModalForAddCustomModelToModelList when clicking a model', async () => {
    const user = userEvent.setup()
    const model = { model: 'gpt-4', model_type: 'llm' }
    mockCanAddedModels = [model]
    render(
      <AddCustomModel
        provider={mockProvider}
        configurationMethod={ConfigurationMethodEnum.predefinedModel}
      />,
    )

    await user.click(getAddModelTrigger())
    await user.click(await screen.findByText('gpt-4'))

    expect(mockHandleOpenModalForAddCustomModelToModelList).toHaveBeenCalledWith(undefined, model)
  })

  it('should show existing model rows as disabled for create-only users', async () => {
    const user = userEvent.setup()
    const model = { model: 'gpt-4', model_type: 'llm' }
    mockWorkspacePermissionKeys.value = ['credential.create']
    mockCanAddedModels = [model]

    render(
      <AddCustomModel
        provider={mockProvider}
        configurationMethod={ConfigurationMethodEnum.predefinedModel}
      />,
    )

    await user.click(getAddModelTrigger())

    const modelRow = (await screen.findByText('gpt-4')).closest('[aria-disabled]')
    expect(modelRow).toHaveAttribute('aria-disabled', 'true')

    await user.click(modelRow!)
    expect(mockHandleOpenModalForAddCustomModelToModelList).not.toHaveBeenCalled()

    await user.click(screen.getByText(/modelProvider.auth.addNewModel/))
    expect(mockHandleOpenModalForAddNewCustomModel).toHaveBeenCalled()
  })

  it('should call handleOpenModalForAddNewCustomModel when clicking "Add New Model" in list', async () => {
    const user = userEvent.setup()
    mockCanAddedModels = [{ model: 'gpt-4', model_type: 'llm' }]
    render(
      <AddCustomModel
        provider={mockProvider}
        configurationMethod={ConfigurationMethodEnum.predefinedModel}
      />,
    )

    await user.click(getAddModelTrigger())
    await user.click(await screen.findByText(/modelProvider.auth.addNewModel/))

    expect(mockHandleOpenModalForAddNewCustomModel).toHaveBeenCalled()
  })

  it('should show tooltip when no models and custom tokens not allowed', async () => {
    const user = userEvent.setup()
    const restrictedProvider = { ...mockProvider, allow_custom_token: false }
    mockCanAddedModels = []
    render(
      <AddCustomModel
        provider={restrictedProvider}
        configurationMethod={ConfigurationMethodEnum.predefinedModel}
      />,
    )

    const trigger = getAddModelTrigger()
    await user.hover(trigger)
    expect(await screen.findByText('plugin.auth.credentialUnavailable')).toBeInTheDocument()

    await user.click(trigger)
    expect(mockHandleOpenModalForAddNewCustomModel).not.toHaveBeenCalled()
  })
})
