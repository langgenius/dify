import type { ContextType } from 'react'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RouterContext } from 'next/dist/shared/lib/router-context.shared-runtime'
import { AppDetailTop } from '@/app/components/app-sidebar/app-detail-top'
import MainNavLink from '@/app/components/main-nav/components/nav-link'
import { SnippetDetailTop } from '@/app/components/snippets/components/snippet-detail-top'
import { seedCurrentWorkspaceQuery } from '@/test/console/current-workspace'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { StudioListLink, StudioListNavigation } from '../list-navigation'

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }))
vi.mock('@/next/navigation', () => ({ useRouter: () => router }))

const studioItem = {
  href: '/apps',
  label: 'Studio',
  icon: 'i-ri-apps-line',
  activeIcon: 'i-ri-apps-fill',
  active: () => false,
}

function Destinations() {
  return (
    <>
      <AppDetailTop />
      <SnippetDetailTop />
      <MainNavLink item={studioItem} pathname="/" />
    </>
  )
}

const flush = () => Promise.resolve(new URLSearchParams())
const remember = (path: '/apps' | '/snippets', href: string) => (
  <StudioListNavigation path={path} href={href} flush={flush}>
    <Destinations />
  </StudioListNavigation>
)
const appsLink = () => screen.getByRole('link', { name: 'navigation.menus.apps' })
const snippetsLink = () => screen.getByRole('link', { name: 'workflow.tabs.snippets' })

it('uses default destinations when there is no list history', () => {
  renderWithConsoleQuery(<Destinations />)
  expect(appsLink()).toHaveAttribute('href', '/apps')
  expect(snippetsLink()).toHaveAttribute('href', '/snippets')
  expect(screen.getByRole('link', { name: 'Studio' })).toHaveAttribute('href', '/apps')
})

it('retains independent apps and snippets destinations after leaving both lists', () => {
  const appsHref = '/apps?creatorIDs=alice&tagIDs=research&category=workflow'
  const snippetsHref = '/snippets?creatorIDs=bob&publishStatus=draft'
  const { rerender } = renderWithConsoleQuery(remember('/apps', appsHref))
  rerender(remember('/snippets', snippetsHref))
  rerender(<Destinations />)
  expect(appsLink()).toHaveAttribute('href', appsHref)
  expect(snippetsLink()).toHaveAttribute('href', snippetsHref)
  expect(screen.getByRole('link', { name: 'Studio' })).toHaveAttribute('href', appsHref)
})

it('keeps list destinations isolated by workspace', async () => {
  const { rerender, queryClient } = renderWithConsoleQuery(
    remember('/apps', '/apps?creatorIDs=alice'),
  )
  rerender(<Destinations />)
  await act(async () => seedCurrentWorkspaceQuery(queryClient, { id: 'workspace-2' }))
  await waitFor(() => expect(appsLink()).toHaveAttribute('href', '/apps'))
  expect(snippetsLink()).toHaveAttribute('href', '/snippets')
  rerender(remember('/apps', '/apps?creatorIDs=bob'))
  rerender(<Destinations />)
  await act(async () => seedCurrentWorkspaceQuery(queryClient, { id: 'workspace-1' }))
  await waitFor(() => expect(appsLink()).toHaveAttribute('href', '/apps?creatorIDs=alice'))
})

it.each(['/apps', '/snippets'] as const)(
  'replaces the saved %s destination when filters are cleared',
  (path) => {
    const { rerender } = renderWithConsoleQuery(remember(path, `${path}?creatorIDs=alice`))
    rerender(remember(path, path))
    rerender(<Destinations />)
    expect(path === '/apps' ? appsLink() : snippetsLink()).toHaveAttribute('href', path)
  },
)

it('finishes pending URL writes before navigating to the editor', async () => {
  const user = userEvent.setup()
  const pending = createDeferred<URLSearchParams>()
  const flushPending = vi.fn(() => pending.promise)
  const linkRouter: NonNullable<ContextType<typeof RouterContext>> = {
    basePath: '',
    route: '/apps',
    pathname: '/apps',
    query: {},
    asPath: '/apps',
    isFallback: false,
    isLocaleDomain: false,
    isReady: true,
    isPreview: false,
    push: vi.fn().mockResolvedValue(true),
    replace: vi.fn().mockResolvedValue(true),
    reload: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn().mockResolvedValue(undefined),
    beforePopState: vi.fn(),
    events: { on: vi.fn(), off: vi.fn(), emit: vi.fn() },
  }
  renderWithConsoleQuery(
    <RouterContext value={linkRouter}>
      <StudioListNavigation path="/apps" href="/apps?keywords=sales" flush={flushPending}>
        <StudioListLink href="/app/app-1/workflow">Edit workflow</StudioListLink>
      </StudioListNavigation>
    </RouterContext>,
  )
  await user.click(screen.getByRole('link', { name: 'Edit workflow' }))
  expect(flushPending).toHaveBeenCalledOnce()
  expect(router.push).not.toHaveBeenCalled()
  expect(linkRouter.push).not.toHaveBeenCalled()
  await act(async () => pending.resolve(new URLSearchParams('keywords=sales')))
  expect(router.push).toHaveBeenCalledExactlyOnceWith('/app/app-1/workflow', { scroll: undefined })
})
