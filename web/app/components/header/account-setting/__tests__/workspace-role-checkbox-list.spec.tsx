import type { Role } from '@/models/access-control'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import WorkspaceRoleCheckboxList from '../workspace-role-checkbox-list'

const { mockWorkspaceRoleListHook } = vi.hoisted(() => ({
  mockWorkspaceRoleListHook: vi.fn(),
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.rbac.roles.get': () => mockWorkspaceRoleListHook(),
    }),
  }
})

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
    mockWorkspaceRoleListHook.mockResolvedValue({
      data: mockRoles,
      pagination: { total_count: 2, per_page: 20, current_page: 1, total_pages: 1 },
    })
  })

  it('should provide one named keyboard stop per role and toggle from its label', async () => {
    const user = userEvent.setup()
    const onSelectedRolesChange = vi.fn()
    render(
      <WorkspaceRoleCheckboxList
        selectedRoleIds={[]}
        onSelectedRolesChange={onSelectedRolesChange}
      />,
    )

    const firstRole = await screen.findByRole('checkbox', { name: /First role/i })
    const secondRole = screen.getByRole('checkbox', { name: /Second role/i })
    await user.click(await screen.findByText('First role'))
    expect(onSelectedRolesChange).toHaveBeenLastCalledWith([mockRoles[0]])

    firstRole.focus()
    await user.tab()
    expect(secondRole).toHaveFocus()
    await user.keyboard(' ')
    expect(onSelectedRolesChange).toHaveBeenLastCalledWith([mockRoles[1]])
  })

  it('should prevent changing disabled roles through their labels', async () => {
    const user = userEvent.setup()
    const onSelectedRolesChange = vi.fn()
    render(
      <WorkspaceRoleCheckboxList
        selectedRoleIds={[]}
        disabledRoleIds={['role-1']}
        onSelectedRolesChange={onSelectedRolesChange}
      />,
    )

    await user.click(await screen.findByText('First role'))
    expect(onSelectedRolesChange).not.toHaveBeenCalled()
    expect(screen.getByRole('checkbox', { name: /First role/i })).toHaveAttribute('data-disabled')
  })

  it('should render radios when only one role is allowed', async () => {
    render(
      <WorkspaceRoleCheckboxList
        selectedRoleIds={['role-1']}
        selectedRoles={[mockRoles[0]!]}
        allowMultipleRoles={false}
        onSelectedRolesChange={vi.fn()}
      />,
    )

    const selectedRole = await screen.findByRole('radio', { name: /First role/i })
    const unselectedRole = screen.getByRole('radio', { name: /Second role/i })
    expect(selectedRole).toHaveAttribute('data-checked', '')
    expect(unselectedRole).not.toHaveAttribute('data-checked')
    expect(screen.queryByRole('checkbox', { name: /First role/i })).not.toBeInTheDocument()
  })

  it('should clear the role search and return focus to the search input', async () => {
    const user = userEvent.setup()

    render(
      <WorkspaceRoleCheckboxList
        selectedRoleIds={[]}
        selectedRoles={[]}
        onSelectedRolesChange={vi.fn()}
      />,
    )

    const searchInput = screen.getByRole('searchbox', {
      name: 'permission.role.searchPlaceholder',
    })
    await screen.findByRole('checkbox', { name: /Second role/i })
    await user.type(searchInput, 'First')
    expect(screen.queryByRole('checkbox', { name: /Second role/i })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'common.operation.clear' }))

    expect(searchInput).toHaveValue('')
    expect(searchInput).toHaveFocus()
    expect(screen.getByRole('checkbox', { name: /Second role/i })).toBeInTheDocument()
  })

  it('should announce role loading and empty search results without moving focus', async () => {
    const user = userEvent.setup()

    render(<WorkspaceRoleCheckboxList selectedRoleIds={[]} onSelectedRolesChange={vi.fn()} />)

    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('permission.role.loading')
    await screen.findByRole('checkbox', { name: /First role/i })
    expect(status).toBeEmptyDOMElement()

    const searchInput = screen.getByRole('searchbox', {
      name: 'permission.role.searchPlaceholder',
    })
    await user.type(searchInput, 'No such role')

    expect(status).toBeInTheDocument()
    expect(status).toHaveTextContent('permission.role.noMatchingRoles')
    expect(searchInput).toHaveFocus()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()

    await user.clear(searchInput)

    expect(status).toBeEmptyDOMElement()
    expect(searchInput).toHaveFocus()
    expect(screen.getByRole('checkbox', { name: /First role/i })).toBeInTheDocument()
  })

  it('should expose disabled state on single-role options', async () => {
    render(
      <WorkspaceRoleCheckboxList
        selectedRoleIds={['role-1']}
        selectedRoles={[mockRoles[0]!]}
        allowMultipleRoles={false}
        disabledRoleIds={['role-1']}
        onSelectedRolesChange={vi.fn()}
      />,
    )

    expect(await screen.findByRole('radio', { name: /First role/i })).toHaveAttribute(
      'data-disabled',
      '',
    )
    expect(screen.getByRole('radio', { name: /Second role/i })).not.toHaveAttribute('data-disabled')
  })

  it('should show legacy role descriptions when only one role is allowed', async () => {
    mockWorkspaceRoleListHook.mockResolvedValue({
      data: ['admin', 'editor', 'normal', 'dataset_operator'].map((name) =>
        createRole({ id: name, name }),
      ),
      pagination: { total_count: 4, per_page: 20, current_page: 1, total_pages: 1 },
    })

    render(
      <WorkspaceRoleCheckboxList
        selectedRoleIds={['editor']}
        selectedRoles={[createRole({ id: 'editor', name: 'editor' })]}
        allowMultipleRoles={false}
        onSelectedRolesChange={vi.fn()}
      />,
    )

    expect(await screen.findByText('workspaceMembers.members.adminTip')).toBeInTheDocument()
    expect(screen.getByText('workspaceMembers.members.editorTip')).toBeInTheDocument()
    expect(screen.getByText('workspaceMembers.members.normalTip')).toBeInTheDocument()
    expect(screen.getByText('workspaceMembers.members.datasetOperatorTip')).toBeInTheDocument()
    expect(screen.queryByText('permission.role.noDescription')).not.toBeInTheDocument()
  })
})
