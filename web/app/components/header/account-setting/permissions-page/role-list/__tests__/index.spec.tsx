import type { Role } from '@/models/access-control'
import { render, screen } from '@testing-library/react'
import RoleList from '../index'

const mockWorkspacePermissionKeys = vi.hoisted(() => ({
  value: ['workspace.role.manage'] as string[],
}))

vi.mock('@/service/access-control/use-workspace-roles', () => ({
  useCopyWorkspaceRole: () => ({
    mutateAsync: vi.fn(),
  }),
  useDeleteWorkspaceRole: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useGetMembersOfRole: () => ({
    data: {
      data: [],
      pagination: {
        total_count: 0,
        per_page: 1,
        current_page: 1,
        total_pages: 1,
      },
    },
    isPending: false,
  }),
}))

const createRole = (overrides: Partial<Role> = {}): Role => ({
  id: 'role-1',
  tenant_id: 'tenant-1',
  type: 'workspace',
  category: 'global_system_default',
  name: 'Owner',
  description: 'Full access to all workspace features and settings',
  is_builtin: true,
  permission_keys: [],
  role_tag: '',
  ...overrides,
})

describe('RoleList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWorkspacePermissionKeys.value = ['workspace.role.manage']
  })

  describe('Rendering', () => {
    it('shows a loading status while the first page is loading', () => {
      render(
        <RoleList
          groups={[]}
          isLoading
        />,
      )

      expect(screen.getByRole('status', { name: 'appApi.loading' })).toBeInTheDocument()
      expect(screen.queryByText(/permission\.role\.groups/)).not.toBeInTheDocument()
    })

    it('renders role groups with compact section labels', () => {
      render(
        <RoleList
          groups={[
            {
              id: 'builtin',
              category: 'global_system_default',
              title: 'System Roles',
              items: [createRole()],
            },
            {
              id: 'custom',
              category: 'global_custom',
              title: 'Custom Roles',
              items: [createRole({
                id: 'role-custom',
                category: 'global_custom',
                name: 'Executive',
                description: 'Unrestricted access to all workspace operations',
                is_builtin: false,
              })],
            },
          ]}
        />,
      )

      const systemLabel = screen.getByText(/permission\.role\.groups\.builtin/)
      const customLabel = screen.getByText(/permission\.role\.groups\.custom/)

      expect(systemLabel).toHaveClass('min-h-6', 'system-sm-medium', 'text-text-secondary')
      expect(customLabel).toHaveClass('min-h-6', 'system-sm-medium', 'text-text-secondary')
      expect(screen.getByText('Owner')).toBeInTheDocument()
      expect(screen.getByText('Executive')).toBeInTheDocument()
    })

    it('shows a bottom loading status while fetching the next page', () => {
      render(
        <RoleList
          groups={[
            {
              id: 'builtin',
              category: 'global_system_default',
              title: 'System Roles',
              items: [createRole()],
            },
          ]}
          isFetchingNextPage
        />,
      )

      expect(screen.getByText('Owner')).toBeInTheDocument()
      expect(screen.getByRole('status', { name: 'appApi.loading' })).toBeInTheDocument()
    })
  })

  describe('Row Styles', () => {
    it('renders rows as divided hoverable list items', () => {
      render(
        <RoleList
          groups={[
            {
              id: 'builtin',
              category: 'global_system_default',
              title: 'System Roles',
              items: [createRole()],
            },
          ]}
        />,
      )

      const name = screen.getByText('Owner')
      const row = name.closest('.border-b')

      expect(row).toHaveClass(
        'border-b',
        'border-divider-regular',
        'px-3',
        'py-3.5',
        'hover:bg-background-default-hover',
      )
      expect(name).toHaveClass('truncate', 'system-sm-semibold', 'text-text-primary')
      expect(screen.getByText('Full access to all workspace features and settings')).toHaveClass(
        'truncate',
        'system-xs-regular',
        'text-text-secondary',
      )
    })

    it('uses the no-description fallback with the row description style', () => {
      render(
        <RoleList
          groups={[
            {
              id: 'custom',
              category: 'global_custom',
              title: 'Custom Roles',
              items: [createRole({
                id: 'role-custom',
                category: 'global_custom',
                name: 'Partner',
                description: '',
                is_builtin: false,
              })],
            },
          ]}
        />,
      )

      expect(screen.getByText('permission.role.noDescription')).toHaveClass(
        'truncate',
        'system-xs-regular',
        'text-text-secondary',
      )
    })
  })
})
