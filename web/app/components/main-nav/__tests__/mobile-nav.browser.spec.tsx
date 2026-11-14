import type { ComponentProps } from 'react'
import { createInstance } from 'i18next'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { createElement } from 'react'
import { I18nextProvider } from 'react-i18next'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { ThemeProvider } from '@/features/theme/provider'
import accountSettings from '@/i18n/locales/en-US/account-settings.json'
import app from '@/i18n/locales/en-US/app.json'
import common from '@/i18n/locales/en-US/common.json'
import contacts from '@/i18n/locales/en-US/contacts.json'
import navigation from '@/i18n/locales/en-US/navigation.json'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { MainNavMobileBar } from '../mobile-nav'

vi.unmock('react-i18next')

// boundary: Next's app router is unavailable in the standalone Vitest browser page.
vi.mock('@/next/navigation', async () => {
  const { useSyncExternalStore } = await import('react')
  const subscribe = (notify: () => void) => {
    window.addEventListener('popstate', notify)
    return () => window.removeEventListener('popstate', notify)
  }
  return {
    usePathname: () =>
      useSyncExternalStore(
        subscribe,
        () => window.location.pathname,
        () => window.location.pathname,
      ),
  }
})

// boundary: Next Link needs an app-router runtime; the anchor preserves native click semantics here.
vi.mock('@/next/link', () => ({
  default: ({ onClick, ...props }: ComponentProps<'a'>) =>
    createElement('a', {
      ...props,
      onClick: (event) => {
        onClick?.(event)
        if (!event.defaultPrevented) event.preventDefault()
      },
    }),
}))

const menuName = common['navigation.primary']

beforeEach(() => {
  window.history.replaceState({}, '', '/apps')
})

async function openMenu() {
  await page.viewport(390, 720)
  const i18n = createInstance()
  await i18n.init({
    lng: 'en-US',
    keySeparator: false,
    resources: { 'en-US': { accountSettings, app, common, contacts, navigation } },
  })
  const { wrapper: ConsoleQuery } = createConsoleQueryWrapper({
    currentWorkspace: { role: 'owner' },
    features: { enable_skill: false },
    systemFeatures: { enable_marketplace: false },
  })
  const screen = await render(
    <ConsoleQuery>
      <I18nextProvider i18n={i18n}>
        <NuqsTestingAdapter>
          <ThemeProvider defaultPreference="light">
            <MainNavMobileBar />
          </ThemeProvider>
        </NuqsTestingAdapter>
      </I18nextProvider>
    </ConsoleQuery>,
  )
  const trigger = screen.getByRole('button', { name: menuName })
  await userEvent.click(trigger)
  const drawer = screen.getByRole('dialog', { name: menuName })
  await expect.element(drawer).toBeVisible()
  return { drawer, screen, trigger }
}

it('closes after following a client-side link', async () => {
  const { drawer, screen, trigger } = await openMenu()

  await userEvent.click(drawer.getByRole('link', { name: 'Knowledge' }))

  await expect.element(screen.getByRole('dialog', { name: menuName })).not.toBeInTheDocument()
  await expect.element(trigger).toHaveFocus()
})

it('keeps modified and non-navigation actions open until the real close control is used', async () => {
  const { drawer, screen, trigger } = await openMenu()

  await userEvent.keyboard('{Control>}')
  await userEvent.click(drawer.getByRole('link', { name: 'Knowledge' }))
  await userEvent.keyboard('{/Control}')
  await userEvent.click(drawer.getByTitle('Workspace'))
  await expect.element(screen.getByRole('dialog', { name: menuName })).toBeVisible()
  await userEvent.keyboard('{Escape}')
  await expect.element(screen.getByRole('dialog', { name: menuName })).toBeVisible()

  await userEvent.click(drawer.getByRole('button', { name: 'Close' }))

  await expect.element(screen.getByRole('dialog', { name: menuName })).not.toBeInTheDocument()
  await expect.element(trigger).toHaveFocus()
})

it('closes for public route changes and real desktop viewport transitions', async () => {
  const { screen, trigger } = await openMenu()
  window.history.pushState({}, '', '/datasets')
  window.dispatchEvent(new PopStateEvent('popstate'))
  await expect.element(screen.getByRole('dialog', { name: menuName })).not.toBeInTheDocument()

  await userEvent.click(trigger)
  await expect.element(screen.getByRole('dialog', { name: menuName })).toBeVisible()
  await page.viewport(1024, 720)

  await expect.element(screen.getByRole('dialog', { name: menuName })).not.toBeInTheDocument()
})
