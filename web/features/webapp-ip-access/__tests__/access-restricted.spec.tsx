import type { i18n as I18n } from 'i18next'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { setLocaleOnClient } from '@/i18n-config'
import enShare from '@/i18n/en-US/share.json'
import zhShare from '@/i18n/zh-Hans/share.json'
import AccessRestricted from '../access-restricted'

vi.unmock('react-i18next')

vi.mock('@/i18n-config', () => ({
  setLocaleOnClient: vi.fn(),
}))

let i18n: I18n

const renderPage = (clientIp?: string) =>
  render(
    <I18nextProvider i18n={i18n}>
      <AccessRestricted clientIp={clientIp} />
    </I18nextProvider>,
  )

describe('IP access restricted page', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    i18n = createInstance()
    await i18n.use(initReactI18next).init({
      lng: 'en-US',
      fallbackLng: 'en-US',
      defaultNS: 'share',
      keySeparator: false,
      interpolation: { escapeValue: false },
      resources: {
        'en-US': { share: enShare },
        'zh-Hans': { share: zhShare },
      },
    })
    vi.mocked(setLocaleOnClient).mockImplementation(async (locale) => {
      await i18n.changeLanguage(locale)
    })
  })

  it.each([
    ['en-US', '203.0.113.8', 'Your current IP address 203.0.113.8 isn’t on the allowlist.'],
    [
      'en-US',
      '2001:db8:1234:5678:90ab:cdef:1234:5678',
      'Your current IP address 2001:db8:1234:5678:90ab:cdef:1234:5678 isn’t on the allowlist.',
    ],
    ['zh-Hans', '203.0.113.8', '您当前的 IP 地址 203.0.113.8 不在允许列表中。'],
  ])('renders the full localized IP sentence for %s and %s', async (locale, clientIp, sentence) => {
    await i18n.changeLanguage(locale)
    renderPage(clientIp)

    const ip = screen.getByText(clientIp, { selector: 'code' })
    expect(ip.closest('p')?.textContent).toBe(sentence)
  })

  it('shows the network restriction without an IP sentence when the server omits the IP', () => {
    renderPage()

    expect(screen.getByRole('heading', { name: 'Access restricted' })).toBeInTheDocument()
    expect(screen.getByText(enShare['ipAccessDenied.description'])).toBeInTheDocument()
    expect(screen.queryByText(/Your current IP address/)).not.toBeInTheDocument()
  })

  it('changes the page language without a reload and keeps the current IP', async () => {
    const user = userEvent.setup()
    renderPage('203.0.113.8')

    await user.click(screen.getByRole('button', { name: 'English' }))
    await user.click(screen.getByRole('menuitemradio', { name: '简体中文' }))

    expect(setLocaleOnClient).toHaveBeenCalledWith('zh-Hans', false)
    expect(await screen.findByRole('heading', { name: '访问受限' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '简体中文' })).toBeInTheDocument()
    expect(screen.getByText('203.0.113.8', { selector: 'code' }).closest('p')?.textContent).toBe(
      '您当前的 IP 地址 203.0.113.8 不在允许列表中。',
    )
  })
})
