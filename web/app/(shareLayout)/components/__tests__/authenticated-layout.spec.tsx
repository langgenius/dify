import type { AppData, AppMeta } from '@/models/share'
import type { WebAppAddress } from '@/service/webapp-address'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

const appParamsQueryState: QueryState<Record<string, unknown>> = {
  data: {
    user_input_form: [],
  },
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
}))

vi.mock('@/service/access-control/use-app-access-control', () => ({
  useGetUserCanAccessApp: () => userCanAccessAppQueryState,
}))

vi.mock('@/service/webapp-auth', () => ({
  webAppLogout: vi.fn(),
}))

vi.mock('@/service/webapp-address', () => ({
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

  appParamsQueryState.data = {
    user_input_form: [],
  }
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
}

const layout = (
  <AuthenticatedLayout>
    <input aria-label="Workflow draft" defaultValue="" />
  </AuthenticatedLayout>
)
const renderLayout = () => render(layout)

describe('AuthenticatedLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetQueryStates()
    useWebAppStore.setState({ shareCode: 'share-code' })
  })

  describe('Loading State', () => {
    it('should keep children mounted when existing app config is background refetching', async () => {
      const user = userEvent.setup()
      const { rerender } = renderLayout()
      await user.type(screen.getByRole('textbox', { name: 'Workflow draft' }), 'Unsaved draft')
      appInfoQueryState.isFetching = true
      appParamsQueryState.isFetching = true
      appMetaQueryState.isFetching = true

      rerender(
        <AuthenticatedLayout>
          <input aria-label="Workflow draft" defaultValue="" />
        </AuthenticatedLayout>,
      )
      expect(screen.getByRole('textbox', { name: 'Workflow draft' })).toHaveValue('Unsaved draft')
    })

    it('should hide children while initial app config is loading', () => {
      appInfoQueryState.data = undefined
      appInfoQueryState.isLoading = true
      appInfoQueryState.isFetching = true

      renderLayout()

      expect(screen.queryByRole('textbox', { name: 'Workflow draft' })).not.toBeInTheDocument()
    })
  })

  it('should expose the unauthorized logout action as a button', async () => {
    const user = userEvent.setup()
    userCanAccessAppQueryState.data = { result: false }

    renderLayout()

    await user.click(screen.getByRole('button', { name: 'common.userProfile.logout' }))

    expect(webAppLogout).toHaveBeenCalledWith(webAppAddress)
    expect(replace).toHaveBeenCalledWith('/webapp-signin?redirect_url=%2Fworkflow%2Fshare-code')
  })
})
