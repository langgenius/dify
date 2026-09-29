import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { renderToString } from 'react-dom/server'
import { I18nextProvider } from 'react-i18next'
import enCommon from '@/i18n/locales/en-US/common.json'
import enLogin from '@/i18n/locales/en-US/login.json'
import enShare from '@/i18n/locales/en-US/share.json'
import jaCommon from '@/i18n/locales/ja-JP/common.json'
import jaLogin from '@/i18n/locales/ja-JP/login.json'
import jaShare from '@/i18n/locales/ja-JP/share.json'
import zhLogin from '@/i18n/locales/zh-Hans/login.json'
import zhShare from '@/i18n/locales/zh-Hans/share.json'
import { getBrowserLocale } from '../locale'
import AppNotAccessible from '../page'

vi.unmock('react-i18next')
vi.mock('@/next/navigation', () => ({
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
}))

beforeEach(() => {
  window.history.replaceState({}, '', '/chat/app')
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['en-US'])
  document.title = 'Previous title'
  document.cookie = 'locale=zh-Hans'
})
afterEach(() => vi.restoreAllMocks())

it('server-renders the document title text and IP from preloaded browser-language resources', () => {
  const html = renderToString(
    <AppNotAccessible
      clientIp="192.0.2.81"
      initialLocale="ja-JP"
      initialResources={{
        'en-US': { share: enShare, common: enCommon, login: enLogin },
        'ja-JP': { share: jaShare, common: jaCommon, login: jaLogin },
      }}
    />,
  )
  expect(html).toMatch(new RegExp(`<h1[^>]*>${jaShare['appNotAccessible.title']}</h1>`))
  expect(html).toMatch(/<code[^>]*>192\.0\.2\.81<\/code>/)
  expect(html).not.toContain(enShare['appNotAccessible.title'])
})

it.each([
  ['en-GB', enShare, enLogin],
  ['zh-CN', zhShare, zhLogin],
  ['ja', jaShare, jaLogin],
])('uses browser language %s for exact page and document copy', async (language, copy, login) => {
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue([language])
  const parent = createInstance()
  await parent.init({ lng: 'zh-Hans' })
  render(
    <I18nextProvider i18n={parent}>
      <AppNotAccessible clientIp="2001:db8::12" />
    </I18nextProvider>,
  )
  expect(
    await screen.findByRole('heading', { name: copy['appNotAccessible.title'] }),
  ).toBeInTheDocument()
  expect(screen.getByText(copy['appNotAccessible.description'])).toBeInTheDocument()
  expect(screen.getByRole('link', { name: login.signBtn })).toHaveAttribute(
    'href',
    '/signin?redirect_url=%2Fchat%2Fapp',
  )
  expect(screen.getByText('2001:db8::12', { selector: 'code' }).closest('p')?.textContent).toBe(
    copy['appNotAccessible.ipAddress'].replace('<ip>{{ip}}</ip>', '2001:db8::12'),
  )
  await waitFor(() => expect(document.title).toBe(copy['appNotAccessible.documentTitle']))
  expect(parent.language).toBe('zh-Hans')
})

it.each([undefined, '', 'unknown', '203.0.113.1, 192.0.2.1', '999.1.1.1'])(
  'omits the IP sentence for %s',
  async (clientIp) => {
    render(<AppNotAccessible clientIp={clientIp} />)
    await screen.findByRole('heading', { name: enShare['appNotAccessible.title'] })
    expect(screen.queryByText(/Your IP address/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument()
  },
)

it('changes only the error-page language, retaining the IP and restoring the title on exit', async () => {
  const user = userEvent.setup()
  const { unmount } = render(<AppNotAccessible clientIp="203.0.113.8" />)
  await user.click(await screen.findByRole('button', { name: 'English' }))
  await user.click(screen.getByRole('menuitemradio', { name: '日本語 (日本)' }))
  expect(
    await screen.findByRole('heading', { name: jaShare['appNotAccessible.title'] }),
  ).toBeInTheDocument()
  await waitFor(() => expect(document.title).toBe(jaShare['appNotAccessible.documentTitle']))
  expect(screen.getByText('203.0.113.8', { selector: 'code' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: jaLogin.signBtn })).toHaveAttribute(
    'href',
    '/signin?redirect_url=%2Fchat%2Fapp',
  )
  expect(document.cookie).toContain('locale=zh-Hans')
  unmount()
  expect(document.title).toBe('Previous title')
})

it.each([
  '/environment/workflow/app?conversation=123&name=%E6%B5%8B%E8%AF%95',
  '/agents/app/access',
  '/form/test-token',
])('keeps the current access address %s as the sign-in return target', async (path) => {
  window.history.replaceState({}, '', path)
  render(<AppNotAccessible />)
  const link = await screen.findByRole('link', { name: enLogin.signBtn })
  const destination = new URL(link.getAttribute('href')!, window.location.origin)
  expect(destination.pathname).toBe('/signin')
  expect(destination.searchParams.get('redirect_url')).toBe(path)
})

it.each([
  [['zh-TW'], 'zh-Hant'],
  [['zh-SG'], 'zh-Hans'],
  [['xx-XX', 'ja-JP'], 'ja-JP'],
  [['xx-XX'], 'en-US'],
  [['*', 'not_a_locale'], 'en-US'],
])('matches supported browser preferences %j', (languages, expected) => {
  expect(getBrowserLocale(languages)).toBe(expected)
})
