import type { ReactNode } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MainNavMobileBar } from '../mobile-nav'

const state = vi.hoisted(() => ({ atLeastMd: false, pathname: '/apps' }))

vi.mock('@langgenius/dify-ui/use-media-query', () => ({
  useMediaQuery: (query: string) => query === '(width >= 48rem)' && state.atLeastMd,
}))

vi.mock('@/next/navigation', () => ({
  usePathname: () => state.pathname,
}))

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
  state.atLeastMd = false
  state.pathname = '/apps'
})

async function openMenu() {
  const user = userEvent.setup()
  const view = render(<MainNavMobileBar />)
  await user.click(screen.getByRole('button', { name: menuName }))
  const drawer = await screen.findByRole('dialog', { name: menuName })
  return { drawer, user, view }
}

async function expectClosed() {
  await waitFor(() =>
    expect(screen.queryByRole('dialog', { name: menuName })).not.toBeInTheDocument(),
  )
}

it('closes after following a client-side link', async () => {
  const { drawer, user } = await openMenu()

  await user.click(within(drawer).getByRole('link', { name: 'Knowledge' }))

  await expectClosed()
})

it('stays open for new-tab links, modified clicks, and non-link controls', async () => {
  const { drawer, user } = await openMenu()

  await user.click(within(drawer).getByRole('link', { name: 'Docs' }))
  await user.keyboard('{Meta>}')
  await user.click(within(drawer).getByRole('link', { name: 'Knowledge' }))
  await user.keyboard('{/Meta}')
  await user.click(within(drawer).getByRole('button', { name: 'Search' }))

  expect(screen.getByRole('dialog', { name: menuName })).toBeInTheDocument()
})

it('closes from the close button in the panel header', async () => {
  const { drawer, user } = await openMenu()

  await user.click(within(drawer).getByRole('button', { name: 'common.operation.close' }))

  await expectClosed()
})

it('closes when the route changes without a link click', async () => {
  const { view } = await openMenu()

  state.pathname = '/datasets'
  view.rerender(<MainNavMobileBar />)

  await expectClosed()
})

it('closes when the viewport widens to the desktop layout', async () => {
  const { view } = await openMenu()

  state.atLeastMd = true
  view.rerender(<MainNavMobileBar />)

  await expectClosed()
})
