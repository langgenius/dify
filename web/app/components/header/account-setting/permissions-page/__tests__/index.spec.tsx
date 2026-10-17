import type { Role } from '@/models/access-control'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { useRoleGroups } from '../hooks'
import PermissionsPage from '../index'

const mocks = vi.hoisted(() => ({
  workspacePermissionKeys: [] as string[],
  createWorkspaceRole: vi.fn(),
  updateWorkspaceRole: vi.fn(),
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.rbac.roles.post': mocks.createWorkspaceRole,
      'workspaces.current.rbac.roles.byRoleId.put': mocks.updateWorkspaceRole,
    }),
  }
})

vi.mock('@/app/notifications', () => ({
  toast: {
    success: vi.fn(),
  },
}))

vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')
  return createPermissionStateModuleMock(() => ({
    workspacePermissionKeys: mocks.workspacePermissionKeys,
  }))
})

vi.mock('../hooks', () => ({
  useRoleGroups: vi.fn(),
}))

vi.mock('../role-list', () => ({
  default: ({
    groups,
    isLoading,
    isFetchingNextPage,
    onView,
    onEdit,
  }: {
    groups: Array<{ items: Role[] }>
    isLoading?: boolean
    isFetchingNextPage?: boolean
    onView: (role: Role) => void
    onEdit: (role: Role) => void
  }) => {
    const role = groups[0]?.items[0]

    return (
      <div>
        {isLoading && <span>initial role loading</span>}
        {isFetchingNextPage && <span>next role page loading</span>}
        {role && (
          <>
            <span>{role.name}</span>
            <button type="button" onClick={() => onView(role)}>
              view role
            </button>
            <button type="button" onClick={() => onEdit(role)}>
              edit role
            </button>
          </>
        )}
      </div>
    )
  },
}))

vi.mock('../role-modal', () => ({
  default: ({
    mode,
    role,
    onSubmit,
  }: {
    mode: string
    role?: Role
    onSubmit: (data: { name: string; description: string; permissionKeys: string[] }) => void
  }) => (
    <div role="dialog" aria-label={`${mode} role`}>
      <span>{role?.name}</span>
      <button
        type="button"
        onClick={() =>
          onSubmit({
            name: `${mode} name`,
            description: `${mode} description`,
            permissionKeys: ['workspace.member.manage'],
          })
        }
      >
        submit role
      </button>
    </div>
  ),
}))

const role: Role = {
  id: 'role-1',
  tenant_id: 'tenant-1',
  type: 'workspace',
  category: 'global_custom',
  name: 'Custom manager',
  description: 'Can manage workspace members',
  is_builtin: false,
  permission_keys: ['workspace.member.manage'],
  role_tag: '',
}

const renderPermissionsPage = () => {
  const containerRef = {
    current: document.createElement('div'),
  }

  Object.defineProperty(containerRef.current, 'clientHeight', {
    configurable: true,
    value: 800,
  })

  return render(<PermissionsPage containerRef={containerRef} />)
}

describe('PermissionsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.workspacePermissionKeys = []
    vi.mocked(useRoleGroups).mockReturnValue({
      roleGroups: [
        {
          id: 'custom',
          category: 'global_custom',
          title: 'Custom roles',
          items: [role],
        },
      ],
      isLoading: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      hasNextPage: false,
      error: null,
    } as ReturnType<typeof useRoleGroups>)
    mocks.createWorkspaceRole.mockResolvedValue(role)
    mocks.updateWorkspaceRole.mockResolvedValue(role)
  })

  it('hides role creation without workspace role manage permission', () => {
    renderPermissionsPage()

    expect(
      screen.queryByRole('button', { name: 'permission.role.addRole' }),
    ).not.toBeInTheDocument()
    expect(screen.getByText('Custom manager')).toBeInTheDocument()
  })

  it('passes role loading states to the role list', () => {
    vi.mocked(useRoleGroups).mockReturnValue({
      roleGroups: [],
      isLoading: true,
      isFetchingNextPage: true,
      fetchNextPage: vi.fn(),
      hasNextPage: true,
      error: null,
    } as ReturnType<typeof useRoleGroups>)

    renderPermissionsPage()

    expect(screen.getByText('initial role loading')).toBeInTheDocument()
    expect(screen.getByText('next role page loading')).toBeInTheDocument()
  })

  it('creates workspace roles when role management is allowed', async () => {
    mocks.workspacePermissionKeys = ['workspace.role.manage']

    renderPermissionsPage()

    await userEvent.click(screen.getByRole('button', { name: 'permission.role.addRole' }))
    expect(screen.getByRole('dialog', { name: 'create role' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'submit role' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mocks.createWorkspaceRole).toHaveBeenCalledWith({
      body: {
        name: 'create name',
        description: 'create description',
        permission_keys: ['workspace.member.manage'],
      },
    })
  })

  it('updates the selected workspace role from the edit modal', async () => {
    renderPermissionsPage()

    await userEvent.click(screen.getByRole('button', { name: 'edit role' }))
    const dialog = screen.getByRole('dialog', { name: 'edit role' })
    expect(dialog).toBeInTheDocument()
    expect(within(dialog).getByText('Custom manager')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'submit role' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mocks.updateWorkspaceRole).toHaveBeenCalledWith({
      params: { role_id: 'role-1' },
      body: {
        name: 'edit name',
        description: 'edit description',
        permission_keys: ['workspace.member.manage'],
      },
    })
  })
  it('keeps the role modal open until creation succeeds', async () => {
    const response = createDeferred<Role>()
    mocks.createWorkspaceRole.mockReturnValue(response.promise)
    mocks.workspacePermissionKeys = ['workspace.role.manage']
    renderPermissionsPage()
    await userEvent.click(screen.getByRole('button', { name: 'permission.role.addRole' }))
    await userEvent.click(screen.getByRole('button', { name: 'submit role' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await act(async () => response.resolve(role))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})
