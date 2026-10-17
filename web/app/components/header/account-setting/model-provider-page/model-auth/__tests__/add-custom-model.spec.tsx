import type { ModelProvider } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConfigurationMethodEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { renderWithConsoleQuery } from '@/test/console/query-data'
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
vi.mock('../hooks/get-custom-models', () => ({
  getCanAddedModels: () => mockCanAddedModels,
}))

const mockWorkspacePermissionKeys = vi.hoisted(() => ({
  value: ['credential.use', 'credential.create', 'credential.manage'],
}))

const render: typeof renderWithConsoleQuery = (ui, options) =>
  renderWithConsoleQuery(ui, {
    ...options,
    workspacePermissionKeys: mockWorkspacePermissionKeys.value,
  })

describe('AddCustomModel', () => {
  const getAddModelTrigger = () =>
    screen
      .getAllByRole('button', { name: /modelProvider.addModel/i })
      .find((element) => element.getAttribute('aria-haspopup') === 'dialog') ??
    screen.getAllByRole('button', { name: /modelProvider.addModel/i })[0]!

  const mockProvider = {
    provider: 'openai',
    allow_custom_token: true,
    icon_small: { en_US: 'https://example.com/icon.png' },
    icon_small_dark: { en_US: 'https://example.com/icon.png' },
  } as unknown as ModelProvider

  beforeEach(() => {
    vi.clearAllMocks()
    mockWorkspacePermissionKeys.value = ['credential.use', 'credential.create', 'credential.manage']
    mockCanAddedModels = []
  })

  it('should call handleOpenModal directly when no models available and allowed', async () => {
    mockCanAddedModels = []
    render(
      <AddCustomModel
        provider={mockProvider}
        configurationMethod={ConfigurationMethodEnum.predefinedModel}
      />,
    )

    await userEvent.setup().click(screen.getByRole('button', { name: /modelProvider.addModel/i }))
    expect(mockHandleOpenModalForAddNewCustomModel).toHaveBeenCalled()
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
    const row = await screen.findByRole('button', { name: 'gpt-4' })
    row.focus()
    await user.keyboard('{Enter}')

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

    const modelRow = await screen.findByRole('button', { name: 'gpt-4' })
    expect(modelRow).toBeDisabled()

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
