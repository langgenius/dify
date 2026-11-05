import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
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
let requests: Request[]
let authenticated: boolean

async function showSignin(code = false) {
  const { wrapper: Wrapper } = createConsoleQueryWrapper({
    accountProfile: null,
    systemFeatures: { enable_email_code_login: true, enable_social_oauth_login: true },
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
  vi.unstubAllGlobals()
  window.localStorage.clear()
})

it('signs in with password then establishes a cookie account session before returning to My Apps', async () => {
  setWebAppAccessToken('legacy-bearer')
  setWebAppPassport(address, 'anonymous-history', 'anonymous')
  setWebAppPassport(address, 'previous-account-passport', 'authenticated')
  const screen = await showSignin()
  await screen.getByLabelText('login.email').fill('personal@example.com')
  await screen.getByLabelText('login.password').fill('Password123!')
  await userEvent.keyboard('{Enter}')
  await expect.poll(() => mocks.redirect.mock.calls.length).toBe(1)
  expect(await requests[1]!.json()).toMatchObject({
    mode: 'end_user',
    email: 'personal@example.com',
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
  const returnUrl = 'https://apps.example/web/chat/my-app?input=hello%20world#turn-2'
  mocks.searchParams = new URLSearchParams({
    is_end_user: '1',
    app_code: 'my-app',
    code_challenge: 'a'.repeat(43),
    redirect_url: returnUrl,
  })
  const callback = new URL('https://apps.example/web/webapp-signin')
  callback.search = new URLSearchParams({
    mode: 'end_user',
    login_code: 'single-use',
    redirect_url: returnUrl,
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
  expect(new URL(requests[0]!.url).searchParams.get('code_challenge')).toBe('a'.repeat(43))
  expect(getWebAppAccessToken()).toBe('legacy-app-session')
})

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
