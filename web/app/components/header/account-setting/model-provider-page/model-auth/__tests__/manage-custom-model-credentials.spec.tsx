import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  createCredentialProvider,
  credential,
  customModel,
  renderCredentialComponent,
} from '../../__tests__/credential-test-env'
import { ConfigurationMethodEnum } from '../../declarations'
import ManageCustomModelCredentials from '../manage-custom-model-credentials'

const requests = vi.hoisted(() => ({ read: vi.fn(), remove: vi.fn() }))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses, withConsoleClientResponses } =
    await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.modelProviders.byProvider.models.credentials.get': requests.read,
    }),
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'workspaces.current.modelProviders.byProvider.models.credentials.delete': requests.remove,
    }),
  }
})
beforeEach(() => {
  requests.read.mockResolvedValue({
    credentials: { api_key: 'saved-secret' },
    available_credentials: [credential],
  })
  requests.remove.mockResolvedValue({ result: 'success' })
})

const unused = { credential_id: 'cred-2', credential_name: 'Unused key' }
const model = {
  ...customModel,
  available_model_credentials: [credential, unused],
  current_credential_id: credential.credential_id,
  current_credential_name: credential.credential_name,
}
const provider = createCredentialProvider({
  configurate_methods: [ConfigurationMethodEnum.customizableModel],
  custom_configuration: { status: 'active', custom_models: [model] },
})

it('protects the current model credential and opens the chosen credential in the real editor', async () => {
  const user = userEvent.setup()
  renderCredentialComponent(<ManageCustomModelCredentials provider={provider} />)
  await user.click(screen.getByRole('button', { name: /manageCredentials/ }))
  expect(screen.getByText('gpt-4')).toBeInTheDocument()
  const deleteButtons = screen.getAllByRole('button', { name: 'common.operation.delete' })
  await user.click(deleteButtons[0]!)
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  await user.click(screen.getAllByRole('button', { name: 'common.operation.edit' })[1]!)
  expect(await screen.findByRole('textbox', { name: /authorizationName/ })).toHaveValue(
    'Unused key',
  )
  expect(await screen.findByLabelText(/API key/)).toHaveValue('saved-secret')
  expect(requests.read).toHaveBeenCalledWith({
    params: { provider: 'openai' },
    query: {
      credential_id: 'cred-2',
      model: 'gpt-4',
      model_type: 'llm',
      config_from: 'custom-model',
    },
  })
})
it('removes an unused credential with its model identity after confirmation', async () => {
  const user = userEvent.setup()
  renderCredentialComponent(<ManageCustomModelCredentials provider={provider} />)
  await user.click(screen.getByRole('button', { name: /manageCredentials/ }))
  await user.click(screen.getAllByRole('button', { name: 'common.operation.delete' })[1]!)
  await user.click(
    within(screen.getByRole('alertdialog')).getByRole('button', {
      name: 'common.operation.confirm',
    }),
  )
  await waitFor(() =>
    expect(requests.remove).toHaveBeenCalledExactlyOnceWith({
      params: { provider: 'openai' },
      query: { credential_id: 'cred-2', model: 'gpt-4', model_type: 'llm' },
    }),
  )
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
})
it('omits credential management without custom models', () => {
  renderCredentialComponent(<ManageCustomModelCredentials provider={createCredentialProvider()} />)
  expect(screen.queryByRole('button', { name: /manageCredentials/ })).not.toBeInTheDocument()
})
