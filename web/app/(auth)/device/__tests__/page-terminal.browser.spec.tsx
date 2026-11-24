import type { DeviceLookupReply } from '@/service/device-flow'
import {
  resolvePostLoginRedirect,
  setPostLoginRedirect,
} from '@/app/(auth)/signin/utils/post-login-redirect'
import { apiError, installFakeApi, route } from '@/test/fake-api'
import { renderDevicePage } from './device-page-fixture'

const lookup = vi.fn<(userCode: string | null) => DeviceLookupReply | Promise<DeviceLookupReply>>()
beforeEach(() => {
  onTestFinished(
    installFakeApi({
      console: {
        account: {
          profile: {
            // The signed-out state is a failed profile probe; a 401 would start the app's
            // token refresh and sign-in redirect, which belong to the running application.
            get: () => {
              throw apiError({ status: 403, code: 'forbidden', message: 'No console session' })
            },
          },
        },
      },
      routes: [
        route('GET', 'origin', '/openapi/v1/oauth/device/lookup', ({ url }) =>
          lookup(url.searchParams.get('user_code')),
        ),
      ],
    }),
  )
  lookup.mockReset().mockResolvedValue({ valid: true, expires_in_remaining: 600, client_id: 'cli' })
  setPostLoginRedirect(null)
})
afterEach(() => setPostLoginRedirect(null))

it.each([
  {
    error: apiError({
      status: 400,
      code: 'expired_token',
      message: 'Expired',
      details: { error: 'expired_token' },
    }),
    title: 'deviceFlow.errorExpired.title',
    retry: 'deviceFlow.errorExpired.tryDifferentCode',
  },
  {
    error: apiError({
      status: 429,
      code: 'rate_limited',
      message: 'Rate limited',
      details: { error: 'rate_limited' },
    }),
    title: 'deviceFlow.errorRateLimited.title',
    retry: 'deviceFlow.tryAgain',
  },
  {
    error: apiError({
      status: 500,
      code: 'server_error',
      message: 'Server error',
      details: { error: 'server_error' },
    }),
    title: 'deviceFlow.errorLookupFailed.title',
    retry: 'deviceFlow.tryAgain',
  },
])('recovers from $title with another code', async ({ error, title, retry }) => {
  lookup.mockRejectedValueOnce(error)
  const { screen } = await renderDevicePage()
  const code = screen.getByRole('textbox')
  await expect.element(code).toHaveFocus()
  await code.fill('ABCD-3456')
  await screen.getByRole('button', { name: 'deviceFlow.codeEntry.continue' }).click()
  await expect.element(screen.getByRole('heading', { name: title })).toBeVisible()
  await expect.poll(() => document.title).toBe(`${title} - Dify`)
  await screen.getByRole('button', { name: retry }).click()
  await expect.element(code).toBeVisible()
  await expect.element(screen.getByRole('heading', { name: title })).not.toBeInTheDocument()
  await code.fill('EFGH-6789')
  await screen.getByRole('button', { name: 'deviceFlow.codeEntry.continue' }).click()
  await expect
    .element(screen.getByRole('link', { name: 'deviceFlow.chooser.signInAccount' }))
    .toBeVisible()
  expect(lookup).toHaveBeenLastCalledWith('EFGH-6789')
})

it.each([
  { error: 'sso_failed', copy: 'deviceFlow.ssoError.default' },
  { error: 'email_belongs_to_dify_account', copy: 'deviceFlow.ssoError.emailBelongsToDifyAccount' },
])(
  'recovers from the dedicated SSO error $error using the consumed code',
  async ({ error, copy }) => {
    const query = new URLSearchParams({ sso_error: error, user_code: 'ABCD-3456' })
    const { screen, navigation } = await renderDevicePage({ url: `/device?${query}` })
    await expect
      .element(screen.getByRole('heading', { name: 'deviceFlow.errorSso.title' }))
      .toBeVisible()
    await expect.element(screen.getByText(copy)).toBeVisible()
    await expect.element(screen.getByRole('textbox')).not.toBeInTheDocument()
    expect(navigation.router.replace).toHaveBeenCalledWith('/device')
    await screen.getByRole('button', { name: 'deviceFlow.errorSso.backToLoginOptions' }).click()
    await expect
      .element(screen.getByRole('link', { name: 'deviceFlow.chooser.signInAccount' }))
      .toBeVisible()
    expect(lookup).toHaveBeenCalledWith('ABCD-3456')
  },
)

it.each([false, true])(
  'preserves the code for console login and gates external SSO (available: %s)',
  async (sso) => {
    const { screen } = await renderDevicePage({ sso })
    const code = screen.getByRole('textbox')
    await expect.element(code).toHaveFocus()
    await expect.poll(() => document.title).toBe('deviceFlow.codeEntry.title - Dify')
    await expect
      .element(screen.getByRole('heading', { name: 'deviceFlow.errorSso.title' }))
      .not.toBeInTheDocument()
    await code.fill('ABCD-3456')
    await screen.getByRole('button', { name: 'deviceFlow.codeEntry.continue' }).click()
    const external = screen.getByRole('link', { name: 'deviceFlow.chooser.signInSSO' })
    if (sso)
      await expect
        .element(external)
        .toHaveAttribute('href', '/openapi/v1/oauth/device/sso-initiate?user_code=ABCD-3456')
    else await expect.element(external).not.toBeInTheDocument()
    const login = screen.getByRole('link', { name: 'deviceFlow.chooser.signInAccount' })
    await expect.element(login).toHaveAttribute('href', '/signin')
    // boundary: keep the native click inside this component test; the application owns navigation.
    login.element().addEventListener('click', (event) => event.preventDefault(), { once: true })
    await login.click()
    expect(resolvePostLoginRedirect()).toEqual({
      kind: 'internal',
      href: '/device?user_code=ABCD-3456',
    })
  },
)
