import type { ComponentProps } from 'react'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createDeferred } from '@/test/deferred'
import {
  createCredentialProvider,
  credential,
  customModel,
  renderCredentialComponent,
} from '../../../__tests__/credential-test-env'
import { ConfigurationMethodEnum, ModelModalModeEnum } from '../../../declarations'
import Authorized from '../index'

const requests = vi.hoisted(() => ({ activate: vi.fn(), remove: vi.fn() }))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses, withConsoleResponses } =
    await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'workspaces.current.modelProviders.byProvider.models.credentials.switch.post':
        requests.activate,
      'workspaces.current.modelProviders.byProvider.credentials.delete': requests.remove,
    }),
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.modelProviders.byProvider.models.credentials.get': () => ({
        credentials: { api_key: 'saved-secret' },
        available_credentials: [credential],
      }),
      'workspaces.current.modelProviders.byProvider.credentials.get': () => ({
        credentials: { api_key: 'saved-secret' },
      }),
    }),
  }
})
beforeEach(() => {
  requests.activate.mockResolvedValue({ result: 'success' })
  requests.remove.mockResolvedValue({ result: 'success' })
})
const items = [{ model: customModel, credentials: [credential] }]
function renderMenu(
  props: Partial<ComponentProps<typeof Authorized>> = {},
  permissions = ['credential.use', 'credential.create', 'credential.manage'],
) {
  return renderCredentialComponent(
    <Authorized
      provider={createCredentialProvider()}
      configurationMethod={ConfigurationMethodEnum.predefinedModel}
      items={items}
      renderTrigger={(open, props) => (
        <button {...props} type="button">
          {open ? 'Close credentials' : 'Open credentials'}
        </button>
      )}
      {...props}
    />,
    { workspacePermissionKeys: permissions },
  )
}
const openMenu = async (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole('button', { name: 'Open credentials' }))

it('opens the credential list and activates the chosen model credential', async () => {
  const user = userEvent.setup()
  renderMenu()
  expect(screen.queryByRole('button', { name: 'Key 1' })).not.toBeInTheDocument()
  await openMenu(user)
  await user.click(screen.getByRole('button', { name: 'Key 1' }))
  await waitFor(() =>
    expect(requests.activate).toHaveBeenCalledExactlyOnceWith({
      params: { provider: 'openai' },
      body: { credential_id: 'cred-1', ...customModel },
    }),
  )
})
it('uses the caller selection contract instead of activating a credential', async () => {
  const user = userEvent.setup()
  const onItemClick = vi.fn()
  renderMenu({ onItemClick })
  await openMenu(user)
  await user.click(screen.getByRole('button', { name: 'Key 1' }))
  expect(onItemClick).toHaveBeenCalledExactlyOnceWith(credential, customModel)
  expect(requests.activate).not.toHaveBeenCalled()
})
it('opens an empty API-key form directly from the trigger', async () => {
  const user = userEvent.setup()
  renderMenu({ triggerOnlyOpenModal: true })
  await openMenu(user)
  expect(await screen.findByLabelText(/API key/)).toHaveValue('')
  expect(screen.getByRole('textbox', { name: /authorizationName/ })).toHaveValue('')
})
it('opens model credential creation with the fixed model fields', async () => {
  const user = userEvent.setup()
  renderMenu({
    configurationMethod: ConfigurationMethodEnum.customizableModel,
    authParams: { isModelCredential: true, mode: ModelModalModeEnum.configModelCredential },
    currentCustomConfigurationModelFixedFields: {
      __model_name: customModel.model,
      __model_type: customModel.model_type,
    },
  })
  await openMenu(user)
  await user.click(screen.getByRole('button', { name: /addModelCredential/ }))
  expect(await screen.findByLabelText(/API key/)).toHaveValue('')
  expect(screen.getByRole('dialog')).toHaveTextContent('gpt-4')
})
it.each([
  {
    name: 'explicitly hidden',
    props: { hideAddAction: true },
    permissions: ['credential.use', 'credential.manage'],
  },
  { name: 'use-only', props: {}, permissions: ['credential.use'] },
])(
  'keeps selection available but hides creation for $name users',
  async ({ props, permissions }) => {
    const user = userEvent.setup()
    renderMenu(props, permissions)
    await openMenu(user)
    expect(screen.queryByRole('button', { name: /addApiKey/ })).not.toBeInTheDocument()
    if (permissions.length === 1) {
      expect(
        screen.queryByRole('button', { name: 'common.operation.edit' }),
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'common.operation.delete' }),
      ).not.toBeInTheDocument()
    }
    await user.click(screen.getByRole('button', { name: 'Key 1' }))
    await waitFor(() => expect(requests.activate).toHaveBeenCalledOnce())
  },
)
it('allows create-only users to open creation without using or managing existing keys', async () => {
  const user = userEvent.setup()
  renderMenu({}, ['credential.create'])
  await openMenu(user)
  expect(screen.queryByRole('button', { name: 'Key 1' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'common.operation.edit' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'common.operation.delete' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: /addApiKey/ }))
  expect(await screen.findByLabelText(/API key/)).toHaveValue('')
})
it('allows manage-only users to edit the chosen credential', async () => {
  const user = userEvent.setup()
  renderMenu({}, ['credential.manage'])
  await openMenu(user)
  expect(screen.queryByRole('button', { name: 'Key 1' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /addApiKey/ })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'common.operation.edit' }))
  expect(await screen.findByRole('textbox', { name: /authorizationName/ })).toHaveValue('Key 1')
  expect(await screen.findByLabelText(/API key/)).toHaveValue('saved-secret')
})
it('cancels deletion, then confirms it with a pending request guard', async () => {
  const user = userEvent.setup()
  const pending = createDeferred<{ result: string }>()
  requests.remove.mockReturnValueOnce(pending.promise)
  renderMenu({}, ['credential.manage'])
  await openMenu(user)
  await user.click(screen.getByRole('button', { name: 'common.operation.delete' }))
  await user.click(
    within(screen.getByRole('alertdialog')).getByRole('button', {
      name: 'common.operation.cancel',
    }),
  )
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  expect(requests.remove).not.toHaveBeenCalled()
  await openMenu(user)
  await user.click(screen.getByRole('button', { name: 'common.operation.delete' }))
  const confirm = within(screen.getByRole('alertdialog')).getByRole('button', {
    name: 'common.operation.confirm',
  })
  await user.dblClick(confirm)
  expect(confirm).toBeDisabled()
  expect(requests.remove).toHaveBeenCalledExactlyOnceWith({
    params: { provider: 'openai' },
    body: { credential_id: 'cred-1' },
  })
  await act(async () => pending.resolve({ result: 'success' }))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
})
it.each([
  { allow_custom_token: false, disabled: false },
  { allow_custom_token: true, disabled: true },
])('blocks direct creation for %j', async ({ allow_custom_token, disabled }) => {
  const user = userEvent.setup()
  renderMenu({
    provider: createCredentialProvider({ allow_custom_token }),
    disabled,
    triggerOnlyOpenModal: true,
    items: [],
  })
  await openMenu(user)
  expect(screen.queryByLabelText(/API key/)).not.toBeInTheDocument()
})
