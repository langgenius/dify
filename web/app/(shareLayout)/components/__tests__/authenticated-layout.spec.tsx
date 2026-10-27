import type {
  LoginStatusResponse,
  WebAppParametersResponse,
} from '@dify/contracts/api/web/types.gen'
import type { AppData, AppMeta } from '@/models/share'
import type { WebAppAddress } from '@/service/webapp-address'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SignIn from '@/app/components/share/sign-in'
import { useWebAppEntry } from '@/app/components/share/webapp-entry'
import { useWebAppStore } from '@/context/web-app-context'
import { webAppLogout } from '@/service/webapp-auth'
import AuthenticatedLayout from '../authenticated-layout'

type QueryState<TData> = {
  data?: TData
  error?: Error | null
  isLoading: boolean
  isFetching: boolean
}

type UserCanAccessApp = {
  result: boolean
}

type EntryParameters = Pick<
  WebAppParametersResponse,
  | 'user_input_form'
  | 'account_login_enabled'
  | 'account_login_url'
  | 'allow_anonymous_end_user_auth'
  | 'connection_revision'
  | 'requires_end_user_connections'
  | 'connection_requirements'
>

const makeParameters = (): EntryParameters => ({
  user_input_form: [],
  account_login_enabled: true,
  account_login_url: '/signin',
  allow_anonymous_end_user_auth: true,
  connection_revision: 'workflow-id',
  requires_end_user_connections: false,
  connection_requirements: [],
})

const replace = vi.fn()
const webAppAddress: WebAppAddress = { kind: 'default', code: 'share-code' }

const appInfoQueryState: QueryState<AppData> = {
  data: {
    app_id: 'app-id',
    custom_config: null,
    site: {
      title: 'Workflow App',
    },
  },
  error: null,
  isLoading: false,
  isFetching: false,
}

const appParamsQueryState: QueryState<EntryParameters> = {
  data: makeParameters(),
  error: null,
  isLoading: false,
  isFetching: false,
}

const appMetaQueryState: QueryState<AppMeta> = {
  data: {
    tool_icons: {},
  },
  error: null,
  isLoading: false,
  isFetching: false,
}

const userCanAccessAppQueryState: QueryState<UserCanAccessApp> = {
  data: {
    result: true,
  },
  error: null,
  isLoading: false,
  isFetching: false,
}

const accountStatusQueryState: QueryState<LoginStatusResponse> = {
  data: { logged_in: false, app_logged_in: true },
  error: null,
  isLoading: false,
  isFetching: false,
}

vi.mock('@/next/navigation', () => ({
  usePathname: () => '/workflow/share-code',
  useRouter: () => ({
    replace,
  }),
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/service/use-share', () => ({
  useGetWebAppInfo: () => appInfoQueryState,
  useGetWebAppParams: () => appParamsQueryState,
  useGetWebAppMeta: () => appMetaQueryState,
  useGetWebAppAccountStatus: () => accountStatusQueryState,
}))

vi.mock('@/service/access-control/use-app-access-control', () => ({
  useGetUserCanAccessApp: () => userCanAccessAppQueryState,
}))

vi.mock('@/service/webapp-auth', () => ({
  webAppLogout: vi.fn(),
  getWebAppAccessToken: () => '',
  getWebAppLoginMode: () => 'console',
  expireWebAppAccountSession: vi.fn(),
}))

vi.mock('@/service/webapp-address', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/webapp-address')>()),
  resolveWebAppAddress: () => webAppAddress,
}))

const resetQueryStates = () => {
  appInfoQueryState.data = {
    app_id: 'app-id',
    custom_config: null,
    site: {
      title: 'Workflow App',
    },
  }
  appInfoQueryState.error = null
  appInfoQueryState.isLoading = false
  appInfoQueryState.isFetching = false

  appParamsQueryState.data = makeParameters()
  appParamsQueryState.error = null
  appParamsQueryState.isLoading = false
  appParamsQueryState.isFetching = false

  appMetaQueryState.data = {
    tool_icons: {},
  }
  appMetaQueryState.error = null
  appMetaQueryState.isLoading = false
  appMetaQueryState.isFetching = false

  userCanAccessAppQueryState.data = {
    result: true,
  }
  userCanAccessAppQueryState.error = null
  userCanAccessAppQueryState.isLoading = false
  userCanAccessAppQueryState.isFetching = false

  accountStatusQueryState.data = { logged_in: false, app_logged_in: true }
  accountStatusQueryState.error = null
  accountStatusQueryState.isLoading = false
  accountStatusQueryState.isFetching = false
}

function WorkflowEntry() {
  const entry = useWebAppEntry()
  return (
    <>
      <input aria-label="Workflow draft" defaultValue="" />
      <button type="button" disabled={!entry?.canRun}>
        Run App
      </button>
      <output aria-label="App entry status">{entry?.status}</output>
      <output aria-label="Account status">
        {entry && 'account' in entry ? entry.account : ''}
      </output>
      <SignIn />
    </>
  )
}

const layout = (
  <AuthenticatedLayout>
    <WorkflowEntry />
  </AuthenticatedLayout>
)
const renderLayout = () => render(layout)

describe('AuthenticatedLayout', () => {
  beforeEach(() => {
    resetQueryStates()
    useWebAppStore.setState({ shareCode: 'share-code' })
  })

  describe('Loading State', () => {
    it('should preserve the draft while App, access, and account data refetch in the background', async () => {
      const user = userEvent.setup()
      const { rerender } = renderLayout()
      await user.type(screen.getByRole('textbox', { name: 'Workflow draft' }), 'Unsaved draft')
      appInfoQueryState.isFetching = true
      appParamsQueryState.isFetching = true
      appMetaQueryState.isFetching = true
      userCanAccessAppQueryState.isFetching = true
      accountStatusQueryState.isFetching = true

      rerender(
        <AuthenticatedLayout>
          <WorkflowEntry />
        </AuthenticatedLayout>,
      )
      expect(screen.getByRole('textbox', { name: 'Workflow draft' })).toHaveValue('Unsaved draft')
      expect(screen.getByRole('button', { name: 'Run App' })).toBeEnabled()
    })

    it('should hide children while initial app config is loading', () => {
      appInfoQueryState.data = undefined
      appInfoQueryState.isLoading = true
      appInfoQueryState.isFetching = true

      renderLayout()

      expect(screen.queryByRole('textbox', { name: 'Workflow draft' })).not.toBeInTheDocument()
    })

    it.each([
      { name: 'parameters', query: appParamsQueryState },
      { name: 'permission', query: userCanAccessAppQueryState },
    ])('should withhold children until initial $name is known', ({ query }) => {
      query.data = undefined
      query.isLoading = true
      query.isFetching = true

      renderLayout()

      expect(screen.queryByRole('textbox', { name: 'Workflow draft' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Run App' })).not.toBeInTheDocument()
    })
  })

  it.each([
    { name: 'App', query: appInfoQueryState },
    { name: 'parameters', query: appParamsQueryState },
    { name: 'permission', query: userCanAccessAppQueryState },
  ])('should show an unavailable page when initial $name lookup fails', ({ name, query }) => {
    query.data = undefined
    query.error = new Error(`${name} lookup failed`)

    renderLayout()

    expect(screen.getByText(`${name} lookup failed`)).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Workflow draft' })).not.toBeInTheDocument()
  })

  it('should allow an anonymous user with an App passport to use a Workspace-only App', () => {
    renderLayout()

    expect(screen.getByRole('status', { name: 'Account status' })).toHaveTextContent('anonymous')
    expect(screen.getByRole('status', { name: 'App entry status' })).toHaveTextContent('ready')
    expect(screen.getByRole('button', { name: 'Run App' })).toBeEnabled()
    expect(screen.getByRole('link', { name: 'share.auth.signIn' })).toBeInTheDocument()
  })

  it('should keep a Workspace-only App runnable while optional account status is loading', () => {
    accountStatusQueryState.data = undefined
    accountStatusQueryState.isLoading = true
    accountStatusQueryState.isFetching = true

    renderLayout()

    expect(screen.getByRole('textbox', { name: 'Workflow draft' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run App' })).toBeEnabled()
    expect(screen.getByRole('status', { name: 'Account status' })).toHaveTextContent('loading')
    expect(screen.queryByRole('link', { name: 'share.auth.signIn' })).not.toBeInTheDocument()
  })

  it('should preserve the draft and allow use when optional account lookup fails', async () => {
    const user = userEvent.setup()
    const { rerender } = renderLayout()
    await user.type(screen.getByRole('textbox', { name: 'Workflow draft' }), 'Unsaved draft')
    accountStatusQueryState.error = new Error('Account lookup failed')

    rerender(
      <AuthenticatedLayout>
        <WorkflowEntry />
      </AuthenticatedLayout>,
    )

    expect(screen.getByRole('textbox', { name: 'Workflow draft' })).toHaveValue('Unsaved draft')
    expect(screen.getByRole('button', { name: 'Run App' })).toBeEnabled()
    expect(screen.getByRole('status', { name: 'Account status' })).toHaveTextContent('unavailable')
    expect(screen.queryByRole('link', { name: 'share.auth.signIn' })).not.toBeInTheDocument()
  })

  it.each([
    { name: 'anonymous', loginStatus: { logged_in: false, app_logged_in: true } },
    { name: 'authenticated', loginStatus: { logged_in: true, app_logged_in: true } },
    { name: 'unknown', loginStatus: undefined },
  ])(
    'should keep required connections pending for an $name account until preflight',
    ({ loginStatus }) => {
      accountStatusQueryState.data = loginStatus
      appParamsQueryState.data = {
        ...makeParameters(),
        requires_end_user_connections: true,
        connection_requirements: [
          {
            provider: 'langgenius/google/google',
            title: 'Search',
            purpose: 'Search documents',
            node_id: 'search-node',
            icon: '/provider-icon.svg',
            icon_dark: null,
            plugin_unique_identifier: 'langgenius/google:1.0.0@digest',
            node_ids: ['search-node', 'follow-up-node'],
            allowed_credential_types: ['api-key'],
          },
        ],
      }

      renderLayout()

      expect(screen.getByRole('status', { name: 'App entry status' })).toHaveTextContent(
        'connections-pending',
      )
      expect(screen.getByRole('button', { name: 'Run App' })).toBeDisabled()
    },
  )

  it('should expose the unauthorized logout action as a button', async () => {
    const user = userEvent.setup()
    userCanAccessAppQueryState.data = { result: false }

    renderLayout()

    await user.click(screen.getByRole('button', { name: 'common.userProfile.logout' }))

    expect(webAppLogout).toHaveBeenCalledWith(webAppAddress)
    expect(replace).toHaveBeenCalledWith('/webapp-signin?redirect_url=%2Fworkflow%2Fshare-code')
  })
})
