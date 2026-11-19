import type { ComponentProps } from 'react'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import {
  createCredentialProvider,
  credential,
  customModel,
  renderCredentialComponent,
} from '../../__tests__/credential-test-env'
import SwitchCredentialInLoadBalancing from '../switch-credential-in-load-balancing'

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

const other = { credential_id: 'cred-2', credential_name: 'Key 2' }
function renderSwitch(
  overrides: Partial<ComponentProps<typeof SwitchCredentialInLoadBalancing>> = {},
  permissions = ['credential.use', 'credential.create', 'credential.manage'],
) {
  function Caller() {
    const [selected, setSelected] = useState<
      ComponentProps<typeof SwitchCredentialInLoadBalancing>['customModelCredential']
    >(overrides.customModelCredential ?? credential)
    return (
      <SwitchCredentialInLoadBalancing
        provider={createCredentialProvider()}
        model={customModel}
        credentials={[credential, other]}
        {...overrides}
        customModelCredential={selected}
        setCustomModelCredential={setSelected}
      />
    )
  }
  return renderCredentialComponent(<Caller />, { workspacePermissionKeys: permissions })
}
it('shows that the selected credential has been removed', () => {
  renderSwitch({ customModelCredential: { credential_id: 'removed', credential_name: 'Removed' } })
  expect(screen.getByText(/authRemoved/)).toBeInTheDocument()
})
it('opens credential creation when the list is empty', async () => {
  const user = userEvent.setup()
  renderSwitch({ credentials: [] })
  await user.click(screen.getByRole('button', { name: /auth.addCredential/ }))
  expect(await screen.findByLabelText(/API key/)).toHaveValue('')
})
it('persists the selected credential in the trigger and in the reopened menu', async () => {
  const user = userEvent.setup()
  renderSwitch()
  await user.click(screen.getByRole('button', { name: 'Key 1' }))
  await user.click(screen.getByRole('button', { name: 'Key 2' }))
  expect(screen.getByRole('button', { name: 'Key 2' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Key 1' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Key 2' }))
  expect(screen.getByRole('button', { name: 'Key 1' })).toBeInTheDocument()
})
it('lets manage-only users edit credentials without selecting or adding them', async () => {
  const user = userEvent.setup()
  renderSwitch({}, ['credential.manage'])
  await user.click(screen.getByRole('button', { name: 'Key 1' }))
  expect(screen.queryByRole('button', { name: 'Key 2' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /addModelCredential/ })).not.toBeInTheDocument()
  await user.click(screen.getAllByRole('button', { name: 'common.operation.edit' })[0]!)
  expect(await screen.findByRole('textbox', { name: /authorizationName/ })).toHaveValue('Key 1')
  expect(await screen.findByLabelText(/API key/)).toHaveValue('saved-secret')
})
it('explains unavailable credentials when custom tokens are disallowed', async () => {
  const user = userEvent.setup()
  renderSwitch({
    credentials: [],
    provider: createCredentialProvider({ allow_custom_token: false }),
  })
  const button = screen.getByRole('button', { name: /credentialUnavailableInButton/ })
  await user.hover(button)
  expect(await screen.findByText('plugin.auth.credentialUnavailable')).toBeInTheDocument()
  await user.click(button)
  expect(screen.queryByLabelText(/API key/)).not.toBeInTheDocument()
})
it.each([
  { selected: { ...credential, not_allowed_to_use: true }, text: /credentialUnavailableInButton/ },
  { selected: { ...credential, from_enterprise: true }, text: 'Enterprise' },
])('displays the selected credential status: $text', ({ selected, text }) => {
  renderSwitch({ credentials: [selected], customModelCredential: selected })
  expect(screen.getByText(text)).toBeInTheDocument()
})
