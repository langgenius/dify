import type { ModelProvider } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '@/test/console/render'
import {
  ConfigurationMethodEnum,
  CustomConfigurationStatusEnum,
  ModelTypeEnum,
  PreferredProviderTypeEnum,
} from '../../declarations'
import ManageCustomModelCredentials from '../manage-custom-model-credentials'

const editCredential = vi.fn()
const deleteCredential = vi.fn()
vi.mock('../hooks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks')>()),
  useAuth: () => ({
    handleOpenModal: editCredential,
    openConfirmDelete: deleteCredential,
    closeConfirmDelete: vi.fn(),
    doingAction: false,
    handleActiveCredential: vi.fn(),
    handleConfirmDelete: vi.fn(),
    deleteCredentialId: null,
  }),
}))
vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')
  return createPermissionStateModuleMock(() => ({
    workspacePermissionKeys: ['credential.use', 'credential.create', 'credential.manage'],
  }))
})
const credentials = [
  { credential_id: 'c1', credential_name: 'Current key' },
  { credential_id: 'c2', credential_name: 'Unused key' },
]
const model = {
  model: 'gpt-4',
  model_type: ModelTypeEnum.textGeneration,
  available_model_credentials: credentials,
  current_credential_id: 'c1',
  current_credential_name: 'Current key',
}
const provider: ModelProvider = {
  provider: 'openai',
  label: { en_US: 'OpenAI', zh_Hans: 'OpenAI' },
  supported_model_types: [ModelTypeEnum.textGeneration],
  configurate_methods: [ConfigurationMethodEnum.customizableModel],
  preferred_provider_type: PreferredProviderTypeEnum.custom,
  custom_configuration: { status: CustomConfigurationStatusEnum.active, custom_models: [model] },
  system_configuration: { enabled: false, quota_configurations: [] },
}

it('protects the current model credential and opens editing for the chosen credential', async () => {
  const user = userEvent.setup()
  render(<ManageCustomModelCredentials provider={provider} />)
  await user.click(screen.getByRole('button', { name: /manageCredentials/ }))
  expect(screen.getByText('gpt-4')).toBeInTheDocument()
  expect(screen.getByText('Current key')).toBeInTheDocument()
  expect(screen.getByText('Unused key')).toBeInTheDocument()
  await user.click(screen.getAllByRole('button', { name: 'common.operation.delete' })[0]!)
  expect(deleteCredential).not.toHaveBeenCalled()
  await user.click(screen.getAllByRole('button', { name: 'common.operation.edit' })[1]!)
  expect(editCredential).toHaveBeenCalledWith(credentials[1], model)
  await waitFor(() => expect(screen.queryByText('Unused key')).not.toBeInTheDocument())
})

it('allows removing an unused credential while retaining its model identity', async () => {
  render(<ManageCustomModelCredentials provider={provider} isOpen />)
  await userEvent
    .setup()
    .click(screen.getAllByRole('button', { name: 'common.operation.delete' })[1]!)
  expect(deleteCredential).toHaveBeenCalledWith(credentials[1], model)
})

it('omits credential management without custom models', () => {
  render(
    <ManageCustomModelCredentials
      provider={{
        ...provider,
        custom_configuration: { status: CustomConfigurationStatusEnum.active, custom_models: [] },
      }}
    />,
  )
  expect(screen.queryByRole('button', { name: /manageCredentials/ })).not.toBeInTheDocument()
})
