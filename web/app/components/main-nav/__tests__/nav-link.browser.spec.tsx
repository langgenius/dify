import type { ContextType } from 'react'
import { RouterContext } from 'next/dist/shared/lib/router-context.shared-runtime'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { useRememberStudioListHref } from '@/app/components/apps/list-navigation-state'
import { seedCurrentWorkspaceQuery } from '@/test/console/current-workspace'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { createTestQueryClient } from '@/test/query-client'
import MainNavLink from '../components/nav-link'

function RememberedAppsLink() {
  useRememberStudioListHref('/apps', '/apps?tag=mine')
  return (
    <MainNavLink
      pathname="/datasets"
      item={{
        href: '/apps',
        label: 'Studio',
        icon: 'i-ri-apps-line',
        activeIcon: 'i-ri-apps-fill',
        active: (pathname) => pathname === '/apps',
      }}
    />
  )
}

it('navigates from the primary sidebar without requesting route scroll and focus handling', async () => {
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
  const queryClient = createTestQueryClient()
  seedCurrentWorkspaceQuery(queryClient, { id: 'workspace-1' })

  const screen = await render(
    <QueryClientTestProvider queryClient={queryClient}>
      <RouterContext value={router}>
        <RememberedAppsLink />
      </RouterContext>
    </QueryClientTestProvider>,
  )

  const link = screen.getByRole('link', { name: 'Studio' })
  await expect.element(link).toHaveAttribute('href', '/apps?tag=mine')
  await userEvent.tab()
  await expect.element(link).toHaveFocus()
  await userEvent.keyboard('{Enter}')

  expect(router.push).toHaveBeenCalledWith(
    '/apps?tag=mine',
    '/apps?tag=mine',
    expect.objectContaining({ scroll: false }),
  )
  await expect.element(link).toHaveFocus()
  queryClient.clear()
})
