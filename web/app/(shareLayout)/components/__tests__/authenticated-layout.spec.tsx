import type { AppData, AppMeta } from '@/models/share'
import { render, screen } from '@testing-library/react'
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

const updateAppInfo = vi.fn()
const updateAppParams = vi.fn()
const updateWebAppMeta = vi.fn()
const updateUserCanAccessApp = vi.fn()

const mockWebAppState = {
  shareCode: 'share-code',
  updateAppInfo,
  updateAppParams,
  updateWebAppMeta,
  updateUserCanAccessApp,
}

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

vi.mock('@/context/web-app-context', () => ({
  useWebAppStore: (selector: (state: typeof mockWebAppState) => unknown) => selector(mockWebAppState),
}))

vi.mock('@/next/navigation', () => ({
  usePathname: () => '/workflow/share-code',
  useRouter: () => ({
    replace: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/service/use-share', () => ({
  useGetWebAppInfo: () => appInfoQueryState,
  useGetWebAppParams: () => appParamsQueryState,
  useGetWebAppMeta: () => appMetaQueryState,
}))

vi.mock('@/service/access-control', () => ({
  useGetUserCanAccessApp: () => userCanAccessAppQueryState,
}))

vi.mock('@/service/webapp-auth', () => ({
  webAppLogout: vi.fn(),
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

const renderLayout = () => render(
  <AuthenticatedLayout>
    <div>Workflow form content</div>
  </AuthenticatedLayout>,
)

describe('AuthenticatedLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetQueryStates()
  })

  describe('Loading State', () => {
    it('should keep children mounted when existing app config is background refetching', () => {
      appInfoQueryState.isFetching = true
      appParamsQueryState.isFetching = true
      appMetaQueryState.isFetching = true

      renderLayout()

      expect(screen.getByText('Workflow form content')).toBeInTheDocument()
    })

    it('should hide children while initial app config is loading', () => {
      appInfoQueryState.data = undefined
      appInfoQueryState.isLoading = true
      appInfoQueryState.isFetching = true

      renderLayout()

      expect(screen.queryByText('Workflow form content')).not.toBeInTheDocument()
    })
  })
})
