import type { AppEnvironment } from '@dify/contracts/enterprise-app-deploy/types.gen'
import type { ReactNode } from 'react'
import type { AccessPoint as AccessPointType } from '@/app/components/app/deploy/access-point'
import { EnvironmentStatus } from '@dify/contracts/enterprise-app-deploy/types.gen'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { consoleQuery } from '@/service/client'
import { seedAccountProfileQuery } from '@/test/console/account-profile'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { render } from '@/test/console/render'
import { createTestQueryClient } from '@/test/query-client'
import { AppACLPermission } from '@/utils/permission'
import AccessPoint from '..'

let appMode = 'workflow'
let appPermissionKeys: string[] = [AppACLPermission.Deploy]
const accessPointMocks = vi.hoisted(() => ({
  builtIn: vi.fn(),
  deployed: vi.fn(),
}))
const mockConsoleState = vi.hoisted(() => ({
  userProfile: { id: 'user-1' },
  workspacePermissionKeys: [] as string[],
}))

vi.mock('react-i18next', async () => {
  const { createReactI18nextMock } = await import('@/test/i18n-mock')
  return createReactI18nextMock({
    'workflow.nodes.common.memories.builtIn': 'Built-in',
  })
})

vi.mock('@/app/components/app/store', () => ({
  useStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      appDetail: {
        id: 'app-1',
        mode: appMode,
        maintainer: 'user-2',
        permission_keys: appPermissionKeys,
      },
    }),
}))

vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')
  return createPermissionStateModuleMock(() => mockConsoleState)
})

vi.mock('@/app/components/app/access-point/built-in-access-points', () => ({
  BuiltInAccessPoints: (props: { appId: string; highlightedAccessPoint?: AccessPointType }) => {
    accessPointMocks.builtIn(props)
    return null
  },
}))

vi.mock('@/app/components/app/access-point/deployed-environment-access-points', () => ({
  DeployedEnvironmentAccessPoints: (props: {
    appId: string
    canEdit: boolean
    canManage: boolean
    environmentId: string
    highlightedAccessPoint?: AccessPointType
  }) => {
    accessPointMocks.deployed(props)
    return null
  },
}))

const appEnvironments: AppEnvironment[] = [
  {
    id: 'staging',
    display_name: 'Staging',
    description: '',
    status: EnvironmentStatus.ENVIRONMENT_STATUS_READY,
    in_use: true,
  },
  {
    id: 'canary',
    display_name: 'Canary',
    description: '',
    status: EnvironmentStatus.ENVIRONMENT_STATUS_READY,
    in_use: true,
  },
  {
    id: 'qa',
    display_name: 'Quality Assurance',
    description: '',
    status: EnvironmentStatus.ENVIRONMENT_STATUS_READY,
    in_use: false,
  },
]

const renderAccessPoint = ({
  environments = appEnvironments,
  searchParams = '',
}: {
  environments?: AppEnvironment[]
  searchParams?: string
} = {}) => {
  const queryClient = createTestQueryClient()
  seedAccountProfileQuery(queryClient, mockConsoleState.userProfile)
  const queryOptions =
    consoleQuery.enterprise.appDeploy.deploymentService.listAppEnvironments.queryOptions({
      input: {
        params: {
          app_id: 'app-1',
        },
      },
    })
  queryClient.setQueryData(queryOptions.queryKey, { data: environments })
  const onUrlUpdate = vi.fn()

  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientTestProvider queryClient={queryClient}>
      <NuqsTestingAdapter searchParams={searchParams} onUrlUpdate={onUrlUpdate}>
        {children}
      </NuqsTestingAdapter>
    </QueryClientTestProvider>
  )

  return {
    ...render(<AccessPoint appId="app-1" />, { wrapper: Wrapper }),
    onUrlUpdate,
  }
}

describe('AccessPoint', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    appMode = 'workflow'
    appPermissionKeys = [AppACLPermission.Deploy]
  })

  it('renders Built-in and only in-use environments from the API', () => {
    renderAccessPoint()

    expect(screen.getByRole('heading', { name: 'common.appMenus.accessPoint' })).toBeInTheDocument()
    expect(accessPointMocks.builtIn).toHaveBeenCalledWith(
      expect.objectContaining({ appId: 'app-1' }),
    )
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Built-in',
      'Staging',
      'Canary',
    ])
    expect(screen.queryByRole('tab', { name: 'Quality Assurance' })).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Built-in' })).toHaveAttribute('aria-selected', 'true')
  })

  it('persists the selected environment in the URL', async () => {
    const user = userEvent.setup()
    const { onUrlUpdate } = renderAccessPoint()

    await user.click(screen.getByRole('tab', { name: 'Canary' }))

    expect(onUrlUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        queryString: '?environment=canary',
      }),
    )
  })

  it('selects the target environment and highlights its access point from the URL', () => {
    renderAccessPoint({
      searchParams: '?environment=canary&accessPoint=serviceApi',
    })

    expect(screen.getByRole('tab', { name: 'Canary' })).toHaveAttribute('aria-selected', 'true')
    expect(accessPointMocks.deployed).toHaveBeenCalledWith(
      expect.objectContaining({
        environmentId: 'canary',
        highlightedAccessPoint: 'serviceApi',
      }),
    )
  })

  it('highlights a built-in access point from the URL', () => {
    renderAccessPoint({
      searchParams: '?environment=built-in&accessPoint=mcp',
    })

    expect(screen.getByRole('tab', { name: 'Built-in' })).toHaveAttribute('aria-selected', 'true')
    expect(accessPointMocks.builtIn).toHaveBeenCalledWith(
      expect.objectContaining({ highlightedAccessPoint: 'mcp' }),
    )
  })

  it('clears the access point highlight when switching environment tabs', async () => {
    const user = userEvent.setup()
    const { onUrlUpdate } = renderAccessPoint({
      searchParams: '?environment=canary&accessPoint=serviceApi',
    })

    await user.click(screen.getByRole('tab', { name: 'Staging' }))

    expect(onUrlUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        queryString: '?environment=staging',
      }),
    )
    await waitFor(() => {
      expect(accessPointMocks.deployed).toHaveBeenLastCalledWith(
        expect.objectContaining({
          environmentId: 'staging',
          highlightedAccessPoint: null,
        }),
      )
    })
  })

  it('shows the selected deployed environment with deploy permissions', () => {
    renderAccessPoint({
      searchParams: '?environment=canary',
    })

    expect(accessPointMocks.deployed).toHaveBeenCalledWith(
      expect.objectContaining({
        appId: 'app-1',
        canEdit: false,
        canManage: true,
        environmentId: 'canary',
      }),
    )
    expect(accessPointMocks.builtIn).not.toHaveBeenCalled()
  })

  it('falls back to Built-in when the URL targets an unused environment', () => {
    renderAccessPoint({
      searchParams: '?environment=qa&accessPoint=mcp',
    })

    expect(screen.getByRole('tab', { name: 'Built-in' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByRole('tab', { name: 'Quality Assurance' })).not.toBeInTheDocument()
    expect(accessPointMocks.builtIn).toHaveBeenCalledWith(
      expect.objectContaining({ highlightedAccessPoint: null }),
    )
    expect(accessPointMocks.deployed).not.toHaveBeenCalled()
  })

  it('hides environment tabs for app types without multi-environment support', () => {
    appMode = 'chat'

    renderAccessPoint()

    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
    expect(accessPointMocks.builtIn).toHaveBeenCalledTimes(1)
    expect(accessPointMocks.deployed).not.toHaveBeenCalled()
  })

  it('falls back to built-in access points without app deploy ACL permission', () => {
    appPermissionKeys = []

    renderAccessPoint({
      searchParams: '?environment=canary',
    })

    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
    expect(accessPointMocks.builtIn).toHaveBeenCalledTimes(1)
    expect(accessPointMocks.deployed).not.toHaveBeenCalled()
  })
})
