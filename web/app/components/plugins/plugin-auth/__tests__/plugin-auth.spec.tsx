import type { Credential } from '../types'
import type { ConsoleQueryTestOptions } from '@/test/console/query-data'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import PluginAuth from '../plugin-auth'
import { AuthCategory, CredentialTypeEnum } from '../types'

const requests = vi.hoisted(() => ({ credentials: vi.fn() }))
vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  get: requests.credentials,
}))

const defaultPayload = { category: AuthCategory.tool, provider: 'test-provider' }
const credential: Credential = {
  id: 'key-1',
  name: 'Production key',
  provider: 'test-provider',
  credential_type: CredentialTypeEnum.API_KEY,
  is_default: true,
  credentials: { api_key: 'masked-secret' },
}
const credentialInfo = (credentials: Credential[] = [], allowCustomToken = true) => ({
  credentials,
  supported_credential_types: [CredentialTypeEnum.API_KEY],
  allow_custom_token: allowCustomToken,
  is_oauth_custom_client_enabled: false,
})
const onUrlUpdate = vi.fn()
const renderAuth = (
  options: ConsoleQueryTestOptions = {},
  props: Partial<React.ComponentProps<typeof PluginAuth>> = {},
) =>
  renderWithConsoleQuery(
    <NuqsTestingAdapter onUrlUpdate={onUrlUpdate}>
      <PluginAuth pluginPayload={defaultPayload} {...props} />
    </NuqsTestingAdapter>,
    {
      workspacePermissionKeys: ['credential.use', 'credential.create', 'credential.manage'],
      systemFeatures: { rbac_enabled: true },
      ...options,
    },
  )

beforeEach(() => {
  requests.credentials.mockResolvedValue(credentialInfo())
})

it('offers API authorization when the provider has no saved credentials', async () => {
  renderAuth()
  expect(await screen.findByRole('button', { name: 'plugin.auth.useApiAuth' })).toBeEnabled()
  expect(requests.credentials).toHaveBeenCalledWith(
    '/workspaces/current/tool-provider/builtin/test-provider/credential/info',
  )
  expect(screen.queryByText('plugin.auth.permissionHint.title')).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: /plugin.auth.authorization$/ }),
  ).not.toBeInTheDocument()
})

it('opens the saved credentials when the provider is authorized', async () => {
  const user = userEvent.setup()
  requests.credentials.mockResolvedValue(credentialInfo([credential]))
  renderAuth()
  const trigger = await screen.findByRole('button', { name: /1.*plugin.auth.authorization/ })
  expect(screen.queryByRole('button', { name: 'plugin.auth.useApiAuth' })).not.toBeInTheDocument()
  await user.click(trigger)
  expect(await screen.findByText('Production key')).toBeVisible()
})

it('renders the caller content when the provider is authorized', async () => {
  requests.credentials.mockResolvedValue(credentialInfo([credential]))
  renderAuth({}, { children: <div>Custom Content</div> })
  expect(await screen.findByText('Custom Content')).toBeVisible()
  expect(
    screen.queryByRole('button', { name: /plugin.auth.authorization$/ }),
  ).not.toBeInTheDocument()
})

it('disables authorization without credential.create and links to members settings', async () => {
  const user = userEvent.setup()
  renderAuth({ workspacePermissionKeys: ['credential.use'] })
  expect(await screen.findByRole('button', { name: 'plugin.auth.useApiAuth' })).toBeDisabled()
  expect(screen.getByText('plugin.auth.permissionHint.title')).toBeVisible()
  expect(screen.getByText('plugin.auth.permissionHint.description')).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'plugin.auth.permissionHint.action' }))
  await waitFor(() =>
    expect(onUrlUpdate.mock.lastCall?.[0].searchParams.get('settings')).toBe('members'),
  )
})

it('does not offer tool credential permissions for a datasource', () => {
  renderAuth(
    { workspacePermissionKeys: ['credential.use'] },
    { pluginPayload: { ...defaultPayload, category: AuthCategory.datasource } },
  )
  expect(screen.queryByText('plugin.auth.permissionHint.title')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'plugin.auth.useApiAuth' })).not.toBeInTheDocument()
  expect(requests.credentials).not.toHaveBeenCalled()
})

it('disables custom credentials without a permission hint when the provider forbids them', async () => {
  requests.credentials.mockResolvedValue(credentialInfo([], false))
  renderAuth({ workspacePermissionKeys: ['credential.use'] })
  expect(await screen.findByRole('button', { name: 'plugin.auth.useApiAuth' })).toBeDisabled()
  expect(screen.queryByText('plugin.auth.permissionHint.title')).not.toBeInTheDocument()
})
