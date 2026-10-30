import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  createCredentialProvider,
  credential,
  customModel,
  renderCredentialComponent,
} from '../../__tests__/credential-test-env'
import { ConfigurationMethodEnum } from '../../declarations'
import AddCredentialInLoadBalancing from '../add-credential-in-load-balancing'

const requests = vi.hoisted(() => ({ read: vi.fn() }))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.modelProviders.byProvider.models.credentials.get': requests.read,
    }),
  }
})
beforeEach(() => {
  requests.read.mockResolvedValue({
    credentials: { api_key: 'saved-secret' },
    available_credentials: [credential],
  })
})

function renderMenu(permissions: string[], credentials = [credential]) {
  const onSelect = vi.fn()
  renderCredentialComponent(
    <AddCredentialInLoadBalancing
      provider={createCredentialProvider()}
      model={customModel}
      configurationMethod={ConfigurationMethodEnum.customizableModel}
      modelCredential={{
        available_credentials: credentials,
        credentials: {},
        load_balancing: { enabled: false, configs: [] },
      }}
      onSelectCredential={onSelect}
    />,
    { workspacePermissionKeys: permissions },
  )
  return onSelect
}
it('lets use-only users choose an existing credential without creation or management', async () => {
  const user = userEvent.setup()
  const onSelect = renderMenu(['credential.use'])
  await user.click(screen.getByRole('button', { name: /auth.addCredential/ }))
  expect(screen.queryByRole('button', { name: /addModelCredential/ })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'common.operation.edit' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'common.operation.delete' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Key 1' }))
  expect(onSelect).toHaveBeenCalledExactlyOnceWith(credential, customModel)
})
it('lets manage-only users edit an existing credential without selecting or creating one', async () => {
  const user = userEvent.setup()
  const onSelect = renderMenu(['credential.manage'])
  await user.click(screen.getByRole('button', { name: /auth.addCredential/ }))
  expect(screen.queryByRole('button', { name: /addModelCredential/ })).not.toBeInTheDocument()
  await user.click(screen.getByText('Key 1'))
  expect(onSelect).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'common.operation.edit' }))
  expect(await screen.findByRole('textbox', { name: /authorizationName/ })).toHaveValue('Key 1')
  expect(await screen.findByLabelText(/API key/)).toHaveValue('saved-secret')
  expect(screen.getByRole('dialog')).toHaveTextContent('gpt-4')
})
it.each([[], ['credential.manage']])(
  'hides the empty menu without creation or use permission: %j',
  (...permissions) => {
    renderMenu(permissions.flat(), [])
    expect(screen.queryByRole('button', { name: /auth.addCredential/ })).not.toBeInTheDocument()
  },
)
it('opens a new credential form directly when there are no existing credentials', async () => {
  const user = userEvent.setup()
  renderMenu(['credential.create'], [])
  await user.click(screen.getByRole('button', { name: /auth.addCredential/ }))
  expect(await screen.findByLabelText(/API key/)).toHaveValue('')
  expect(screen.getByRole('textbox', { name: /authorizationName/ })).toHaveValue('')
})
