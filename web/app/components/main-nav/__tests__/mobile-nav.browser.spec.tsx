import type { ReactNode } from 'react'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { MainNavMobileBar } from '../mobile-nav'

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

vi.mock('../index', () => ({
  MainNavLogo: () => <a href="/">Dify</a>,
  MainNavPanel: ({ headerAction }: { headerAction: ReactNode }) => (
    <nav aria-label="Primary">
      {headerAction}
      {/* Client-side links cancel the native navigation, like next/link does. */}
      <a href="/datasets" onClick={(event) => event.preventDefault()}>
        Knowledge
      </a>
      <a href="https://docs.dify.ai" target="_blank" rel="noreferrer">
        Docs
      </a>
      <button type="button">Search</button>
    </nav>
  ),
  MainNavFooter: () => null,
}))

const menuName = 'common.navigation.primary'

beforeEach(() => {
  window.history.replaceState({}, '', '/apps')
})

async function openMenu() {
  await page.viewport(390, 720)
  const screen = await render(<MainNavMobileBar />)
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
  await userEvent.click(drawer.getByRole('button', { name: 'Search' }))
  await expect.element(screen.getByRole('dialog', { name: menuName })).toBeVisible()

  await userEvent.click(drawer.getByRole('button', { name: 'common.operation.close' }))

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
