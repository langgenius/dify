import type { AppDetailWithSite } from '@dify/contracts/api/console/apps/types.gen'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AppDetailSection from '@/app/components/app-sidebar/app-detail-section'
import { useStore } from '@/app/components/app/store'
import { consoleQuery } from '@/service/console'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { createAppDetailFixture } from '@/test/fixtures/app'
import { AppACLPermission } from '@/utils/permission'
import { AppDetailPrefetch } from '../app-detail-prefetch'
import { getAppIdFromPathname } from '../app-detail-route'

function deferredResponse() {
  let resolve!: (response: Response) => void
  const promise = new Promise<Response>((resolveResponse) => {
    resolve = resolveResponse
  })
  return { promise, resolve }
}

let pathname = '/app/app-1/overview'
const request = vi.fn<(url: string) => Promise<Response>>()
vi.mock('@/next/navigation', () => ({ usePathname: () => pathname }))
vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  request: (url: string) => request(url),
}))
vi.mock('@/app/components/app-sidebar/app-info', () => ({
  AppInfoView: ({ appDetail }: { appDetail: AppDetailWithSite }) => <span>{appDetail.name}</span>,
}))
vi.mock('@/app/components/app-sidebar/nav-link', () => ({
  default: ({ name, href }: { name: string; href: string }) => <a href={href}>{name}</a>,
}))

function Route() {
  const appId = getAppIdFromPathname(pathname)
  return (
    <>
      <a href="/apps">Back to Apps</a>
      {appId && <AppDetailPrefetch appId={appId} />}
      <AppDetailSection />
    </>
  )
}
const app = (id: string, name: string) =>
  createAppDetailFixture({
    id,
    name,
    permission_keys: [AppACLPermission.Monitor],
  })

describe('App sidebar route loading', () => {
  beforeEach(() => {
    pathname = '/app/app-1/overview'
    request.mockReset()
  })

  it('keeps the shell visible and consumes the in-flight prefetch without an App Store producer', async () => {
    const pending = deferredResponse()
    request.mockReturnValue(pending.promise)
    renderWithConsoleQuery(<Route />)
    expect(screen.getByRole('link', { name: 'Back to Apps' })).toBeVisible()
    expect(screen.getByText('navigation.menus.appDetail')).toBeVisible()
    expect(screen.getByRole('button', { name: /common\.operation\.moreActionsFor/ })).toBeDisabled()
    expect(screen.getByRole('navigation', { name: 'navigation.menus.appDetail' })).toBeVisible()
    expect(screen.queryByRole('link', { name: 'common.appMenus.overview' })).not.toBeInTheDocument()
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1))
    await act(async () => pending.resolve(Response.json(app('app-1', 'First app'))))
    expect(await screen.findByText('First app')).toBeVisible()
    expect(screen.getByRole('link', { name: 'common.appMenus.overview' })).toHaveAttribute(
      'href',
      '/app/app-1/overview',
    )
    expect(request).toHaveBeenCalledTimes(1)
    expect(useStore.getState().appDetail).toBeUndefined()
  })

  it('can load without prefetch and retries a failed query inside the sidebar', async () => {
    request.mockRejectedValueOnce(new Error('unavailable'))
    request.mockResolvedValue(Response.json(app('app-1', 'Recovered app')))
    renderWithConsoleQuery(<AppDetailSection />)
    expect(await screen.findByRole('alert')).toBeVisible()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'common.errorBoundary.tryAgain' }))
    expect(await screen.findByText('Recovered app')).toBeVisible()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('keeps a late response for A out of B and removes app UI when leaving the route', async () => {
    const a = deferredResponse()
    const b = deferredResponse()
    request.mockImplementation((url) => (url.endsWith('/app-1') ? a.promise : b.promise))
    const view = renderWithConsoleQuery(<Route />)
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1))
    pathname = '/app/app-2/logs'
    view.rerender(<Route />)
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2))
    await act(async () => b.resolve(Response.json(app('app-2', 'Second app'))))
    expect(await screen.findByText('Second app')).toBeVisible()
    await act(async () => a.resolve(Response.json(app('app-1', 'First app'))))
    expect(screen.queryByText('First app')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'common.appMenus.overview' })).toHaveAttribute(
      'href',
      '/app/app-2/overview',
    )
    pathname = '/apps'
    view.rerender(<Route />)
    expect(screen.queryByText('Second app')).not.toBeInTheDocument()
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('shares cached data between sections and reacts to metadata and permission changes', async () => {
    request.mockResolvedValue(Response.json(app('app-1', 'First app')))
    const view = renderWithConsoleQuery(<Route />)
    await screen.findByText('First app')
    pathname = '/app/app-1/logs'
    view.rerender(<Route />)
    expect(screen.getByText('First app')).toBeVisible()
    expect(request).toHaveBeenCalledTimes(1)
    await act(async () => {
      view.queryClient.setQueryData(
        consoleQuery.apps.byAppId.get.queryKey({ input: { params: { app_id: 'app-1' } } }),
        {
          ...app('app-1', 'Renamed app'),
          permission_keys: [],
        },
      )
    })
    expect(await screen.findByText('Renamed app')).toBeVisible()
    expect(screen.queryByRole('link', { name: 'common.appMenus.overview' })).not.toBeInTheDocument()
  })

  it.each([
    '/apps',
    '/agents/agent-1',
    '/datasets/data-1',
    '/snippets/snippet-1',
    '/app/',
    '/app//workflow',
  ])('does not request App Detail at %s', (path) => {
    pathname = path
    renderWithConsoleQuery(<Route />)
    expect(request).not.toHaveBeenCalled()
  })
})
