import type { GetLoginData, GetLoginResponse } from '@dify/contracts/api/console/login/types.gen'
import type { GetSystemFeaturesResponse } from '@dify/contracts/api/console/system-features/types.gen'
import type { DeepPartial } from '@/test/console/system-features'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { toast } from '@/app/notifications'
import {
  getAnonymousWebAppPassport,
  getAuthenticatedWebAppPassport,
  getWebAppAccessToken,
  getWebAppLoginMode,
  setWebAppAccessToken,
  setWebAppPassport,
} from '@/service/webapp-auth'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { apiError, setupFakeApi } from '@/test/fake-api'
import { createTestNavigation } from '@/test/next-navigation'
import CheckCode from '../check-code/page'
import NormalForm from '../normal-form'

const mocks = vi.hoisted(() => ({
  searchParams: new URLSearchParams(),
  redirect: vi.fn(),
  basePath: '/portal',
}))

vi.mock('@/utils/var', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/var')>()),
  get basePath() {
    return mocks.basePath
  },
}))
vi.mock('@/utils/login-redirect.client', () => ({ replaceLoginRedirect: mocks.redirect }))
// boundary: keeps real login requests independent of analytics.
vi.mock('@/app/components/base/amplitude', () => ({ trackEvent: vi.fn() }))
// boundary: selects a fixed locale for the sign-in form.
vi.mock('#i18n', () => ({ useLocale: () => 'en-US' }))

const address = { kind: 'default', code: 'personal-login-test' } as const
const destination = '/my-apps?search=hello%20world&tag=workflow#recent'
const accountDestination = () => `${mocks.basePath}${destination}`
const appLoginTarget = {
  is_end_user: '1',
  app_code: 'my-app',
  code_challenge: 'a'.repeat(43),
  code_challenge_method: 'S256',
  redirect_url: '/chat/my-app?input=hello%20world#turn-2',
}
const appReturnUrl = `https://apps.example/web${appLoginTarget.redirect_url}`
const appFeatures = { webapp_url: 'https://apps.example/web' }
let requests: { method: 'GET' | 'POST'; query?: GetLoginData['query']; body?: unknown }[]
let authenticated: boolean
let navigation: ReturnType<typeof createTestNavigation>

const loginStatus = vi.fn<(query: GetLoginData['query']) => GetLoginResponse>()
const signIn = (body: unknown) => {
  authenticated = true
  requests.push({ method: 'POST', body })
  return { result: 'success' }
}
setupFakeApi({
  console: {
    login: {
      get: ({ query }: Pick<GetLoginData, 'query'> = {}) => {
        requests.push({ method: 'GET', query })
        return loginStatus(query)
      },
      post: ({ body }) => signIn(body),
    },
    emailCodeLogin: { validity: { post: ({ body }) => signIn(body) } },
  },
})

async function showSignin(
  code = false,
  systemFeatures: DeepPartial<GetSystemFeaturesResponse> = {},
) {
  const { wrapper: Wrapper } = createConsoleQueryWrapper({
    accountProfile: null,
    systemFeatures: {
      enable_email_code_login: true,
      enable_social_oauth_login: true,
      webapp_url: mocks.basePath,
      ...systemFeatures,
    },
  })
  navigation.navigate(`/signin?${mocks.searchParams}`)
  const { NavigationProvider } = navigation
  return render(
    <Wrapper>
      <NavigationProvider>{code ? <CheckCode /> : <NormalForm />}</NavigationProvider>
    </Wrapper>,
  )
}

beforeEach(() => {
  mocks.basePath = '/portal'
  mocks.searchParams = new URLSearchParams({ is_end_user: '1', redirect_url: destination })
  mocks.redirect.mockReset()
  navigation = createTestNavigation({ url: '/signin' })
  requests = []
  authenticated = false
  window.localStorage.clear()
  loginStatus.mockReset().mockImplementation((query) => ({
    logged_in: authenticated,
    redirect_url: authenticated ? (query?.redirect_url ?? null) : null,
  }))
})

afterEach(() => {
  vi.restoreAllMocks()
  window.localStorage.clear()
})

it.each(['Console path', 'absolute Webapp URL'])(
  'returns to My Apps when the session API responds with the %s',
  async (responseKind) => {
    authenticated = true
    const webappUrl = 'https://apps.example/web'
    if (responseKind === 'absolute Webapp URL') {
      loginStatus.mockReturnValueOnce({
        logged_in: true,
        redirect_url: `${webappUrl}${destination}`,
      })
    }
    await showSignin(false, { webapp_url: webappUrl })

    await expect.poll(() => mocks.redirect.mock.calls.length).toBe(1)
    expect(mocks.redirect.mock.calls[0]![0]).toEqual({
      kind: 'absolute',
      href: `${webappUrl}${destination}`,
    })
    expect(requests).toHaveLength(1)
    expect(requests[0]!.method).toBe('GET')
    expect(requests[0]!.query).toEqual({
      mode: 'end_user',
      redirect_url: accountDestination(),
    })
    expect(navigation.router.replace).not.toHaveBeenCalled()
  },
)

it('signs in with password then establishes a cookie account session before returning to My Apps', async () => {
  mocks.searchParams.set('mode', 'console')
  setWebAppAccessToken('legacy-bearer')
  setWebAppPassport(address, 'anonymous-history', 'anonymous')
  setWebAppPassport(address, 'previous-account-passport', 'authenticated')
  const screen = await showSignin()
  await screen.getByLabelText('login.email').fill('personal@example.com')
  await screen.getByLabelText('login.password').fill('Password123!')
  await userEvent.keyboard('{Enter}')
  await expect.poll(() => mocks.redirect.mock.calls.length).toBe(1)
  expect(requests[1]!.body).toEqual({
    mode: 'end_user',
    email: 'personal@example.com',
    password: expect.any(String),
    remember_me: true,
  })
  const resume = new URL(mocks.redirect.mock.calls[0]![0].href)
  expect(resume.pathname).toBe('/portal/signin')
  expect(resume.searchParams.get('redirect_url')).toBe(destination)
  await screen.unmount()
  mocks.searchParams = resume.searchParams
  mocks.redirect.mockImplementation(() => {
    expect(getWebAppAccessToken()).toBe('')
    expect(getWebAppLoginMode()).toBe('end_user')
    expect(getAuthenticatedWebAppPassport(address)).toBe('')
    expect(getAnonymousWebAppPassport(address)).toBe('anonymous-history')
  })
  await showSignin()
  await expect.poll(() => mocks.redirect.mock.calls.length).toBe(2)
  expect(mocks.redirect.mock.calls[1]![0]).toEqual({
    kind: 'absolute',
    href: new URL(accountDestination(), location.origin).href,
  })
  expect(requests[2]!.query).toEqual({
    mode: 'end_user',
    redirect_url: accountDestination(),
  })
  expect(requests.map((request) => request.method)).toEqual(['GET', 'POST', 'GET'])
  expect(navigation.router.replace).not.toHaveBeenCalled()
})

it('returns email-code login through signin with its personal destination intact', async () => {
  mocks.searchParams.set('email', 'personal@example.com')
  mocks.searchParams.set('token', '00000000-0000-4000-8000-000000000001')
  const screen = await showSignin(true)
  await screen.getByRole('textbox').fill('123456')
  await userEvent.keyboard('{Enter}')
  await expect.poll(() => mocks.redirect.mock.calls.length).toBe(1)
  expect(requests[0]!.body).toMatchObject({
    mode: 'end_user',
    email: 'personal@example.com',
  })
  const resume = new URL(mocks.redirect.mock.calls[0]![0].href)
  expect(resume.pathname).toBe('/portal/signin')
  expect(resume.searchParams.get('redirect_url')).toBe(destination)
  await screen.unmount()
  mocks.searchParams = resume.searchParams
  await showSignin()
  await expect.poll(() => mocks.redirect.mock.calls.length).toBe(2)
  expect(mocks.redirect.mock.calls[1]![0].href).toBe(
    new URL(accountDestination(), location.origin).href,
  )
})

it('preserves the My Apps challenge across password login and returns the one-use code', async () => {
  const challenge = 'b'.repeat(43)
  mocks.searchParams.set('code_challenge', challenge)
  mocks.searchParams.set('code_challenge_method', 'S256')
  setWebAppAccessToken('legacy-bearer')
  const screen = await showSignin(false, appFeatures)
  await screen.getByLabelText('login.email').fill('personal@example.com')
  await screen.getByLabelText('login.password').fill('Password123!')
  await userEvent.keyboard('{Enter}')

  await expect.poll(() => mocks.redirect.mock.calls.length).toBe(1)
  const resume = new URL(mocks.redirect.mock.calls[0]![0].href)
  expect(resume.searchParams.get('redirect_url')).toBe(destination)
  expect(resume.searchParams.get('code_challenge')).toBe(challenge)
  await screen.unmount()

  mocks.searchParams = resume.searchParams
  const webReturn = new URL(`${appFeatures.webapp_url}${destination}`)
  loginStatus.mockReturnValueOnce({
    logged_in: true,
    redirect_url: webReturn.href,
    login_code: 'one-use-portal-code',
  })
  await showSignin(false, appFeatures)

  await expect.poll(() => mocks.redirect.mock.calls.length).toBe(2)
  expect(requests[2]!.query).toEqual({
    mode: 'end_user',
    redirect_url: destination,
    code_challenge: challenge,
  })
  const callback = new URL(mocks.redirect.mock.calls[1]![0].href)
  expect(callback.origin).toBe(webReturn.origin)
  expect(callback.pathname).toBe('/web/my-apps')
  expect(callback.hash).toBe('#recent')
  expect(callback.searchParams.get('search')).toBe('hello world')
  expect(callback.searchParams.get('login_code')).toBe('one-use-portal-code')
  expect(getWebAppAccessToken()).toBe('legacy-bearer')
})

it('preserves personal mode and the complete return URL across OAuth', async () => {
  const screen = await showSignin()
  const github = screen.getByRole('link', { name: 'login.withGitHub' })
  await expect.element(github).toBeVisible()
  const oauth = new URL(github.element().getAttribute('href')!)
  expect(oauth.searchParams.get('mode')).toBe('end_user')
  const resume = new URL(oauth.searchParams.get('redirect_url')!, location.origin)
  expect(resume.pathname).toBe('/portal/signin')
  expect(resume.searchParams.get('is_end_user')).toBe('1')
  expect(resume.searchParams.get('redirect_url')).toBe(destination)
  await screen.unmount()
  authenticated = true
  mocks.searchParams = resume.searchParams
  await showSignin()
  await expect.poll(() => mocks.redirect.mock.calls.length).toBe(1)
  expect(mocks.redirect.mock.calls[0]![0].href).toBe(
    new URL(accountDestination(), location.origin).href,
  )
})

it('preserves the App PKCE handoff without starting a personal session early', async () => {
  mocks.searchParams = new URLSearchParams(appLoginTarget)
  const callback = new URL('https://apps.example/web/webapp-signin')
  callback.search = new URLSearchParams({
    mode: 'end_user',
    login_code: 'single-use',
    redirect_url: appReturnUrl,
  }).toString()
  loginStatus.mockReturnValue({ logged_in: true, redirect_url: callback.href })
  setWebAppAccessToken('legacy-app-session')
  await showSignin(false, appFeatures)
  await expect.poll(() => mocks.redirect.mock.calls.length).toBe(1)
  const target = new URL(mocks.redirect.mock.calls[0]![0].href)
  expect(target.origin).toBe('https://apps.example')
  expect(target.pathname).toBe('/web/chat/my-app')
  expect(target.searchParams.get('login_code')).toBe('single-use')
  expect(target.hash).toBe('#turn-2')
  expect(requests[0]!.query).toEqual({
    mode: 'end_user',
    app_code: appLoginTarget.app_code,
    code_challenge: appLoginTarget.code_challenge,
    redirect_url: appReturnUrl,
  })
  expect(requests).toHaveLength(1)
  expect(getWebAppAccessToken()).toBe('legacy-app-session')
})

it('returns password login through Account sign-in with the complete App PKCE handoff intact', async () => {
  mocks.searchParams = new URLSearchParams(appLoginTarget)
  const callback = new URL('https://apps.example/web/webapp-signin')
  callback.search = new URLSearchParams({
    mode: 'end_user',
    redirect_url: appReturnUrl,
    login_code: 'one-use-code',
  }).toString()
  loginStatus.mockImplementation(() => ({
    logged_in: authenticated,
    redirect_url: authenticated ? callback.href : null,
  }))
  const screen = await showSignin(false, appFeatures)
  await screen.getByLabelText('login.email').fill('personal@example.com')
  await screen.getByLabelText('login.password').fill('Password123!')
  await screen.getByRole('button', { name: 'login.signBtn' }).click()

  await expect.poll(() => mocks.redirect.mock.calls.length).toBe(1)
  const resume = new URL(mocks.redirect.mock.calls[0]![0].href)
  expect(resume.pathname).toBe('/portal/signin')
  expect(Object.fromEntries(resume.searchParams)).toEqual(appLoginTarget)
  await screen.unmount()
  mocks.searchParams = resume.searchParams
  await showSignin(false, appFeatures)

  await expect.poll(() => mocks.redirect.mock.calls.length).toBe(2)
  const target = new URL(mocks.redirect.mock.calls[1]![0].href)
  expect(target.origin).toBe('https://apps.example')
  expect(target.pathname).toBe('/web/chat/my-app')
  expect(target.hash).toBe('#turn-2')
  expect(Object.fromEntries(target.searchParams)).toEqual({
    input: 'hello world',
    mode: 'end_user',
    login_code: 'one-use-code',
    redirect_url: appReturnUrl,
  })
  expect(requests.map((request) => request.method)).toEqual(['GET', 'POST', 'GET'])
  expect(navigation.router.replace).not.toHaveBeenCalled()
})

it('shows the Account handoff error without a duplicate toast', async () => {
  mocks.searchParams = new URLSearchParams(appLoginTarget)
  const errorToast = vi.spyOn(toast, 'error')
  loginStatus.mockImplementation(() => {
    throw apiError({
      code: 'web_login_unavailable',
      status: 503,
      message: 'Account sign-in is unavailable.',
    })
  })
  const screen = await showSignin(false, appFeatures)

  await expect.element(screen.getByText('share.common.appUnknownError')).toBeVisible()
  await expect
    .element(screen.getByRole('button', { name: 'login.signBtn' }))
    .not.toBeInTheDocument()
  expect(requests).toHaveLength(1)
  expect(requests[0]!.method).toBe('GET')
  expect(errorToast).not.toHaveBeenCalled()
  expect(mocks.redirect).not.toHaveBeenCalled()
})

it.each(['return URL', 'origin'] as const)(
  'rejects an App Account callback with a mismatched %s',
  async (mismatch) => {
    mocks.searchParams = new URLSearchParams(appLoginTarget)
    const callback = new URL('https://apps.example/web/webapp-signin')
    callback.search = new URLSearchParams({
      mode: 'end_user',
      redirect_url:
        mismatch === 'return URL' ? 'https://apps.example/web/chat/another-app' : appReturnUrl,
      login_code: 'unexpected-code',
    }).toString()
    if (mismatch === 'origin') callback.hostname = 'untrusted.example'
    loginStatus.mockReturnValue({ logged_in: true, redirect_url: callback.href })
    const screen = await showSignin(false, appFeatures)

    await expect.element(screen.getByText('share.common.appUnknownError')).toBeVisible()
    expect(mocks.redirect).not.toHaveBeenCalled()
    expect(navigation.router.replace).not.toHaveBeenCalled()
  },
)

it('only offers supported End User methods without workspace admission or sign-up', async () => {
  const screen = await showSignin(false, {
    sso_enforced_for_signin: true,
    sso_enforced_for_signin_protocol: 'oidc',
    is_allow_register: true,
  })

  await expect.element(screen.getByRole('button', { name: 'login.signBtn' })).toBeVisible()
  await expect
    .element(screen.getByRole('button', { name: 'login.withSSO' }))
    .not.toBeInTheDocument()
  await expect
    .element(screen.getByRole('link', { name: 'login.signup.signUp' }))
    .not.toBeInTheDocument()
  expect(requests).toHaveLength(1)
  expect(navigation.router.replace).not.toHaveBeenCalled()
})

it('shows unavailable login methods when only unsupported enterprise SSO is configured', async () => {
  const screen = await showSignin(false, {
    sso_enforced_for_signin: true,
    sso_enforced_for_signin_protocol: 'saml',
    enable_email_code_login: false,
    enable_email_password_login: false,
    enable_social_oauth_login: false,
  })

  await expect.element(screen.getByText('login.noLoginMethod')).toBeVisible()
  await expect
    .element(screen.getByRole('button', { name: 'login.withSSO' }))
    .not.toBeInTheDocument()
  expect(navigation.router.replace).not.toHaveBeenCalled()
})

it.each(['redirect_url', 'code_challenge'])(
  'does not fall back to Console sign-in when the App handoff is missing %s',
  async (missing) => {
    mocks.searchParams = new URLSearchParams(appLoginTarget)
    mocks.searchParams.delete(missing)
    const screen = await showSignin(false, appFeatures)

    await expect.element(screen.getByText('share.common.appUnknownError')).toBeVisible()
    await expect
      .element(screen.getByRole('button', { name: 'login.signBtn' }))
      .not.toBeInTheDocument()
    expect(requests).toHaveLength(0)
    expect(navigation.router.replace).not.toHaveBeenCalled()
  },
)

it.each([
  'https://evil.example/portal/my-apps',
  '//evil.example/portal/my-apps',
  '/portal/signin',
  '/portal/chat/app',
])(
  'rejects unsafe or incomplete login context %s before showing credentials',
  async (redirectUrl) => {
    mocks.searchParams.set('redirect_url', redirectUrl)
    const screen = await showSignin()
    await expect.element(screen.getByText('share.common.appUnknownError')).toBeVisible()
    expect(requests).toHaveLength(0)
    expect(mocks.redirect).not.toHaveBeenCalled()
  },
)

it('rejects an unexpected personal response destination without clearing the current account', async () => {
  setWebAppAccessToken('current-account')
  loginStatus.mockReturnValue({
    logged_in: true,
    redirect_url: 'https://evil.example/portal/my-apps',
  })
  const screen = await showSignin()
  await expect.element(screen.getByText('share.common.appUnknownError')).toBeVisible()
  expect(mocks.redirect).not.toHaveBeenCalled()
  expect(getWebAppAccessToken()).toBe('current-account')
})
