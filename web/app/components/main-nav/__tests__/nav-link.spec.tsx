import type { ContextType } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RouterContext } from 'next/dist/shared/lib/router-context.shared-runtime'
import MainNavLink from '../components/nav-link'

vi.mock('@/app/components/apps/list-navigation-state', () => ({
  useStudioListHref: () => '/apps',
}))

it('navigates from the primary sidebar without requesting route scroll and focus handling', async () => {
  const user = userEvent.setup()
  const router: NonNullable<ContextType<typeof RouterContext>> = {
    basePath: '',
    pathname: '/apps',
    route: '/apps',
    query: {},
    asPath: '/apps',
    push: vi.fn().mockResolvedValue(true),
    replace: vi.fn().mockResolvedValue(true),
    reload: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn().mockResolvedValue(undefined),
    beforePopState: vi.fn(),
    events: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
    isFallback: false,
    isLocaleDomain: false,
    isReady: true,
    isPreview: false,
  }

  render(
    <RouterContext value={router}>
      <MainNavLink
        pathname="/apps"
        item={{
          href: '/marketplace',
          label: 'Marketplace',
          icon: 'i-ri-store-2-line',
          activeIcon: 'i-ri-store-2-fill',
          active: (pathname) => pathname === '/marketplace',
        }}
      />
    </RouterContext>,
  )

  await user.tab()
  await user.keyboard('{Enter}')

  expect(router.push).toHaveBeenCalledWith(
    '/marketplace',
    '/marketplace',
    expect.objectContaining({ scroll: false }),
  )
  expect(screen.getByRole('link', { name: 'Marketplace' })).toHaveFocus()
})
