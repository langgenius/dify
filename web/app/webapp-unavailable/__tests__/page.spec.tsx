import type { consoleClient } from '@/service/console'
import { ORPCError } from '@orpc/client'
import { render, screen } from '@testing-library/react'
import { APP_UNAVAILABLE_IP_HEADER } from '@/features/app-access-error/document-constants'
import enLogin from '@/i18n/locales/en-US/login.json'
import enShare from '@/i18n/locales/en-US/share.json'
import UnavailableWebAppDocument from '../page'

const mocks = vi.hoisted(() => ({
  getProfile: vi.fn<typeof consoleClient.account.profile.get>(),
  headers: vi.fn<() => Promise<Headers>>(),
}))

vi.unmock('react-i18next')
vi.mock('server-only', () => ({}))
vi.mock('@/service/console', () => ({
  consoleClient: {
    account: { profile: { get: mocks.getProfile } },
  },
}))
vi.mock('@/service/console/server', () => ({}))
vi.mock('@/next/headers', () => ({
  headers: mocks.headers,
}))
vi.mock('@/next/navigation', () => ({
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
}))

beforeEach(() => {
  window.history.replaceState({}, '', '/webapp-unavailable?source=workflow&app=demo')
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['en-US'])
  mocks.headers.mockReset().mockResolvedValue(new Headers({ 'accept-language': 'en-US' }))
  mocks.getProfile.mockReset().mockRejectedValue(new ORPCError('UNAUTHORIZED', { status: 401 }))
})

afterEach(() => vi.restoreAllMocks())

it('shows the signed-in account and links back to My apps', async () => {
  mocks.getProfile.mockResolvedValue({
    id: 'account-id',
    name: 'Current User',
    email: 'current@example.com',
    avatar_url: null,
    is_password_set: true,
  })

  render(await UnavailableWebAppDocument())

  expect(await screen.findByRole('link', { name: 'Current User' })).toHaveAttribute(
    'href',
    '/account',
  )
  expect(
    screen.getByRole('link', { name: enShare['appNotAccessible.backToMyApps'] }),
  ).toHaveAttribute('href', '/my-apps')
  expect(screen.queryByRole('link', { name: enLogin.signBtn })).not.toBeInTheDocument()
})

it('offers anonymous users sign-in to the current URL without a My apps link', async () => {
  render(await UnavailableWebAppDocument())

  expect(
    await screen.findByRole('heading', { name: enShare['appNotAccessible.title'] }),
  ).toBeInTheDocument()
  const signIn = screen.getByRole('link', { name: enLogin.signBtn })
  const destination = new URL(signIn.getAttribute('href')!, window.location.origin)
  expect(destination.pathname).toBe('/signin')
  expect(destination.searchParams.get('redirect_url')).toBe(
    '/webapp-unavailable?source=workflow&app=demo',
  )
  expect(
    screen.queryByRole('link', { name: enShare['appNotAccessible.backToMyApps'] }),
  ).not.toBeInTheDocument()
})

it('keeps the 404 content and sign-in available when the profile service fails', async () => {
  mocks.getProfile.mockRejectedValue(new TypeError('Failed to fetch'))

  render(await UnavailableWebAppDocument())

  expect(
    await screen.findByRole('heading', { name: enShare['appNotAccessible.title'] }),
  ).toBeInTheDocument()
  expect(screen.getByRole('link', { name: enLogin.signBtn })).toBeInTheDocument()
  expect(
    screen.queryByRole('link', { name: enShare['appNotAccessible.backToMyApps'] }),
  ).not.toBeInTheDocument()
})

it('renders the anonymous 404 page when the profile request times out', async () => {
  const controller = new AbortController()
  vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal)
  const requestStarted = new Promise<void>((resolve) => {
    mocks.getProfile.mockImplementation(
      (_input, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => reject(options.signal?.reason), {
            once: true,
          })
          resolve()
        }),
    )
  })

  const page = UnavailableWebAppDocument()
  await requestStarted
  controller.abort(new DOMException('The operation timed out', 'TimeoutError'))
  render(await page)

  expect(
    await screen.findByRole('heading', { name: enShare['appNotAccessible.title'] }),
  ).toBeInTheDocument()
  expect(screen.getByRole('link', { name: enLogin.signBtn })).toBeInTheDocument()
  expect(
    screen.queryByRole('link', { name: enShare['appNotAccessible.backToMyApps'] }),
  ).not.toBeInTheDocument()
})

it('omits the IP address when the request does not provide one', async () => {
  render(await UnavailableWebAppDocument())

  await screen.findByRole('heading', { name: enShare['appNotAccessible.title'] })
  expect(screen.queryByText(/Your IP address/)).not.toBeInTheDocument()
})

it('shows the IP address supplied by the trusted request header', async () => {
  const clientIp = '198.51.100.24'
  mocks.headers.mockResolvedValue(
    new Headers({
      'accept-language': 'en-US',
      [APP_UNAVAILABLE_IP_HEADER]: clientIp,
    }),
  )

  render(await UnavailableWebAppDocument())

  expect(await screen.findByText(clientIp, { selector: 'code' })).toBeInTheDocument()
})
