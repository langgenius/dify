import type { Role } from '@/models/access-control'
import { toast } from '@langgenius/dify-ui/toast'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useSelector as useAppContextSelector } from '@/context/app-context'
import { useCreateWorkspaceRole, useUpdateWorkspaceRole } from '@/service/access-control/use-workspace-roles'
import { useRoleGroups } from '../hooks'
import PermissionsPage from '../index'

const mocks = vi.hoisted(() => ({
  workspacePermissionKeys: [] as string[],
  createWorkspaceRole: vi.fn(),
  updateWorkspaceRole: vi.fn(),
}))

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: {
    success: vi.fn(),
  },
}))

vi.mock('@/context/app-context', () => ({
  useSelector: vi.fn((selector: (state: { workspacePermissionKeys: string[] }) => unknown) => selector({
    workspacePermissionKeys: mocks.workspacePermissionKeys,
  })),
}))

vi.mock('@/service/access-control/use-workspace-roles', () => ({
  useCreateWorkspaceRole: vi.fn(),
  useUpdateWorkspaceRole: vi.fn(),
}))

vi.mock('../hooks', () => ({
  useRoleGroups: vi.fn(),
}))

vi.mock('../role-list', () => ({
  default: ({
    groups,
    onView,
    onEdit,
  }: {
    groups: Array<{ items: Role[] }>
    onView: (role: Role) => void
    onEdit: (role: Role) => void
  }) => {
    const role = groups[0]!.items[0]!

    return (
      <div>
        <span>{role.name}</span>
        <button type="button" onClick={() => onView(role)}>view role</button>
        <button type="button" onClick={() => onEdit(role)}>edit role</button>
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
    onSubmit: (data: { name: string, description: string, permissionKeys: string[] }) => void
  }) => (
    <div role="dialog" aria-label={`${mode} role`}>
      <span>{role?.name}</span>
      <button
        type="button"
        onClick={() => onSubmit({
          name: `${mode} name`,
          description: `${mode} description`,
          permissionKeys: ['workspace.member.manage'],
        })}
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

const mockMutation = (mock: ReturnType<typeof vi.fn>) => {
  mock.mockImplementation((_payload, options) => {
    options?.onSuccess?.()
    return Promise.resolve()
  })

  return { mutateAsync: mock }
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
    vi.mocked(useAppContextSelector).mockImplementation((selector: (state: { workspacePermissionKeys: string[] }) => unknown) => selector({
      workspacePermissionKeys: mocks.workspacePermissionKeys,
    }))
    vi.mocked(useRoleGroups).mockReturnValue({
      roleGroups: [{
        id: 'global_custom',
        category: 'global_custom',
        title: 'Custom roles',
        items: [role],
      }],
      isLoading: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      hasNextPage: false,
      error: null,
    } as ReturnType<typeof useRoleGroups>)
    vi.mocked(useCreateWorkspaceRole).mockReturnValue(mockMutation(mocks.createWorkspaceRole) as ReturnType<typeof useCreateWorkspaceRole>)
    vi.mocked(useUpdateWorkspaceRole).mockReturnValue(mockMutation(mocks.updateWorkspaceRole) as ReturnType<typeof useUpdateWorkspaceRole>)
  })

  it('hides role creation without workspace role manage permission', () => {
    renderPermissionsPage()

    expect(screen.queryByRole('button', { name: 'permission.role.addRole' })).not.toBeInTheDocument()
    expect(screen.getByText('Custom manager')).toBeInTheDocument()
  })

  it('renders the workspace roles summary with the compact scheme bar style', () => {
    renderPermissionsPage()

    const title = screen.getByText('permission.role.workspaceRoles.title')
    const description = screen.getByText('permission.role.workspaceRoles.description')
    const schemeBar = title.parentElement?.parentElement as HTMLElement

    expect(schemeBar).toHaveClass(
      'min-h-[67px]',
      'overflow-hidden',
      'rounded-xl',
      'border-divider-regular',
      'px-4',
      'py-3',
    )
    expect(title).toHaveClass('truncate', 'system-md-semibold', 'text-text-secondary')
    expect(description).toHaveClass('truncate', 'system-xs-regular', 'text-text-tertiary')
  })

  it('creates workspace roles when role management is allowed', async () => {
    mocks.workspacePermissionKeys = ['workspace.role.manage']

    renderPermissionsPage()

    await userEvent.click(screen.getByRole('button', { name: 'permission.role.addRole' }))
    expect(screen.getByRole('dialog', { name: 'create role' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'submit role' }))

    expect(mocks.createWorkspaceRole).toHaveBeenCalledWith({
      name: 'create name',
      description: 'create description',
      permission_keys: ['workspace.member.manage'],
    }, expect.any(Object))
    expect(toast.success).toHaveBeenCalledWith('permission.role.created')
  })

  it('updates the selected workspace role from the edit modal', async () => {
    renderPermissionsPage()

    await userEvent.click(screen.getByRole('button', { name: 'edit role' }))
    const dialog = screen.getByRole('dialog', { name: 'edit role' })
    expect(dialog).toBeInTheDocument()
    expect(within(dialog).getByText('Custom manager')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'submit role' }))

    expect(mocks.updateWorkspaceRole).toHaveBeenCalledWith({
      id: 'role-1',
      name: 'edit name',
      description: 'edit description',
      permission_keys: ['workspace.member.manage'],
    }, expect.any(Object))
    expect(toast.success).toHaveBeenCalledWith('permission.role.updated')
  })
})
