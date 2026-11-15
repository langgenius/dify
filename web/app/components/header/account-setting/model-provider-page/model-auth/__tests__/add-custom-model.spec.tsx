import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  createCredentialProvider,
  credential,
  customModel,
  renderCredentialComponent,
} from '../../__tests__/credential-test-env'
import { ConfigurationMethodEnum, CustomConfigurationStatusEnum } from '../../declarations'
import AddCustomModel from '../add-custom-model'

const requests = vi.hoisted(() => ({ activate: vi.fn() }))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses, withConsoleClientResponses } =
    await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.modelProviders.byProvider.models.credentials.get': () => ({
        credentials: {},
        available_credentials: [credential],
      }),
    }),
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'workspaces.current.modelProviders.byProvider.models.credentials.switch.post':
        requests.activate,
    }),
  }
})
beforeEach(() => requests.activate.mockResolvedValue({ result: 'success' }))
function renderAdd({
  models = [],
  allowCustomToken = true,
  permissions,
}: { models?: (typeof customModel)[]; allowCustomToken?: boolean; permissions?: string[] } = {}) {
  return renderCredentialComponent(
    <AddCustomModel
      provider={createCredentialProvider({
        allow_custom_token: allowCustomToken,
        configurate_methods: [ConfigurationMethodEnum.customizableModel],
        custom_configuration: {
          status: CustomConfigurationStatusEnum.active,
          can_added_models: models,
        },
      })}
      configurationMethod={ConfigurationMethodEnum.customizableModel}
    />,
    permissions ? { workspacePermissionKeys: permissions } : {},
  )
}
const open = async (user: ReturnType<typeof userEvent.setup>) =>
  user.click(
    screen
      .getAllByRole('button', { name: /modelProvider.addModel/ })
      .find((button) => button.getAttribute('aria-haspopup') === 'dialog') ??
      screen.getByRole('button', { name: /modelProvider.addModel/ }),
  )
it('opens the custom-model form directly when no existing models are available', async () => {
  const user = userEvent.setup()
  renderAdd()
  await open(user)
  expect(await screen.findByRole('textbox', { name: /Model/ })).toHaveValue('')
  expect(screen.getByLabelText(/API key/)).toHaveValue('')
})
it('chooses an existing model and activates the selected credential for that model', async () => {
  const user = userEvent.setup()
  renderAdd({ models: [customModel] })
  await open(user)
  const row = await screen.findByRole('button', { name: 'gpt-4' })
  row.focus()
  await user.click(row)
  expect(await screen.findByRole('dialog')).toHaveTextContent('gpt-4')
  await user.click(await screen.findByRole('button', { name: /selectModelCredential/ }))
  await user.click(await screen.findByRole('button', { name: 'Key 1' }))
  await user.click(screen.getByRole('button', { name: /common.operation.add/ }))
  await waitFor(() =>
    expect(requests.activate).toHaveBeenCalledExactlyOnceWith({
      params: { provider: 'openai' },
      body: { credential_id: 'cred-1', ...customModel },
    }),
  )
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
})
it('disables existing model selection for create-only users but opens a new-model form', async () => {
  const user = userEvent.setup()
  renderAdd({ models: [customModel], permissions: ['credential.create'] })
  await open(user)
  const row = await screen.findByRole('button', { name: 'gpt-4' })
  expect(row).toBeDisabled()
  await user.click(row)
  expect(screen.queryByLabelText(/API key/)).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: /auth.addNewModel/ }))
  expect(await screen.findByRole('textbox', { name: /Model/ })).toHaveValue('')
})
it('opens a blank form from Add New Model in the model list', async () => {
  const user = userEvent.setup()
  renderAdd({ models: [customModel] })
  await open(user)
  await user.click(screen.getByRole('button', { name: /auth.addNewModel/ }))
  expect(await screen.findByRole('textbox', { name: /Model/ })).toHaveValue('')
  expect(screen.getByLabelText(/API key/)).toHaveValue('')
})
it('explains why new models cannot be added when custom credentials are disallowed', async () => {
  const user = userEvent.setup()
  renderAdd({ allowCustomToken: false })
  const trigger = screen.getByRole('button', { name: /modelProvider.addModel/ })
  await user.hover(trigger)
  expect(await screen.findByText('plugin.auth.credentialUnavailable')).toBeInTheDocument()
  await user.click(trigger)
  expect(screen.queryByLabelText(/API key/)).not.toBeInTheDocument()
})
