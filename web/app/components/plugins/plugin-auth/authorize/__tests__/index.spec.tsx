import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { AuthCategory } from '../../types'
import Authorize from '../index'

const requests = vi.hoisted(() => ({ authorize: vi.fn(), popup: vi.fn() }))
vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  get: (url: string, options: unknown) => {
    if (url.endsWith('/oauth/client-schema'))
      return Promise.resolve({
        schema: [],
        is_system_oauth_params_exists: true,
        is_oauth_custom_client_enabled: false,
      })
    return requests.authorize(url, options)
  },
}))
vi.mock('@/hooks/use-oauth', () => ({ openOAuthPopup: requests.popup }))
const pluginPayload = { category: AuthCategory.tool, provider: 'test-provider' }
const permissions = ['credential.use', 'credential.create', 'credential.manage']

beforeEach(() =>
  requests.authorize.mockResolvedValue({ authorization_url: 'https://auth.example.test' }),
)

it.each([
  [false, false, null, null],
  [true, false, 'plugin.auth.useOAuthAuth', null],
  [false, true, null, 'plugin.auth.useApiAuth'],
  [true, true, 'plugin.auth.addOAuth', 'plugin.auth.common.addApiKey'],
] as const)(
  'exposes the supported authorization methods (OAuth=%s, API key=%s)',
  async (canOAuth, canApiKey, oauthLabel, apiLabel) => {
    render(<Authorize pluginPayload={pluginPayload} canOAuth={canOAuth} canApiKey={canApiKey} />, {
      workspacePermissionKeys: permissions,
    })
    if (oauthLabel) expect(await screen.findByRole('button', { name: oauthLabel })).toBeEnabled()
    else
      expect(
        screen.queryByRole('button', { name: /plugin.auth.(useOAuthAuth|addOAuth|setupOAuth)/ }),
      ).not.toBeInTheDocument()
    if (apiLabel) expect(screen.getByRole('button', { name: apiLabel })).toBeEnabled()
    else
      expect(
        screen.queryByRole('button', { name: /plugin.auth.(useApiAuth|addApi)/ }),
      ).not.toBeInTheDocument()
  },
)

it.each([
  [false, false],
  [true, true],
  [false, true],
])(
  'blocks authorization when credential.create=%s and unavailable=%s',
  async (canCreate, unavailable) => {
    const user = userEvent.setup()
    const onApiKeyClick = vi.fn()
    render(
      <Authorize
        pluginPayload={pluginPayload}
        canOAuth
        canApiKey
        notAllowCustomCredential={unavailable}
        onApiKeyClick={onApiKeyClick}
      />,
      {
        workspacePermissionKeys: canCreate ? permissions : ['credential.use'],
      },
    )
    const oauth = await screen.findByRole('button', { name: 'plugin.auth.addOAuth' })
    const api = screen.getByRole('button', { name: 'plugin.auth.common.addApiKey' })
    expect(oauth).toBeDisabled()
    expect(api).toBeDisabled()
    expect(screen.getByRole('button', { name: 'plugin.auth.oauthClientSettings' })).toBeDisabled()
    await user.click(oauth)
    await user.click(api)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(onApiKeyClick).not.toHaveBeenCalled()
    expect(requests.authorize).not.toHaveBeenCalled()
  },
)

it('delegates API key opening to its parent once credentials become available', async () => {
  const user = userEvent.setup()
  const onApiKeyClick = vi.fn()
  const { rerender } = render(
    <Authorize
      pluginPayload={pluginPayload}
      canApiKey
      notAllowCustomCredential
      onApiKeyClick={onApiKeyClick}
    />,
    { workspacePermissionKeys: permissions },
  )
  expect(screen.getByRole('button', { name: 'plugin.auth.useApiAuth' })).toBeDisabled()
  rerender(<Authorize pluginPayload={pluginPayload} canApiKey onApiKeyClick={onApiKeyClick} />)
  await user.click(screen.getByRole('button', { name: 'plugin.auth.useApiAuth' }))
  expect(onApiKeyClick).toHaveBeenCalledOnce()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

it('passes the selected provider and visibility through authorization and reports completion', async () => {
  const user = userEvent.setup()
  const onUpdate = vi.fn()
  render(<Authorize pluginPayload={pluginPayload} canOAuth onUpdate={onUpdate} />, {
    workspacePermissionKeys: permissions,
  })
  await user.click(await screen.findByRole('button', { name: 'plugin.auth.useOAuthAuth' }))
  await user.click(screen.getByRole('button', { name: 'plugin.auth.authorize' }))
  await waitFor(() => expect(requests.popup).toHaveBeenCalledOnce())
  expect(requests.authorize).toHaveBeenCalledExactlyOnceWith(
    '/oauth/plugin/test-provider/tool/authorization-url',
    { params: { visibility: 'only_me' } },
  )
  expect(onUpdate).not.toHaveBeenCalled()
  requests.popup.mock.calls[0]![1]()
  expect(onUpdate).toHaveBeenCalledOnce()
})
