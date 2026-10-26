import type { Role } from '@/models/access-control'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import WorkspaceRolePicker from '../workspace-role-picker'

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

describe('WorkspaceRolePicker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWorkspaceRoleListHook.mockResolvedValue({
      data: mockRoles,
      pagination: { total_count: 2, per_page: 20, current_page: 1, total_pages: 1 },
    })
  })

  it.each([false, true])(
    'keeps keyboard focus in the input and selects a role without submitting (multiple=%s)',
    async (multiple) => {
      const user = userEvent.setup()
      const submit = vi.fn()
      function Picker() {
        const [selected, setSelected] = useState<Role[]>([])
        return (
          <form
            onSubmit={(event) => {
              event.preventDefault()
              submit(selected)
            }}
          >
            <WorkspaceRolePicker
              selectedRoleIds={selected.map((role) => role.id)}
              selectedRoles={selected}
              allowMultipleRoles={multiple}
              onSelectedRolesChange={setSelected}
            />
            <button type="submit">Confirm</button>
          </form>
        )
      }
      render(<Picker />)
      const input = screen.getByRole('combobox')
      const first = await screen.findByRole('option', { name: /First role/i })
      const second = screen.getByRole('option', { name: /Second role/i })
      await user.click(input)
      await user.keyboard('{ArrowDown}')
      await waitFor(() => expect(input).toHaveAttribute('aria-activedescendant', first.id))
      expect(first).toHaveAttribute('aria-selected', 'false')
      await user.keyboard('{ArrowDown}')
      await waitFor(() => expect(input).toHaveAttribute('aria-activedescendant', second.id))
      await user.keyboard('{Enter}')
      expect(second).toHaveAttribute('aria-selected', 'true')
      expect(input).toHaveFocus()
      expect(submit).not.toHaveBeenCalled()
      await user.tab()
      expect(screen.getByRole('button', { name: 'Confirm' })).toHaveFocus()
      await user.keyboard('{Enter}')
      expect(submit).toHaveBeenCalledExactlyOnceWith([mockRoles[1]])
    },
  )

  it('preserves the query and off-page selections when toggling filtered roles, and clears only the query', async () => {
    const user = userEvent.setup()
    const offPageRole = createRole({ id: 'off-page', name: 'Off-page role' })
    const change = vi.fn()
    function Picker() {
      const [selected, setSelected] = useState([offPageRole])
      return (
        <WorkspaceRolePicker
          selectedRoleIds={selected.map((role) => role.id)}
          selectedRoles={selected}
          onSelectedRolesChange={(roles) => {
            setSelected(roles)
            change(roles)
          }}
        />
      )
    }
    render(<Picker />)
    const input = screen.getByRole('combobox')
    await screen.findByRole('option', { name: /Second role/ })
    await user.type(input, 'Second')
    await user.keyboard('{ArrowDown}')
    await waitFor(() =>
      expect(input).toHaveAttribute(
        'aria-activedescendant',
        screen.getByRole('option', { name: /Second role/ }).id,
      ),
    )
    await user.keyboard('{Enter}')
    expect(change).toHaveBeenLastCalledWith([offPageRole, mockRoles[1]])
    expect(input).toHaveValue('Second')
    expect(input).toHaveFocus()
    expect(screen.getByRole('option', { name: /Second role/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await user.keyboard('{Enter}')
    expect(change).toHaveBeenLastCalledWith([offPageRole])
    expect(input).toHaveValue('Second')
    await user.keyboard('{Enter}')
    change.mockClear()
    await user.clear(input)
    expect(input).toHaveValue('')
    expect(input).toHaveFocus()
    expect(screen.getByRole('option', { name: /Second role/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(change).not.toHaveBeenCalled()
  })

  it('compares selected roles by ID instead of object identity', async () => {
    render(
      <WorkspaceRolePicker
        selectedRoleIds={['role-1']}
        selectedRoles={[{ ...mockRoles[0]! }]}
        onSelectedRolesChange={vi.fn()}
      />,
    )
    expect(await screen.findByRole('option', { name: /First role/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  it('should prevent changing disabled roles through their labels', async () => {
    const user = userEvent.setup()
    const onSelectedRolesChange = vi.fn()
    render(
      <WorkspaceRolePicker
        selectedRoleIds={[]}
        disabledRoleIds={['role-1']}
        onSelectedRolesChange={onSelectedRolesChange}
      />,
    )

    await user.click(await screen.findByText('First role'))
    expect(onSelectedRolesChange).not.toHaveBeenCalled()
    expect(screen.getByRole('option', { name: /First role/i })).toHaveAttribute('data-disabled')
  })

  it('exposes a single-select listbox when only one role is allowed', async () => {
    render(
      <WorkspaceRolePicker
        selectedRoleIds={['role-1']}
        selectedRoles={[mockRoles[0]!]}
        allowMultipleRoles={false}
        onSelectedRolesChange={vi.fn()}
      />,
    )

    const selectedRole = await screen.findByRole('option', { name: /First role/i })
    const unselectedRole = screen.getByRole('option', { name: /Second role/i })
    expect(selectedRole).toHaveAttribute('aria-selected', 'true')
    expect(unselectedRole).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByRole('listbox')).not.toHaveAttribute('aria-multiselectable')
  })

  it('keeps selections independent from native search text editing', async () => {
    const user = userEvent.setup()

    render(
      <WorkspaceRolePicker
        selectedRoleIds={[]}
        selectedRoles={[]}
        onSelectedRolesChange={vi.fn()}
      />,
    )

    const searchInput = screen.getByRole('combobox', {
      name: 'permission.role.searchPlaceholder',
    })
    await screen.findByRole('option', { name: /Second role/i })
    await user.type(searchInput, 'First')
    expect(screen.queryByRole('option', { name: /Second role/i })).not.toBeInTheDocument()
    await user.clear(searchInput)

    expect(searchInput).toHaveValue('')
    expect(searchInput).toHaveFocus()
    expect(screen.getByRole('option', { name: /Second role/i })).toBeInTheDocument()
  })

  it('should announce role loading and empty search results without moving focus', async () => {
    const user = userEvent.setup()

    render(<WorkspaceRolePicker selectedRoleIds={[]} onSelectedRolesChange={vi.fn()} />)

    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('permission.role.loading')
    await screen.findByRole('option', { name: /First role/i })
    expect(status).toBeEmptyDOMElement()

    const searchInput = screen.getByRole('combobox', {
      name: 'permission.role.searchPlaceholder',
    })
    await user.type(searchInput, 'No such role')

    expect(status).toBeInTheDocument()
    expect(status).toHaveTextContent('permission.role.noMatchingRoles')
    expect(searchInput).toHaveFocus()
    expect(screen.queryByRole('option')).not.toBeInTheDocument()

    await user.clear(searchInput)

    expect(status).toBeEmptyDOMElement()
    expect(searchInput).toHaveFocus()
    expect(screen.getByRole('option', { name: /First role/i })).toBeInTheDocument()
  })

  it('should expose disabled state on single-role options', async () => {
    render(
      <WorkspaceRolePicker
        selectedRoleIds={['role-1']}
        selectedRoles={[mockRoles[0]!]}
        allowMultipleRoles={false}
        disabledRoleIds={['role-1']}
        onSelectedRolesChange={vi.fn()}
      />,
    )

    expect(await screen.findByRole('option', { name: /First role/i })).toHaveAttribute(
      'data-disabled',
      '',
    )
    expect(screen.getByRole('option', { name: /Second role/i })).not.toHaveAttribute(
      'data-disabled',
    )
  })

  it('should show legacy role descriptions when only one role is allowed', async () => {
    mockWorkspaceRoleListHook.mockResolvedValue({
      data: ['admin', 'editor', 'normal', 'dataset_operator'].map((name) =>
        createRole({ id: name, name }),
      ),
      pagination: { total_count: 4, per_page: 20, current_page: 1, total_pages: 1 },
    })

    render(
      <WorkspaceRolePicker
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
