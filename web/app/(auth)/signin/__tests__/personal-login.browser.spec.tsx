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
import CheckCode from '../check-code/page'
import NormalForm from '../normal-form'

const mocks = vi.hoisted(() => ({
  searchParams: new URLSearchParams(),
  replace: vi.fn(),
  push: vi.fn(),
  redirect: vi.fn(),
  basePath: '/portal',
}))

vi.mock('@/next/navigation', () => ({
  useSearchParams: () => mocks.searchParams,
  useRouter: () => ({ replace: mocks.replace, push: mocks.push, back: vi.fn() }),
}))
vi.mock('@/utils/var', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/var')>()),
  get basePath() {
    return mocks.basePath
  },
}))
vi.mock('@/utils/login-redirect.client', () => ({ replaceLoginRedirect: mocks.redirect }))
vi.mock('@/app/components/base/amplitude', () => ({ trackEvent: vi.fn() }))
vi.mock('#i18n', () => ({ useLocale: () => 'en-US' }))

const address = { kind: 'default', code: 'personal-login-test' } as const
const destination = '/portal/my-apps?search=hello%20world&tag=workflow#recent'
const appLoginTarget = {
  is_end_user: '1',
  app_code: 'my-app',
  code_challenge: 'a'.repeat(43),
  code_challenge_method: 'S256',
  redirect_url: 'https://apps.example/web/chat/my-app?input=hello%20world#turn-2',
}
let requests: Request[]
let authenticated: boolean

async function showSignin(
  code = false,
  systemFeatures: DeepPartial<GetSystemFeaturesResponse> = {},
) {
  const { wrapper: Wrapper } = createConsoleQueryWrapper({
    accountProfile: null,
    systemFeatures: {
      enable_email_code_login: true,
      enable_social_oauth_login: true,
      ...systemFeatures,
    },
  })
  return render(<Wrapper>{code ? <CheckCode /> : <NormalForm />}</Wrapper>)
}

beforeEach(() => {
  mocks.basePath = '/portal'
  mocks.searchParams = new URLSearchParams({ is_end_user: '1', redirect_url: destination })
  mocks.redirect.mockReset()
  mocks.replace.mockReset()
  mocks.push.mockReset()
  requests = []
  authenticated = false
  window.localStorage.clear()
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init)
      requests.push(request.clone())
      const url = new URL(request.url)
      if (request.method === 'GET' && url.pathname.endsWith('/login'))
        return Response.json({
          logged_in: authenticated,
          redirect_url: authenticated ? destination : null,
        })
      if (
        request.method === 'POST' &&
        /\/(?:login|email-code-login\/validity)$/.test(url.pathname)
      ) {
        authenticated = true
        return Response.json({ result: 'success' })
      }
      throw new Error(`Unexpected request: ${request.method} ${request.url}`)
    }),
  )
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  window.localStorage.clear()
})

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
  expect(await requests[1]!.json()).toEqual({
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
    href: new URL(destination, location.origin).href,
  })
  expect(Object.fromEntries(new URL(requests[2]!.url).searchParams)).toEqual({
    mode: 'end_user',
    redirect_url: destination,
  })
  expect(requests.map((request) => request.method)).toEqual(['GET', 'POST', 'GET'])
  expect(mocks.replace).not.toHaveBeenCalled()
})

it('returns email-code login through signin with its personal destination intact', async () => {
  mocks.searchParams.set('email', 'personal@example.com')
  mocks.searchParams.set('token', '00000000-0000-4000-8000-000000000001')
  const screen = await showSignin(true)
  await screen.getByRole('textbox').fill('123456')
  await userEvent.keyboard('{Enter}')
  await expect.poll(() => mocks.redirect.mock.calls.length).toBe(1)
  expect(await requests[0]!.json()).toMatchObject({
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
  expect(mocks.redirect.mock.calls[1]![0].href).toBe(new URL(destination, location.origin).href)
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
  expect(mocks.redirect.mock.calls[0]![0].href).toBe(new URL(destination, location.origin).href)
})

it('preserves the App PKCE handoff without starting a personal session early', async () => {
  mocks.searchParams = new URLSearchParams(appLoginTarget)
  const callback = new URL('https://apps.example/web/webapp-signin')
  callback.search = new URLSearchParams({
    mode: 'end_user',
    login_code: 'single-use',
    redirect_url: appLoginTarget.redirect_url,
  }).toString()
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    requests.push(new Request(input, init))
    return Response.json({ logged_in: true, redirect_url: callback.href })
  })
  setWebAppAccessToken('legacy-app-session')
  await showSignin()
  await expect.poll(() => mocks.redirect.mock.calls.length).toBe(1)
  const target = new URL(mocks.redirect.mock.calls[0]![0].href)
  expect(target.origin).toBe('https://apps.example')
  expect(target.pathname).toBe('/web/chat/my-app')
  expect(target.searchParams.get('login_code')).toBe('single-use')
  expect(target.hash).toBe('#turn-2')
  expect(Object.fromEntries(new URL(requests[0]!.url).searchParams)).toEqual({
    mode: 'end_user',
    app_code: appLoginTarget.app_code,
    code_challenge: appLoginTarget.code_challenge,
    redirect_url: appLoginTarget.redirect_url,
  })
  expect(requests).toHaveLength(1)
  expect(getWebAppAccessToken()).toBe('legacy-app-session')
})

it('returns password login through Account sign-in with the complete App PKCE handoff intact', async () => {
  mocks.searchParams = new URLSearchParams(appLoginTarget)
  const callback = new URL('https://apps.example/web/webapp-signin')
  callback.search = new URLSearchParams({
    mode: 'end_user',
    redirect_url: appLoginTarget.redirect_url,
    login_code: 'one-use-code',
  }).toString()
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    const request = new Request(input, init)
    requests.push(request)
    if (request.method === 'POST') {
      authenticated = true
      return Response.json({ result: 'success' })
    }
    return Response.json({
      logged_in: authenticated,
      redirect_url: authenticated ? callback.href : null,
    })
  })
  const screen = await showSignin()
  await screen.getByLabelText('login.email').fill('personal@example.com')
  await screen.getByLabelText('login.password').fill('Password123!')
  await screen.getByRole('button', { name: 'login.signBtn' }).click()

  await expect.poll(() => mocks.redirect.mock.calls.length).toBe(1)
  const resume = new URL(mocks.redirect.mock.calls[0]![0].href)
  expect(resume.pathname).toBe('/portal/signin')
  expect(Object.fromEntries(resume.searchParams)).toEqual(appLoginTarget)
  await screen.unmount()
  mocks.searchParams = resume.searchParams
  await showSignin()

  await expect.poll(() => mocks.redirect.mock.calls.length).toBe(2)
  const target = new URL(mocks.redirect.mock.calls[1]![0].href)
  expect(target.origin).toBe('https://apps.example')
  expect(target.pathname).toBe('/web/chat/my-app')
  expect(target.hash).toBe('#turn-2')
  expect(Object.fromEntries(target.searchParams)).toEqual({
    input: 'hello world',
    mode: 'end_user',
    login_code: 'one-use-code',
    redirect_url: appLoginTarget.redirect_url,
  })
  expect(requests.map((request) => request.method)).toEqual(['GET', 'POST', 'GET'])
  expect(mocks.replace).not.toHaveBeenCalled()
})

it('shows the Account handoff error without a duplicate toast', async () => {
  mocks.searchParams = new URLSearchParams(appLoginTarget)
  const errorToast = vi.spyOn(toast, 'error')
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    requests.push(new Request(input, init))
    return Response.json(
      { code: 'web_login_unavailable', status: 503, message: 'Account sign-in is unavailable.' },
      { status: 503 },
    )
  })
  const screen = await showSignin()

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
        mismatch === 'return URL'
          ? 'https://apps.example/web/chat/another-app'
          : appLoginTarget.redirect_url,
      login_code: 'unexpected-code',
    }).toString()
    if (mismatch === 'origin') callback.hostname = 'untrusted.example'
    vi.mocked(fetch).mockResolvedValue(
      Response.json({ logged_in: true, redirect_url: callback.href }),
    )
    const screen = await showSignin()

    await expect.element(screen.getByText('share.common.appUnknownError')).toBeVisible()
    expect(mocks.redirect).not.toHaveBeenCalled()
    expect(mocks.replace).not.toHaveBeenCalled()
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
  expect(fetch).toHaveBeenCalledOnce()
  expect(mocks.replace).not.toHaveBeenCalled()
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
  expect(mocks.replace).not.toHaveBeenCalled()
})

it.each(['redirect_url', 'code_challenge'])(
  'does not fall back to Console sign-in when the App handoff is missing %s',
  async (missing) => {
    mocks.searchParams = new URLSearchParams(appLoginTarget)
    mocks.searchParams.delete(missing)
    const screen = await showSignin()

    await expect.element(screen.getByText('share.common.appUnknownError')).toBeVisible()
    await expect
      .element(screen.getByRole('button', { name: 'login.signBtn' }))
      .not.toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalled()
    expect(mocks.replace).not.toHaveBeenCalled()
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
    expect(fetch).not.toHaveBeenCalled()
    expect(mocks.redirect).not.toHaveBeenCalled()
  },
)

it('rejects an unexpected personal response destination without clearing the current account', async () => {
  setWebAppAccessToken('current-account')
  vi.mocked(fetch).mockResolvedValue(
    Response.json({ logged_in: true, redirect_url: 'https://evil.example/portal/my-apps' }),
  )
  const screen = await showSignin()
  await expect.element(screen.getByText('share.common.appUnknownError')).toBeVisible()
  expect(mocks.redirect).not.toHaveBeenCalled()
  expect(getWebAppAccessToken()).toBe('current-account')
})
