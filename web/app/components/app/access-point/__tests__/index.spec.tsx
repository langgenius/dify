import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithNuqs } from '@/test/nuqs-testing'
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
  DeployedEnvironmentAccessPoints: ({ environmentId }: { environmentId: string }) => (
    <div data-testid="deployed-environment-access-points">{environmentId}</div>
  ),
}))

describe('AccessPoint', () => {
  beforeEach(() => {
    appMode = 'workflow'
    appPermissionKeys = [AppACLPermission.Deploy]
  })

  it('renders the page and environment tabs with app deploy ACL permission', () => {
    renderWithNuqs(<AccessPoint appId="app-1" />)

    expect(screen.getByRole('heading', { name: 'common.appMenus.accessPoint' })).toBeInTheDocument()
    expect(screen.getByTestId('built-in-access-points')).toHaveTextContent('app-1')
    expect(screen.getAllByRole('tab')).toHaveLength(9)
    expect(screen.getByRole('tab', { name: 'Built-in' })).toHaveAttribute('aria-selected', 'true')
  })

  it('persists the selected environment in the URL', async () => {
    const user = userEvent.setup()
    const { onUrlUpdate } = renderWithNuqs(<AccessPoint appId="app-1" />)

    await user.click(screen.getByRole('tab', { name: 'Canary' }))

    expect(onUrlUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        queryString: '?environment=canary',
      }),
    )
  })

  it('shows a read-only deployed environment view for non-built-in tabs', () => {
    renderWithNuqs(<AccessPoint appId="app-1" />, {
      searchParams: '?environment=canary',
    })

    expect(screen.getByTestId('deployed-environment-access-points')).toHaveTextContent('canary')
    expect(screen.queryByTestId('built-in-access-points')).not.toBeInTheDocument()
  })

  it('hides environment tabs for app types without multi-environment support', () => {
    appMode = 'chat'

    renderWithNuqs(<AccessPoint appId="app-1" />)

    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
    expect(screen.getByTestId('built-in-access-points')).toBeInTheDocument()
  })

  it('falls back to built-in access points without app deploy ACL permission', () => {
    appPermissionKeys = []

    renderWithNuqs(<AccessPoint appId="app-1" />, {
      searchParams: '?environment=canary',
    })

    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
    expect(screen.getByTestId('built-in-access-points')).toBeInTheDocument()
    expect(screen.queryByTestId('deployed-environment-access-points')).not.toBeInTheDocument()
  })
})
