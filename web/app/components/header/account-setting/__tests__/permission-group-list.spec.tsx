import type { PermissionGroup } from '@/models/access-control'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PermissionGroupList from '../permission-group-list'

const createPermissionGroup = (overrides: Partial<PermissionGroup> = {}): PermissionGroup => ({
  group_key: 'app_management',
  group_name: 'App management',
  description: '',
  permissions: [
    {
      key: 'app.dsl.import',
      name: 'Import DSL',
      description: '',
    },
    {
      key: 'app.dsl.export',
      name: 'Export DSL',
      description: '',
    },
  ],
  ...overrides,
})

const permissionGroups = [
  createPermissionGroup(),
  createPermissionGroup({
    group_key: 'api_access',
    group_name: 'API access',
    permissions: [
      {
        key: 'app.api.view',
        name: 'View API',
        description: '',
      },
    ],
  }),
]

const getPermissionRow = (permissionName: string) =>
  screen.getByText(permissionName).closest('div')!

const getPermissionCheckbox = (permissionName: string) =>
  within(getPermissionRow(permissionName)).getByRole('checkbox')

describe('PermissionGroupList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering keeps the permission catalog visible as grouped collapsible rows.
  describe('Rendering', () => {
    it('should render the list as a flexible scroll region', () => {
      const { container } = render(
        <PermissionGroupList groups={permissionGroups} value={[]} onChange={vi.fn()} />,
      )

      expect(container.firstElementChild).toHaveClass('min-h-0', 'flex-1')
      expect(container.querySelector('.h-full.overflow-hidden')).toBeInTheDocument()
    })

    it('should render an empty state when there are no permission groups', () => {
      render(<PermissionGroupList groups={[]} value={[]} onChange={vi.fn()} />)

      expect(screen.getByText('permission.permissionList.noPermissionsFound')).toHaveClass(
        'flex',
        'h-full',
        'items-center',
        'justify-center',
      )
    })

    it('should expand the first selected group by default', () => {
      render(
        <PermissionGroupList
          groups={permissionGroups}
          value={['app.api.view']}
          onChange={vi.fn()}
        />,
      )

      expect(screen.getByRole('button', { name: /API access/ })).toHaveAttribute(
        'aria-expanded',
        'true',
      )
      expect(getPermissionCheckbox('View API')).toHaveAttribute('aria-checked', 'true')
      expect(screen.queryByText('Import DSL')).not.toBeInTheDocument()
    })
  })

  // Group rows can be expanded and collapsed without changing selected values.
  describe('Group Interaction', () => {
    it('should toggle a group when clicking its header', async () => {
      const user = userEvent.setup()

      render(<PermissionGroupList groups={permissionGroups} value={[]} onChange={vi.fn()} />)

      const apiGroupButton = screen.getByRole('button', { name: /API access/ })
      expect(apiGroupButton).toHaveAttribute('aria-expanded', 'false')

      await user.click(apiGroupButton)

      expect(apiGroupButton).toHaveAttribute('aria-expanded', 'true')
      expect(getPermissionCheckbox('View API')).toBeInTheDocument()
    })

    it('should toggle a group when clicking its arrow control', async () => {
      const user = userEvent.setup()

      render(<PermissionGroupList groups={permissionGroups} value={[]} onChange={vi.fn()} />)

      const apiGroupButton = screen.getByRole('button', { name: /API access/ })
      expect(apiGroupButton).toHaveAttribute('aria-expanded', 'false')

      await user.click(
        screen.getByRole('button', { name: 'permission.permissionList.expandGroup' }),
      )

      expect(apiGroupButton).toHaveAttribute('aria-expanded', 'true')
    })
  })

  // Checkbox interactions update only the selected permission key set.
  describe('Permission Interaction', () => {
    it('should add a permission when clicking an unchecked item row', async () => {
      const user = userEvent.setup()
      const handleChange = vi.fn()

      render(
        <PermissionGroupList
          groups={permissionGroups}
          value={['app.dsl.export']}
          onChange={handleChange}
        />,
      )

      await user.click(screen.getByText('Import DSL'))

      expect(handleChange).toHaveBeenCalledTimes(1)
      expect(handleChange).toHaveBeenCalledWith(['app.dsl.export', 'app.dsl.import'])
    })

    it('should remove a selected permission when clicking its item row', async () => {
      const user = userEvent.setup()
      const handleChange = vi.fn()

      render(
        <PermissionGroupList
          groups={permissionGroups}
          value={['app.dsl.export']}
          onChange={handleChange}
        />,
      )

      await user.click(screen.getByText('Export DSL'))

      expect(handleChange).toHaveBeenCalledTimes(1)
      expect(handleChange).toHaveBeenCalledWith([])
    })

    it('should show selected counts on groups with selected permissions', () => {
      render(
        <PermissionGroupList
          groups={permissionGroups}
          value={['app.dsl.export']}
          onChange={vi.fn()}
        />,
      )

      const appManagementRow = screen.getByRole('button', { name: /App management/ }).parentElement!
      expect(within(appManagementRow).getByText('1/2')).toBeInTheDocument()
    })

    it('should select all permissions in a group without toggling expansion', async () => {
      const user = userEvent.setup()
      const handleChange = vi.fn()

      render(<PermissionGroupList groups={permissionGroups} value={[]} onChange={handleChange} />)

      const appManagementButton = screen.getByRole('button', { name: /App management/ })
      const appManagementRow = appManagementButton.parentElement!
      await user.click(
        within(appManagementRow).getByRole('button', {
          name: 'permission.permissionList.selectAll',
        }),
      )

      expect(handleChange).toHaveBeenCalledTimes(1)
      expect(handleChange).toHaveBeenCalledWith(['app.dsl.import', 'app.dsl.export'])
      expect(appManagementButton).toHaveAttribute('aria-expanded', 'true')
    })

    it('should clear all permissions in a fully selected group', async () => {
      const user = userEvent.setup()
      const handleChange = vi.fn()

      render(
        <PermissionGroupList
          groups={permissionGroups}
          value={['app.dsl.import', 'app.dsl.export', 'app.api.view']}
          onChange={handleChange}
        />,
      )

      const appManagementRow = screen.getByRole('button', { name: /App management/ }).parentElement!
      await user.click(
        within(appManagementRow).getByRole('button', {
          name: 'permission.permissionList.clearAll',
        }),
      )

      expect(handleChange).toHaveBeenCalledTimes(1)
      expect(handleChange).toHaveBeenCalledWith(['app.api.view'])
    })
  })

  // Read-only mode still allows browsing groups but blocks permission mutation.
  describe('Read-only Mode', () => {
    it('should hide group bulk actions in read-only mode', () => {
      render(
        <PermissionGroupList
          groups={permissionGroups}
          value={['app.dsl.export']}
          onChange={vi.fn()}
          readonly
        />,
      )

      expect(
        screen.queryByRole('button', { name: 'permission.permissionList.selectAll' }),
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'permission.permissionList.clearAll' }),
      ).not.toBeInTheDocument()
    })

    it('should not change permissions when clicking a row or checkbox in read-only mode', async () => {
      const user = userEvent.setup()
      const handleChange = vi.fn()

      render(
        <PermissionGroupList
          groups={permissionGroups}
          value={['app.dsl.export']}
          onChange={handleChange}
          readonly
        />,
      )

      await user.click(screen.getByText('Import DSL'))
      await user.click(getPermissionCheckbox('Export DSL'))

      expect(handleChange).not.toHaveBeenCalled()
    })

    it('should still allow expanding groups in read-only mode', async () => {
      const user = userEvent.setup()

      render(
        <PermissionGroupList groups={permissionGroups} value={[]} onChange={vi.fn()} readonly />,
      )

      const apiGroupButton = screen.getByRole('button', { name: /API access/ })
      await user.click(apiGroupButton)

      expect(apiGroupButton).toHaveAttribute('aria-expanded', 'true')
      expect(getPermissionCheckbox('View API')).toBeInTheDocument()
    })
  })
})
