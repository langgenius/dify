import {
  resolvePostLoginRedirect,
  setPostLoginRedirect,
} from '@/app/(auth)/signin/utils/post-login-redirect'
import { DeviceFlowError } from '@/service/device-flow'
import { renderDevicePage } from './device-page-fixture'

const api = vi.hoisted(() => ({
  lookup: vi.fn(),
  replace: vi.fn(),
  push: vi.fn(),
  search: new URLSearchParams(),
}))
// boundary: Next routing is supplied by the running application.
vi.mock('@/next/navigation', () => ({
  useSearchParams: () => api.search,
  useRouter: () => ({ push: api.push, replace: api.replace }),
  usePathname: () => '/device',
}))
vi.mock('@/service/device-flow', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/device-flow')>()),
  deviceLookup: api.lookup,
}))
vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'account.profile.get': async () => {
        throw new Error('No console session')
      },
    }),
  }
})
beforeEach(() => {
  api.search = new URLSearchParams()
  api.lookup.mockReset().mockResolvedValue({ valid: true })
  api.replace.mockReset().mockImplementation(() => {
    api.search = new URLSearchParams()
  })
  setPostLoginRedirect(null)
})
afterEach(() => setPostLoginRedirect(null))

it.each([
  {
    error: new Error('expired'),
    title: 'deviceFlow.errorExpired.title',
    retry: 'deviceFlow.errorExpired.tryDifferentCode',
  },
  {
    error: new DeviceFlowError('rate_limited', 429),
    title: 'deviceFlow.errorRateLimited.title',
    retry: 'deviceFlow.tryAgain',
  },
  {
    error: new DeviceFlowError('server_error', 500),
    title: 'deviceFlow.errorLookupFailed.title',
    retry: 'deviceFlow.tryAgain',
  },
])('recovers from $title with another code', async ({ error, title, retry }) => {
  api.lookup.mockRejectedValueOnce(error)
  const { screen, queryClient } = await renderDevicePage()
  onTestFinished(() => queryClient.clear())
  const code = screen.getByRole('textbox')
  await expect.element(code).toHaveFocus()
  await code.fill('ABCD-3456')
  await screen.getByRole('button', { name: 'deviceFlow.codeEntry.continue' }).click()
  await expect.element(screen.getByRole('heading', { name: title })).toBeVisible()
  expect(document.title).toBe(`${title} - Dify`)
  await screen.getByRole('button', { name: retry }).click()
  await expect.element(code).toBeVisible()
  await expect.element(screen.getByRole('heading', { name: title })).not.toBeInTheDocument()
  await code.fill('EFGH-6789')
  await screen.getByRole('button', { name: 'deviceFlow.codeEntry.continue' }).click()
  await expect
    .element(screen.getByRole('link', { name: 'deviceFlow.chooser.signInAccount' }))
    .toBeVisible()
  expect(api.lookup).toHaveBeenLastCalledWith('EFGH-6789')
})

it.each([
  { error: 'sso_failed', copy: 'deviceFlow.ssoError.default' },
  { error: 'email_belongs_to_dify_account', copy: 'deviceFlow.ssoError.emailBelongsToDifyAccount' },
])(
  'recovers from the dedicated SSO error $error using the consumed code',
  async ({ error, copy }) => {
    api.search = new URLSearchParams({ sso_error: error, user_code: 'ABCD-3456' })
    const { screen, queryClient } = await renderDevicePage()
    onTestFinished(() => queryClient.clear())
    await expect
      .element(screen.getByRole('heading', { name: 'deviceFlow.errorSso.title' }))
      .toBeVisible()
    await expect.element(screen.getByText(copy)).toBeVisible()
    await expect.element(screen.getByRole('textbox')).not.toBeInTheDocument()
    expect(api.replace).toHaveBeenCalledWith('/device')
    await screen.getByRole('button', { name: 'deviceFlow.errorSso.backToLoginOptions' }).click()
    await expect
      .element(screen.getByRole('link', { name: 'deviceFlow.chooser.signInAccount' }))
      .toBeVisible()
    expect(api.lookup).toHaveBeenCalledWith('ABCD-3456')
  },
)

it.each([false, true])(
  'preserves the code for console login and gates external SSO (available: %s)',
  async (sso) => {
    const { screen, queryClient } = await renderDevicePage({ sso })
    onTestFinished(() => queryClient.clear())
    const code = screen.getByRole('textbox')
    await expect.element(code).toHaveFocus()
    expect(document.title).toBe('deviceFlow.codeEntry.title - Dify')
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
