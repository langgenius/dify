import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import enShare from '@/i18n/en-US/share.json'
import jaShare from '@/i18n/ja-JP/share.json'
import zhShare from '@/i18n/zh-Hans/share.json'
import { getBrowserLocale } from '../locale'
import AppNotAccessible from '../page'

vi.unmock('react-i18next')

beforeEach(() => {
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['en-US'])
  document.title = 'Previous title'
  document.cookie = 'locale=zh-Hans'
})
afterEach(() => vi.restoreAllMocks())

it.each([
  ['en-GB', enShare],
  ['zh-CN', zhShare],
  ['ja', jaShare],
])('uses browser language %s for exact page and document copy', async (language, copy) => {
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
    expect(screen.queryByRole('button', { name: /sign in|retry/i })).not.toBeInTheDocument()
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
  expect(document.cookie).toContain('locale=zh-Hans')
  unmount()
  expect(document.title).toBe('Previous title')
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
