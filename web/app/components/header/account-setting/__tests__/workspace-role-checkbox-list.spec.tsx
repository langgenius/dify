import type { Role } from '@/models/access-control'
import { render, screen } from '@testing-library/react'
import { useWorkspaceRoleList } from '@/service/access-control/use-workspace-roles'
import WorkspaceRoleCheckboxList from '../workspace-role-checkbox-list'

vi.mock('@/service/access-control/use-workspace-roles')

const createRole = (overrides: Partial<Role>): Role => ({
  id: 'role-1',
  tenant_id: 'tenant-1',
  type: 'workspace',
  category: 'global_custom',
  name: 'Role',
  description: '',
  is_builtin: false,
  permission_keys: [],
  role_tag: '',
  ...overrides,
})

const mockRoles = [
  createRole({ id: 'role-1', name: 'First role' }),
  createRole({ id: 'role-2', name: 'Second role' }),
]

describe('WorkspaceRoleCheckboxList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useWorkspaceRoleList).mockReturnValue({
      data: {
        pages: [{
          data: mockRoles,
          pagination: {
            total_count: 2,
            per_page: 20,
            current_page: 1,
            total_pages: 1,
          },
        }],
        pageParams: [1],
      },
      isLoading: false,
      error: null,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
    } as unknown as ReturnType<typeof useWorkspaceRoleList>)
  })

  it('should render checkboxes when multiple roles are allowed', () => {
    render(
      <WorkspaceRoleCheckboxList
        selectedRoleIds={['role-1']}
        selectedRoles={[mockRoles[0]!]}
        onSelectedRolesChange={vi.fn()}
      />,
    )

    expect(screen.getByRole('checkbox', { name: /First role/i })).toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: /First role/i })).not.toBeInTheDocument()
  })

  it('should render radios when only one role is allowed', () => {
    render(
      <WorkspaceRoleCheckboxList
        selectedRoleIds={['role-1']}
        selectedRoles={[mockRoles[0]!]}
        allowMultipleRoles={false}
        onSelectedRolesChange={vi.fn()}
      />,
    )

    expect(screen.getByRole('radio', { name: /First role/i })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: /First role/i })).not.toBeInTheDocument()
  })

  it('should show legacy role descriptions when only one role is allowed', () => {
    vi.mocked(useWorkspaceRoleList).mockReturnValue({
      data: {
        pages: [{
          data: [
            createRole({ id: 'admin', name: 'admin' }),
            createRole({ id: 'editor', name: 'editor' }),
            createRole({ id: 'normal', name: 'normal' }),
            createRole({ id: 'dataset_operator', name: 'dataset_operator' }),
          ],
          pagination: {
            total_count: 4,
            per_page: 20,
            current_page: 1,
            total_pages: 1,
          },
        }],
        pageParams: [1],
      },
      isLoading: false,
      error: null,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
    } as unknown as ReturnType<typeof useWorkspaceRoleList>)

    render(
      <WorkspaceRoleCheckboxList
        selectedRoleIds={['editor']}
        selectedRoles={[createRole({ id: 'editor', name: 'editor' })]}
        allowMultipleRoles={false}
        onSelectedRolesChange={vi.fn()}
      />,
    )

    expect(screen.getByText('common.members.adminTip')).toBeInTheDocument()
    expect(screen.getByText('common.members.editorTip')).toBeInTheDocument()
    expect(screen.getByText('common.members.normalTip')).toBeInTheDocument()
    expect(screen.getByText('common.members.datasetOperatorTip')).toBeInTheDocument()
    expect(screen.queryByText('permission.role.noDescription')).not.toBeInTheDocument()
  })
})
