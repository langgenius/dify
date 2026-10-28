import { webcrypto } from 'node:crypto'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import SignIn from '../sign-in'
import { getWebAppEntryState, WebAppEntryContext } from '../webapp-entry'
import WebAppSignInHandoff from '../webapp-sign-in-handoff'

const anonymousEntry = getWebAppEntryState({
  parameters: {
    account_login_enabled: true,
    account_login_url: 'https://accounts.example/account-prefix/signin',
    allow_anonymous_end_user_auth: true,
    connection_revision: null,
    requires_end_user_connections: false,
    connection_requirements: [],
  },
  loginStatus: { logged_in: false, app_logged_in: true },
  canAccess: true,
  appDataReady: true,
  hasError: false,
})

const navigation = vi.hoisted(() => ({ pathname: '/workflow/demo', query: '' }))

vi.mock('@/next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/next/navigation')>()),
  usePathname: () => navigation.pathname,
  useSearchParams: () => new URLSearchParams(navigation.query),
}))

function navigate(pathname: string, query = '', fragment = '') {
  navigation.pathname = pathname
  navigation.query = query
  window.history.replaceState({}, '', `${pathname}${query ? `?${query}` : ''}${fragment}`)
}

describe('Web app SignIn', () => {
  const originalUrl = window.location.href
  beforeEach(() => {
    navigate('/workflow/demo')
    vi.stubGlobal('crypto', webcrypto)
    vi.spyOn(window.location, 'assign').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    window.history.replaceState({}, '', originalUrl)
    sessionStorage.clear()
  })

  it('starts PKCE on the API Account origin and prefix while preserving the full Web return URL', async () => {
    const user = userEvent.setup()
    navigate('/workflow/demo', '', '#earlier-conversation')
    const entry = getWebAppEntryState({
      parameters: {
        account_login_enabled: true,
        account_login_url: 'https://accounts.example/account-prefix/signin?source=webapp',
        allow_anonymous_end_user_auth: true,
        connection_revision: null,
        requires_end_user_connections: false,
        connection_requirements: [],
      },
      loginStatus: { logged_in: false, app_logged_in: true },
      canAccess: true,
      appDataReady: true,
      hasError: false,
    })
    render(
      <WebAppEntryContext value={entry}>
        <SignIn />
      </WebAppEntryContext>,
    )

    expect(window.location.assign).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'share.auth.signIn' }))

    await waitFor(() => expect(window.location.assign).toHaveBeenCalledOnce())
    const destination = new URL(vi.mocked(window.location.assign).mock.calls[0]![0])
    expect(destination.origin).toBe('https://accounts.example')
    expect(destination.pathname).toBe('/account-prefix/signin')
    expect(destination.searchParams.get('source')).toBe('webapp')
    expect(destination.searchParams.get('is_end_user')).toBe('1')
    expect(destination.searchParams.get('app_code')).toBe('demo')
    expect(destination.searchParams.get('code_challenge_method')).toBe('S256')
    expect(destination.searchParams.get('code_challenge')).toMatch(/^[\w-]{43}$/)
    expect(destination.searchParams.has('code_verifier')).toBe(false)
    expect(destination.searchParams.get('redirect_url')).toBe(
      new URL('/workflow/demo#earlier-conversation', window.location.origin).href,
    )
  })

  it('preserves Unicode and special query characters when starting sign-in', async () => {
    const user = userEvent.setup()
    const query = new URLSearchParams({
      prompt: '你好 & a+b / 50%',
      conversation: 'a&b',
    }).toString()
    navigate('/workflow/demo', query)
    render(<SignIn />)

    await user.click(screen.getByRole('button', { name: 'share.auth.signIn' }))

    await waitFor(() => expect(window.location.assign).toHaveBeenCalledOnce())
    const destination = new URL(vi.mocked(window.location.assign).mock.calls[0]![0])
    expect(destination.pathname).toBe('/signin')
    expect(destination.searchParams.get('redirect_url')).toBe(
      new URL(`/workflow/demo?${query}`, window.location.origin).href,
    )
    const returnUrl = new URL(destination.searchParams.get('redirect_url')!)
    expect(returnUrl.searchParams.get('prompt')).toBe('你好 & a+b / 50%')
    expect(returnUrl.searchParams.get('conversation')).toBe('a&b')
  })

  it('starts sign-in for the current App and drops a query that is no longer present after navigation', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<SignIn />)
    await user.click(screen.getByRole('button', { name: 'share.auth.signIn' }))
    await waitFor(() => expect(window.location.assign).toHaveBeenCalledTimes(1))

    navigate('/workflow/another-app', 'conversation=current')
    rerender(<SignIn />)
    await user.click(screen.getByRole('button', { name: 'share.auth.signIn' }))
    await waitFor(() => expect(window.location.assign).toHaveBeenCalledTimes(2))
    const second = new URL(vi.mocked(window.location.assign).mock.calls[1]![0])
    expect(second.searchParams.get('app_code')).toBe('another-app')
    expect(second.searchParams.get('redirect_url')).toBe(
      new URL('/workflow/another-app?conversation=current', window.location.origin).href,
    )

    navigate('/workflow/another-app')
    rerender(<SignIn />)
    await user.click(screen.getByRole('button', { name: 'share.auth.signIn' }))
    await waitFor(() => expect(window.location.assign).toHaveBeenCalledTimes(3))
    const third = new URL(vi.mocked(window.location.assign).mock.calls[2]![0])
    expect(third.searchParams.get('redirect_url')).toBe(
      new URL('/workflow/another-app', window.location.origin).href,
    )
  })

  it('moves embedded login to the same App in the top-level tab before creating its PKCE transaction', async () => {
    const user = userEvent.setup()
    navigate('/chat/demo', 'conversation=current&prompt=hello', '#history')
    const topWindow = { location: { href: 'https://host.example/embedded' } }
    const top = vi.spyOn(window, 'top', 'get').mockReturnValue(topWindow as Window)
    const { rerender } = render(
      <WebAppEntryContext value={anonymousEntry}>
        <SignIn />
      </WebAppEntryContext>,
    )

    await user.click(screen.getByRole('button', { name: 'share.auth.signIn' }))
    await waitFor(() => expect(new URL(topWindow.location.href).pathname).toBe('/chat/demo'))
    const handoff = new URL(topWindow.location.href)
    expect(handoff.origin).toBe(window.location.origin)
    expect(handoff.searchParams.get('conversation')).toBe('current')
    expect(handoff.searchParams.get('prompt')).toBe('hello')
    expect(handoff.hash).toBe('#history')
    expect(sessionStorage.getItem('webapp-account-login-demo')).toBeNull()
    expect(window.location.assign).not.toHaveBeenCalled()

    // A new top-level document has its own session storage and starts the login itself.
    top.mockRestore()
    navigate(handoff.pathname, handoff.searchParams.toString(), handoff.hash)
    rerender(
      <WebAppEntryContext value={anonymousEntry}>
        <WebAppSignInHandoff>
          <p>App content</p>
        </WebAppSignInHandoff>
      </WebAppEntryContext>,
    )
    await waitFor(() => expect(window.location.assign).toHaveBeenCalledOnce())
    const destination = new URL(vi.mocked(window.location.assign).mock.calls[0]![0])
    expect(destination.origin).toBe('https://accounts.example')
    expect(destination.searchParams.get('redirect_url')).toBe(
      new URL('/chat/demo?conversation=current&prompt=hello#history', window.location.origin).href,
    )
    expect(destination.searchParams.has('code_verifier')).toBe(false)
    expect(destination.searchParams.get('code_challenge_method')).toBe('S256')
    expect(sessionStorage.getItem('webapp-account-login-demo')).not.toBeNull()
    expect(screen.queryByText('App content')).not.toBeInTheDocument()
  })

  it('clears the handoff command without logging in when login is disabled', async () => {
    navigate('/workflow/demo', '_dify_signin=1&conversation=saved', '#output')
    vi.spyOn(window.location, 'replace').mockImplementation(() => {})
    if (!('parameters' in anonymousEntry)) throw new Error('Ready entry required')
    const entry = {
      ...anonymousEntry,
      showSignIn: false,
      parameters: { ...anonymousEntry.parameters, account_login_enabled: false },
    }
    render(
      <WebAppEntryContext value={entry}>
        <WebAppSignInHandoff>
          <p>App content</p>
        </WebAppSignInHandoff>
      </WebAppEntryContext>,
    )

    await waitFor(() =>
      expect(window.location.replace).toHaveBeenCalledWith(
        new URL('/workflow/demo?conversation=saved#output', window.location.origin).href,
      ),
    )
    expect(window.location.assign).not.toHaveBeenCalled()
    expect(sessionStorage.getItem('webapp-account-login-demo')).toBeNull()
  })
})
