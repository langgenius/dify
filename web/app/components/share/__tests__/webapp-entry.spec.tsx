import type {
  LoginStatusResponse,
  WebAppConnectionRequirement,
} from '@dify/contracts/api/web/types.gen'
import type { ReactNode } from 'react'
import { webcrypto } from 'node:crypto'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render as renderView, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SignIn from '../sign-in'
import { getWebAppEntryState, WebAppEntryContext } from '../webapp-entry'

type EntryInput = Parameters<typeof getWebAppEntryState>[0]
type EntryParameters = NonNullable<EntryInput['parameters']>

let queryClient: QueryClient
const render = (ui: ReactNode) =>
  renderView(ui, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  })

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  vi.stubGlobal('crypto', webcrypto)
  window.history.replaceState({}, '', '/chat/app-code')
})
afterEach(() => {
  queryClient.clear()
  sessionStorage.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  window.history.replaceState({}, '', '/')
})

vi.mock('@/next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/next/navigation')>()),
  usePathname: () => '/chat/app-code',
  useSearchParams: () => new URLSearchParams(),
}))

const requirement: WebAppConnectionRequirement = {
  icon: '/provider-icon.svg',
  icon_dark: null,
  plugin_unique_identifier: 'langgenius/google:1.0.0@digest',
  provider: 'langgenius/google/google',
  provider_label: 'Google',
  title: 'Google Search',
  purpose: 'Search documents',
  node_id: 'search-node',
  node_ids: ['search-node', 'follow-up-node'],
  allowed_credential_types: ['api-key', 'oauth2'],
}

const makeParameters = (overrides: Partial<EntryParameters> = {}): EntryParameters => ({
  account_login_enabled: true,
  account_login_url: '/signin',
  allow_anonymous_end_user_auth: true,
  connection_revision: null,
  requires_end_user_connections: false,
  connection_requirements: [],
  ...overrides,
})

const makeEntryInput = (overrides: Partial<EntryInput> = {}): EntryInput => ({
  parameters: makeParameters(),
  loginStatus: { logged_in: false, app_logged_in: true },
  canAccess: true,
  appDataReady: true,
  hasError: false,
  ...overrides,
})

describe('Web App entry policy', () => {
  it.each([
    {
      supportsLogin: false,
      loggedIn: false,
      required: false,
      status: 'ready',
      canRun: true,
      showSignIn: false,
    },
    {
      supportsLogin: false,
      loggedIn: false,
      required: true,
      status: 'connections-pending',
      canRun: false,
      showSignIn: false,
    },
    {
      supportsLogin: false,
      loggedIn: true,
      required: false,
      status: 'ready',
      canRun: true,
      showSignIn: false,
    },
    {
      supportsLogin: false,
      loggedIn: true,
      required: true,
      status: 'connections-pending',
      canRun: false,
      showSignIn: false,
    },
    {
      supportsLogin: true,
      loggedIn: false,
      required: false,
      status: 'ready',
      canRun: true,
      showSignIn: true,
    },
    {
      supportsLogin: true,
      loggedIn: false,
      required: true,
      status: 'connections-pending',
      canRun: false,
      showSignIn: true,
    },
    {
      supportsLogin: true,
      loggedIn: true,
      required: false,
      status: 'ready',
      canRun: true,
      showSignIn: false,
    },
    {
      supportsLogin: true,
      loggedIn: true,
      required: true,
      status: 'connections-pending',
      canRun: false,
      showSignIn: false,
    },
  ])(
    'supports login=$supportsLogin, account logged in=$loggedIn, required connections=$required',
    ({ supportsLogin, loggedIn, required, status, canRun, showSignIn }) => {
      const state = getWebAppEntryState(
        makeEntryInput({
          parameters: makeParameters({
            account_login_enabled: supportsLogin,
            requires_end_user_connections: required,
            connection_requirements: required ? [requirement] : [],
          }),
          loginStatus: { logged_in: loggedIn, app_logged_in: true },
        }),
      )

      expect(state).toMatchObject({ status, canRun, showSignIn })
    },
  )

  it('treats a valid App passport as anonymous until the account is logged in', () => {
    const anonymous = getWebAppEntryState(makeEntryInput())
    const authenticated = getWebAppEntryState(
      makeEntryInput({
        loginStatus: { logged_in: true, app_logged_in: true },
      }),
    )

    expect(anonymous).toMatchObject({ account: 'anonymous', canRun: true, showSignIn: true })
    expect(authenticated).toMatchObject({ account: 'authenticated', showSignIn: false })
  })

  it.each([
    { name: 'App data', overrides: { appDataReady: false } },
    { name: 'parameters', overrides: { parameters: undefined } },
    { name: 'permission', overrides: { canAccess: undefined } },
  ] satisfies Array<{ name: string; overrides: Partial<EntryInput> }>)(
    'does not allow use before $name is known',
    ({ overrides }) => {
      expect(getWebAppEntryState(makeEntryInput(overrides))).toEqual({
        status: 'loading',
        canRun: false,
        showSignIn: false,
      })
    },
  )

  it.each([
    { name: 'permission is denied', overrides: { canAccess: false } },
    { name: 'initialization fails', overrides: { hasError: true } },
  ])('does not allow use when $name', ({ overrides }) => {
    expect(getWebAppEntryState(makeEntryInput(overrides))).toEqual({
      status: 'unavailable',
      canRun: false,
      showSignIn: false,
    })
  })

  it.each([
    { name: 'loading', overrides: { loginStatus: undefined }, account: 'loading' },
    { name: 'failed', overrides: { loginStatusError: true }, account: 'unavailable' },
  ])(
    'keeps a Workspace-only App runnable while optional account lookup is $name',
    ({ overrides, account }) => {
      expect(getWebAppEntryState(makeEntryInput(overrides))).toMatchObject({
        status: 'ready',
        account,
        canRun: true,
        showSignIn: false,
      })
    },
  )

  it.each([false, true])(
    'keeps required connections pending without preflight when anonymous auth is allowed=%s',
    (allowAnonymous) => {
      const parameters = makeParameters({
        allow_anonymous_end_user_auth: allowAnonymous,
        connection_revision: 'published-workflow',
        requires_end_user_connections: true,
        connection_requirements: [requirement],
      })
      const state = getWebAppEntryState(makeEntryInput({ parameters }))

      expect(state).toMatchObject({
        status: 'connections-pending',
        canRun: false,
        parameters: {
          connection_revision: 'published-workflow',
          connection_requirements: [requirement],
        },
      })
    },
  )
})

describe('SignIn entry integration', () => {
  it('uses the API Account sign-in origin and deployment prefix while preserving its other parameters', async () => {
    const user = userEvent.setup()
    const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => {})
    const input = makeEntryInput({
      parameters: makeParameters({
        account_login_url:
          'https://accounts.example/console/signin?source=webapp&redirect_url=old&is_end_user=0',
      }),
    })
    const { rerender } = render(
      <WebAppEntryContext value={getWebAppEntryState(input)}>
        <SignIn />
      </WebAppEntryContext>,
    )
    await user.click(screen.getByRole('button', { name: 'share.auth.signIn' }))
    await waitFor(() => expect(assign).toHaveBeenCalledOnce())
    const getDestination = () => new URL(assign.mock.lastCall![0].toString())
    expect(getDestination().origin).toBe('https://accounts.example')
    expect(getDestination().pathname).toBe('/console/signin')
    expect(getDestination().searchParams.get('source')).toBe('webapp')
    expect(getDestination().searchParams.get('is_end_user')).toBe('1')
    expect(getDestination().searchParams.get('redirect_url')).toBe(
      new URL('/chat/app-code', window.location.origin).href,
    )
    rerender(
      <WebAppEntryContext
        value={getWebAppEntryState({
          ...input,
          parameters: makeParameters({
            account_login_url: 'https://other-accounts.example/base/signin',
          }),
        })}
      >
        <SignIn />
      </WebAppEntryContext>,
    )
    await user.click(screen.getByRole('button', { name: 'share.auth.signIn' }))
    await waitFor(() => expect(assign).toHaveBeenCalledTimes(2))
    expect(getDestination().origin).toBe('https://other-accounts.example')
    expect(getDestination().pathname).toBe('/base/signin')
  })

  it('shows the existing demo sign-in action outside an entry provider', () => {
    render(<SignIn />)

    expect(screen.getByRole('button', { name: 'share.auth.signIn' })).toBeInTheDocument()
  })

  it.each([
    { name: 'loading', overrides: { appDataReady: false } },
    { name: 'unavailable', overrides: { hasError: true } },
    { name: 'account status unknown', overrides: { loginStatus: undefined } },
    { name: 'account status unavailable', overrides: { loginStatusError: true } },
    {
      name: 'login unavailable',
      overrides: { parameters: makeParameters({ account_login_enabled: false }) },
    },
    {
      name: 'already signed in',
      overrides: {
        loginStatus: { logged_in: true, app_logged_in: true } satisfies LoginStatusResponse,
      },
    },
  ] satisfies Array<{ name: string; overrides: Partial<EntryInput> }>)(
    'hides sign-in when entry is $name',
    ({ overrides }) => {
      render(
        <WebAppEntryContext value={getWebAppEntryState(makeEntryInput(overrides))}>
          <SignIn />
        </WebAppEntryContext>,
      )

      expect(screen.queryByRole('button', { name: 'share.auth.signIn' })).not.toBeInTheDocument()
    },
  )

  it('offers sign-in for an anonymous connection requirement and hides it after login', () => {
    const input = makeEntryInput({
      parameters: makeParameters({
        requires_end_user_connections: true,
        connection_requirements: [requirement],
      }),
    })
    const { rerender } = render(
      <WebAppEntryContext value={getWebAppEntryState(input)}>
        <SignIn />
      </WebAppEntryContext>,
    )

    expect(screen.getByRole('button', { name: 'share.auth.signIn' })).toBeInTheDocument()

    rerender(
      <WebAppEntryContext
        value={getWebAppEntryState({
          ...input,
          loginStatus: { logged_in: true, app_logged_in: true },
        })}
      >
        <SignIn />
      </WebAppEntryContext>,
    )

    expect(screen.queryByRole('button', { name: 'share.auth.signIn' })).not.toBeInTheDocument()
  })
})
