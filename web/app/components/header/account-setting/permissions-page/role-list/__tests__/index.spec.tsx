import type { Role } from '@/models/access-control'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import RoleList from '../index'

vi.mock('@/context/workspace-state', async () => {
  const { createWorkspaceStateModuleMock } = await import('@/test/console/state-fixture')
  return createWorkspaceStateModuleMock(() => ({
    currentWorkspace: { id: 'workspace-1' },
  }))
})

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

vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')

  return createPermissionStateModuleMock(() => ({
    workspacePermissionKeys: [],
  }))
})

describe('RoleList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('shows a loading status while the first page is loading', () => {
      render(<RoleList groups={[]} isLoading />)

      expect(screen.getByRole('progressbar', { name: 'common.loading' })).toBeInTheDocument()
      expect(screen.queryByText(/permission\.role\.groups/)).not.toBeInTheDocument()
    })

    it('routes a built-in role view action to the selected role across grouped rows', async () => {
      const user = userEvent.setup()
      const onView = vi.fn()
      render(
        <RoleList
          onView={onView}
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
              items: [
                createRole({
                  id: 'role-custom',
                  category: 'global_custom',
                  name: 'Executive',
                  description: 'Unrestricted access to all workspace operations',
                  is_builtin: false,
                }),
              ],
            },
          ]}
        />,
      )

      expect(screen.getByText('Owner')).toBeInTheDocument()
      expect(screen.getByText('Executive')).toBeInTheDocument()
      await user.click(screen.getAllByRole('button', { name: 'common.operation.moreActions' })[0]!)
      await user.click(await screen.findByRole('menuitem', { name: 'common.operation.view' }))
      expect(onView).toHaveBeenCalledWith(createRole())
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
      expect(screen.getByRole('progressbar', { name: 'common.loading' })).toBeInTheDocument()
    })
  })
})
