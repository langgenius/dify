import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import common from '@/i18n/locales/en-US/common.json'
import education from '@/i18n/locales/en-US/education.json'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createNuqsTestWrapper } from '@/test/nuqs-testing'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { EducationExpireNotice } from '../index'

vi.unmock('react-i18next')

const storageKey = 'dismissed-education-expire-notice'
const expires = Date.UTC(2099, 0, 1) / 1000

beforeEach(() => {
  const previous = localStorage.getItem(storageKey)
  localStorage.removeItem(storageKey)
  onTestFinished(() => {
    if (previous === null) localStorage.removeItem(storageKey)
    else localStorage.setItem(storageKey, previous)
  })
  onTestFinished(guardUnexpectedFetch())
})

async function renderNotice(expireAt = expires, searchParams = '') {
  const i18n = createInstance()
  await i18n.init({
    lng: 'en-US',
    keySeparator: false,
    resources: { 'en-US': { common, education } },
    interpolation: { escapeValue: false },
  })
  const { wrapper: ConsoleProvider } = createConsoleQueryWrapper({
    accountProfile: { id: 'user-1', timezone: 'UTC' },
    systemFeatures: { deployment_edition: 'CLOUD' },
    features: { education: { enabled: true } },
    educationStatus: { allow_refresh: true, expire_at: expireAt },
  })

  const { wrapper: UrlState } = createNuqsTestWrapper({ searchParams })
  return render(
    <ConsoleProvider>
      <UrlState>
        <I18nextProvider i18n={i18n}>
          <EducationExpireNotice />
          <button type="button">Account ready</button>
        </I18nextProvider>
      </UrlState>
    </ConsoleProvider>,
  )
}

it('dismisses the real notice and remembers the same account, expiry and phase on return', async () => {
  const first = await renderNotice()
  const notice = first.getByRole('dialog', {
    name: 'Your education status will expire on 01/01/2099',
  })
  await expect.element(notice).toBeVisible()
  await first.getByRole('button', { name: 'Dismiss', exact: true }).click()
  await expect.element(notice).not.toBeInTheDocument()
  await first.unmount()

  const returned = await renderNotice()
  await expect.element(returned.getByRole('button', { name: 'Account ready' })).toBeVisible()
  await expect.element(returned.getByRole('dialog')).not.toBeInTheDocument()
})

it('shows the expired notice when the expiration identity changes after dismissal', async () => {
  const first = await renderNotice()
  await first.getByRole('button', { name: 'Dismiss', exact: true }).click()
  await expect.element(first.getByRole('dialog')).not.toBeInTheDocument()
  await first.unmount()

  const returned = await renderNotice(Date.UTC(2020, 0, 1) / 1000)
  await expect
    .element(returned.getByRole('dialog', { name: 'Your education status has expired' }))
    .toBeVisible()
})

it('defers the real notice while the pricing URL is open', async () => {
  const screen = await renderNotice(expires, '?pricing=open')
  await expect.element(screen.getByRole('button', { name: 'Account ready' })).toBeVisible()
  await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
})

it('offers the canonical re-verification route from the real dialog to the keyboard', async () => {
  const screen = await renderNotice()
  const verify = screen.getByRole('link', { name: 'Re-verify', exact: true })
  await expect.element(verify).toHaveAttribute('href', '/education/verify')
  await expect
    .element(screen.getByRole('link', { name: 'Learn how to get education verified' }))
    .toHaveAttribute(
      'href',
      'https://docs.dify.ai/en/cloud/use-dify/workspace/subscription-management#dify-for-education',
    )
  await expect.element(screen.getByRole('button', { name: 'Close', exact: true })).toHaveFocus()
  await userEvent.tab()
  await expect
    .element(screen.getByRole('link', { name: 'Learn how to get education verified' }))
    .toHaveFocus()
  await userEvent.tab()
  await expect.element(screen.getByRole('button', { name: 'Dismiss', exact: true })).toHaveFocus()
  await userEvent.tab()
  await expect.element(verify).toHaveFocus()
})
