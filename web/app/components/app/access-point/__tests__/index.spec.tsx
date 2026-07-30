import type { AppEnvironment } from '@dify/contracts/enterprise-app-deploy/types.gen'
import type { ReactNode } from 'react'
import { EnvironmentStatus } from '@dify/contracts/enterprise-app-deploy/types.gen'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { consoleQuery } from '@/service/client'
import { QueryClientTestProvider } from '@/test/console/query-provider'
import { render } from '@/test/console/render'
import { createTestQueryClient } from '@/test/query-client'
import { AppACLPermission } from '@/utils/permission'
import AccessPoint from '..'

let appMode = 'workflow'
let appPermissionKeys: string[] = [AppACLPermission.Deploy]
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

vi.mock('@/context/account-state', async () => {
  const { createAccountStateModuleMock } = await import('@/test/console/state-fixture')
  return createAccountStateModuleMock(() => mockConsoleState)
})

vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')
  return createPermissionStateModuleMock(() => mockConsoleState)
})

vi.mock('@/app/components/app/access-point/built-in-access-points', () => ({
  BuiltInAccessPoints: ({ appId }: { appId: string }) => (
    <div data-testid="built-in-access-points">{appId}</div>
  ),
}))

vi.mock('@/app/components/app/access-point/deployed-environment-access-points', () => ({
  DeployedEnvironmentAccessPoints: ({
    appId,
    canEdit,
    canManage,
    environmentId,
  }: {
    appId: string
    canEdit: boolean
    canManage: boolean
    environmentId: string
  }) => (
    <div
      data-testid="deployed-environment-access-points"
      data-app-id={appId}
      data-can-edit={String(canEdit)}
      data-can-manage={String(canManage)}
    >
      {environmentId}
    </div>
  ),
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
    appMode = 'workflow'
    appPermissionKeys = [AppACLPermission.Deploy]
  })

  it('renders Built-in and only in-use environments from the API', () => {
    renderAccessPoint()

    expect(screen.getByRole('heading', { name: 'common.appMenus.accessPoint' })).toBeInTheDocument()
    expect(screen.getByTestId('built-in-access-points')).toHaveTextContent('app-1')
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

  it('shows the selected deployed environment with deploy permissions', () => {
    renderAccessPoint({
      searchParams: '?environment=canary',
    })

    expect(screen.getByTestId('deployed-environment-access-points')).toHaveTextContent('canary')
    expect(screen.getByTestId('deployed-environment-access-points')).toHaveAttribute(
      'data-app-id',
      'app-1',
    )
    expect(screen.getByTestId('deployed-environment-access-points')).toHaveAttribute(
      'data-can-edit',
      'false',
    )
    expect(screen.getByTestId('deployed-environment-access-points')).toHaveAttribute(
      'data-can-manage',
      'true',
    )
    expect(screen.queryByTestId('built-in-access-points')).not.toBeInTheDocument()
  })

  it('falls back to Built-in when the URL targets an unused environment', () => {
    renderAccessPoint({
      searchParams: '?environment=qa',
    })

    expect(screen.getByRole('tab', { name: 'Built-in' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByRole('tab', { name: 'Quality Assurance' })).not.toBeInTheDocument()
    expect(screen.getByTestId('built-in-access-points')).toBeInTheDocument()
    expect(screen.queryByTestId('deployed-environment-access-points')).not.toBeInTheDocument()
  })

  it('hides environment tabs for app types without multi-environment support', () => {
    appMode = 'chat'

    renderAccessPoint()

    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
    expect(screen.getByTestId('built-in-access-points')).toBeInTheDocument()
  })

  it('falls back to built-in access points without app deploy ACL permission', () => {
    appPermissionKeys = []

    renderAccessPoint({
      searchParams: '?environment=canary',
    })

    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
    expect(screen.getByTestId('built-in-access-points')).toBeInTheDocument()
    expect(screen.queryByTestId('deployed-environment-access-points')).not.toBeInTheDocument()
  })
})
