import type { RequiredConnection } from '../required-connections'
import { webcrypto } from 'node:crypto'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import RequiredConnections from '../required-connections'

const navigation = vi.hoisted(() => ({ pathname: '/connections-demo', query: '' }))

vi.mock('@/next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/next/navigation')>()),
  usePathname: () => navigation.pathname,
  useSearchParams: () => new URLSearchParams(navigation.query),
}))

const gmail: RequiredConnection = {
  id: 'gmail',
  name: 'Gmail',
  iconClassName: 'i-ri-mail-line',
}
const github: RequiredConnection = {
  id: 'github',
  name: 'GitHub',
  iconClassName: 'i-ri-github-fill',
}
describe('RequiredConnections', () => {
  const originalUrl = window.location.href
  beforeEach(() => {
    navigation.pathname = '/connections-demo'
    navigation.query = ''
    window.history.replaceState({}, '', '/connections-demo')
    vi.stubGlobal('crypto', webcrypto)
    vi.spyOn(window.location, 'assign').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    window.history.replaceState({}, '', originalUrl)
    sessionStorage.clear()
  })

  it('shows the connections required by the current app and updates when they change', () => {
    const { rerender } = render(<RequiredConnections connections={[gmail, github]} />)

    const section = screen.getByRole('region', { name: 'share.connections.required.title' })
    expect(
      within(section).getByRole('heading', {
        level: 2,
        name: 'share.connections.required.title',
      }),
    ).toBeVisible()
    expect(within(section).getByText('share.connections.required.signInDescription')).toBeVisible()
    const list = within(section).getByRole('list')
    expect(within(list).getAllByRole('listitem')).toHaveLength(2)
    expect(within(list).getByText('Gmail')).toBeVisible()
    expect(within(list).getByText('GitHub')).toBeVisible()

    rerender(<RequiredConnections connections={[github]} />)

    expect(within(list).queryByText('Gmail')).not.toBeInTheDocument()
    expect(within(list).getAllByRole('listitem')).toHaveLength(1)
    expect(within(list).getByText('GitHub')).toBeVisible()
  })

  it('encodes a demo page and special query characters once in the sign-in return URL', async () => {
    const user = userEvent.setup()
    navigation.query = new URLSearchParams({
      prompt: 'Hello 世界 & more',
      conversation: 'a&b',
    }).toString()
    window.history.replaceState({}, '', `/connections-demo?${navigation.query}`)
    render(<RequiredConnections connections={[gmail]} />)

    await user.click(screen.getByRole('button', { name: 'share.connections.required.signIn' }))

    await waitFor(() => expect(window.location.assign).toHaveBeenCalledOnce())
    const destination = new URL(
      vi.mocked(window.location.assign).mock.calls[0]![0],
      window.location.origin,
    )
    expect(destination.pathname).toBe('/signin')
    expect(destination.searchParams.get('redirect_url')).toBe(
      `/connections-demo?${navigation.query}`,
    )
    const returnUrl = new URL(destination.searchParams.get('redirect_url')!, window.location.origin)
    expect(returnUrl.searchParams.get('prompt')).toBe('Hello 世界 & more')
    expect(returnUrl.searchParams.get('conversation')).toBe('a&b')
  })

  it('starts PKCE for the current App after navigating away from the demo', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<RequiredConnections connections={[gmail]} />)
    await user.click(screen.getByRole('button', { name: 'share.connections.required.signIn' }))
    await waitFor(() => expect(window.location.assign).toHaveBeenCalledTimes(1))

    navigation.pathname = '/workflow/another-app'
    navigation.query = 'conversation=current'
    window.history.replaceState({}, '', '/workflow/another-app?conversation=current')
    rerender(<RequiredConnections connections={[gmail]} />)
    await user.click(screen.getByRole('button', { name: 'share.connections.required.signIn' }))

    await waitFor(() => expect(window.location.assign).toHaveBeenCalledTimes(2))
    const destination = new URL(vi.mocked(window.location.assign).mock.calls[1]![0])
    expect(destination.searchParams.get('app_code')).toBe('another-app')
    expect(destination.searchParams.get('code_challenge_method')).toBe('S256')
    expect(destination.searchParams.get('code_challenge')).toMatch(/^[\w-]{43}$/)
    expect(destination.searchParams.has('code_verifier')).toBe(false)
    expect(destination.searchParams.get('redirect_url')).toBe(
      new URL('/workflow/another-app?conversation=current', window.location.origin).href,
    )
  })

  it('hides the connection prompt when the app requires no connections', () => {
    const { rerender } = render(<RequiredConnections connections={[gmail]} />)

    rerender(<RequiredConnections connections={[]} />)

    expect(
      screen.queryByRole('region', { name: 'share.connections.required.title' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'share.connections.required.signIn' }),
    ).not.toBeInTheDocument()
  })
})
