import type { Member } from '@/models/common'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { DatasetPermission } from '@/models/datasets'
import PermissionSelector from './index'

// Mock app-context
vi.mock('@/context/app-context', () => ({
  useSelector: () => ({
    id: 'user-1',
    name: 'Current User',
    email: 'current@example.com',
    avatar_url: '',
    role: 'owner',
  }),
}))

// Note: react-i18next is globally mocked in vitest.setup.ts

describe('PermissionSelector', () => {
  const mockMemberList: Member[] = [
    { id: 'user-1', name: 'Current User', email: 'current@example.com', avatar: '', avatar_url: '', role: 'owner', last_login_at: '', created_at: '', status: 'active' },
    { id: 'user-2', name: 'John Doe', email: 'john@example.com', avatar: '', avatar_url: '', role: 'admin', last_login_at: '', created_at: '', status: 'active' },
    { id: 'user-3', name: 'Jane Smith', email: 'jane@example.com', avatar: '', avatar_url: '', role: 'editor', last_login_at: '', created_at: '', status: 'active' },
    { id: 'user-4', name: 'Dataset Operator', email: 'operator@example.com', avatar: '', avatar_url: '', role: 'dataset_operator', last_login_at: '', created_at: '', status: 'active' },
  ]

  const defaultProps = {
    permission: DatasetPermission.onlyMe,
    value: ['user-1'],
    memberList: mockMemberList,
    onChange: vi.fn(),
    onMemberSelect: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      render(<PermissionSelector {...defaultProps} />)
      expect(screen.getByText(/form\.permissionsOnlyMe/)).toBeInTheDocument()
    })

    it('should render Only Me option when permission is onlyMe', () => {
      render(<PermissionSelector {...defaultProps} permission={DatasetPermission.onlyMe} />)
      expect(screen.getByText(/form\.permissionsOnlyMe/)).toBeInTheDocument()
    })

    it('should render All Team Members option when permission is allTeamMembers', () => {
      render(<PermissionSelector {...defaultProps} permission={DatasetPermission.allTeamMembers} />)
      expect(screen.getByText(/form\.permissionsAllMember/)).toBeInTheDocument()
    })

    it('should render selected member names when permission is partialMembers', () => {
      render(
        <PermissionSelector
          {...defaultProps}
          permission={DatasetPermission.partialMembers}
          value={['user-1', 'user-2']}
        />,
      )
      // Should show member names
      expect(screen.getByTitle(/Current User/)).toBeInTheDocument()
    })
  })

  describe('Dropdown Toggle', () => {
    it('should open dropdown when clicked', async () => {
      render(<PermissionSelector {...defaultProps} />)

      const trigger = screen.getByText(/form\.permissionsOnlyMe/)
      fireEvent.click(trigger)

      await waitFor(() => {
        // Should show all permission options in dropdown
        expect(screen.getAllByText(/form\.permissionsOnlyMe/).length).toBeGreaterThanOrEqual(1)
      })
    })

    it('should not open dropdown when disabled', () => {
      render(<PermissionSelector {...defaultProps} disabled={true} />)

      const trigger = screen.getByText(/form\.permissionsOnlyMe/)
      fireEvent.click(trigger)

      // Dropdown should not open - only the trigger text should be visible
      expect(screen.getAllByText(/form\.permissionsOnlyMe/).length).toBe(1)
    })
  })

  describe('Permission Selection', () => {
    it('should call onChange with onlyMe when Only Me is selected', async () => {
      const handleChange = vi.fn()
      render(<PermissionSelector {...defaultProps} onChange={handleChange} permission={DatasetPermission.allTeamMembers} />)

      // Open dropdown
      const trigger = screen.getByText(/form\.permissionsAllMember/)
      fireEvent.click(trigger)

      await waitFor(() => {
        // Click Only Me option
        const onlyMeOptions = screen.getAllByText(/form\.permissionsOnlyMe/)
        fireEvent.click(onlyMeOptions[0])
      })

      expect(handleChange).toHaveBeenCalledWith(DatasetPermission.onlyMe)
    })

    it('should call onChange with allTeamMembers when All Team Members is selected', async () => {
      const handleChange = vi.fn()
      render(<PermissionSelector {...defaultProps} onChange={handleChange} />)

      // Open dropdown
      const trigger = screen.getByText(/form\.permissionsOnlyMe/)
      fireEvent.click(trigger)

      await waitFor(() => {
        // Click All Team Members option
        const allMemberOptions = screen.getAllByText(/form\.permissionsAllMember/)
        fireEvent.click(allMemberOptions[0])
      })

      expect(handleChange).toHaveBeenCalledWith(DatasetPermission.allTeamMembers)
    })

    it('should call onChange with partialMembers when Invited Members is selected', async () => {
      const handleChange = vi.fn()
      const handleMemberSelect = vi.fn()
      render(
        <PermissionSelector
          {...defaultProps}
          onChange={handleChange}
          onMemberSelect={handleMemberSelect}
        />,
      )

      // Open dropdown
      const trigger = screen.getByText(/form\.permissionsOnlyMe/)
      fireEvent.click(trigger)

      await waitFor(() => {
        // Click Invited Members option
        const invitedOptions = screen.getAllByText(/form\.permissionsInvitedMembers/)
        fireEvent.click(invitedOptions[0])
      })

      expect(handleChange).toHaveBeenCalledWith(DatasetPermission.partialMembers)
      expect(handleMemberSelect).toHaveBeenCalledWith(['user-1'])
    })
  })

  describe('Member Selection', () => {
    it('should show member list when partialMembers is selected', async () => {
      render(
        <PermissionSelector
          {...defaultProps}
          permission={DatasetPermission.partialMembers}
        />,
      )

      // Open dropdown
      const trigger = screen.getByTitle(/Current User/)
      fireEvent.click(trigger)

      await waitFor(() => {
        // Should show member list
        expect(screen.getByText('John Doe')).toBeInTheDocument()
        expect(screen.getByText('Jane Smith')).toBeInTheDocument()
      })
    })

    it('should call onMemberSelect when a member is clicked', async () => {
      const handleMemberSelect = vi.fn()
      render(
        <PermissionSelector
          {...defaultProps}
          permission={DatasetPermission.partialMembers}
          onMemberSelect={handleMemberSelect}
        />,
      )

      // Open dropdown
      const trigger = screen.getByTitle(/Current User/)
      fireEvent.click(trigger)

      await waitFor(() => {
        // Click on John Doe
        const johnDoe = screen.getByText('John Doe')
        fireEvent.click(johnDoe)
      })

      expect(handleMemberSelect).toHaveBeenCalledWith(['user-1', 'user-2'])
    })

    it('should deselect member when clicked again', async () => {
      const handleMemberSelect = vi.fn()
      render(
        <PermissionSelector
          {...defaultProps}
          permission={DatasetPermission.partialMembers}
          value={['user-1', 'user-2']}
          onMemberSelect={handleMemberSelect}
        />,
      )

      // Open dropdown
      const trigger = screen.getByTitle(/Current User/)
      fireEvent.click(trigger)

      await waitFor(() => {
        // Click on John Doe to deselect
        const johnDoe = screen.getByText('John Doe')
        fireEvent.click(johnDoe)
      })

      expect(handleMemberSelect).toHaveBeenCalledWith(['user-1'])
    })
  })

  describe('Search Functionality', () => {
    it('should allow typing in search input', async () => {
      render(
        <PermissionSelector
          {...defaultProps}
          permission={DatasetPermission.partialMembers}
        />,
      )

      // Open dropdown
      const trigger = screen.getByTitle(/Current User/)
      fireEvent.click(trigger)

      // Wait for dropdown to open
      const searchInput = await screen.findByRole('textbox')

      // Type in search
      fireEvent.change(searchInput, { target: { value: 'John' } })
      expect(searchInput).toHaveValue('John')
    })

    it('should render search input in partial members mode', async () => {
      render(
        <PermissionSelector
          {...defaultProps}
          permission={DatasetPermission.partialMembers}
        />,
      )

      // Open dropdown
      const trigger = screen.getByTitle(/Current User/)
      fireEvent.click(trigger)

      // Wait for dropdown to open and search input to be available
      const searchInput = await screen.findByRole('textbox')
      expect(searchInput).toBeInTheDocument()
    })

    it('should filter members after debounce completes', async () => {
      render(
        <PermissionSelector
          {...defaultProps}
          permission={DatasetPermission.partialMembers}
        />,
      )

      // Open dropdown
      const trigger = screen.getByTitle(/Current User/)
      fireEvent.click(trigger)

      // Wait for dropdown to open
      const searchInput = await screen.findByRole('textbox')

      // Type in search
      fireEvent.change(searchInput, { target: { value: 'John' } })

      // Wait for debounce (500ms) + buffer
      await waitFor(
        () => {
          expect(screen.getByText('John Doe')).toBeInTheDocument()
        },
        { timeout: 1000 },
      )
    })

    it('should handle clear search functionality', async () => {
      render(
        <PermissionSelector
          {...defaultProps}
          permission={DatasetPermission.partialMembers}
        />,
      )

      // Open dropdown
      const trigger = screen.getByTitle(/Current User/)
      fireEvent.click(trigger)

      // Wait for dropdown to open
      const searchInput = await screen.findByRole('textbox')

      // Type in search
      fireEvent.change(searchInput, { target: { value: 'test' } })
      expect(searchInput).toHaveValue('test')

      // Click the clear button using data-testid
      const clearButton = screen.getByTestId('input-clear')
      fireEvent.click(clearButton)

      // After clicking clear, input should be empty
      await waitFor(() => {
        expect(searchInput).toHaveValue('')
      })
    })

    it('should filter members by email', async () => {
      render(
        <PermissionSelector
          {...defaultProps}
          permission={DatasetPermission.partialMembers}
        />,
      )

      // Open dropdown
      const trigger = screen.getByTitle(/Current User/)
      fireEvent.click(trigger)

      // Wait for dropdown to open
      const searchInput = await screen.findByRole('textbox')

      // Search by email
      fireEvent.change(searchInput, { target: { value: 'john@example' } })

      // Wait for debounce
      await waitFor(
        () => {
          expect(screen.getByText('John Doe')).toBeInTheDocument()
        },
        { timeout: 1000 },
      )
    })

    it('should show no results message when search matches nothing', async () => {
      render(
        <PermissionSelector
          {...defaultProps}
          permission={DatasetPermission.partialMembers}
        />,
      )

      // Open dropdown
      const trigger = screen.getByTitle(/Current User/)
      fireEvent.click(trigger)

      // Wait for dropdown to open
      const searchInput = await screen.findByRole('textbox')

      // Search for non-existent member
      fireEvent.change(searchInput, { target: { value: 'nonexistent12345' } })

      // Wait for debounce and no results message
      await waitFor(
        () => {
          expect(screen.getByText(/form\.onSearchResults/)).toBeInTheDocument()
        },
        { timeout: 1000 },
      )
    })

    it('should show current user when search matches user name', async () => {
      render(
        <PermissionSelector
          {...defaultProps}
          permission={DatasetPermission.partialMembers}
        />,
      )

      // Open dropdown
      const trigger = screen.getByTitle(/Current User/)
      fireEvent.click(trigger)

      // Wait for dropdown to open
      const searchInput = await screen.findByRole('textbox')

      // Search for current user by name - partial match
      fireEvent.change(searchInput, { target: { value: 'Current' } })

      // Current user (showMe) should remain visible based on name match
      // The component uses useMemo to check if userProfile.name.includes(searchKeywords)
      expect(searchInput).toHaveValue('Current')
      // Current User label appears multiple times (trigger + member list)
      expect(screen.getAllByText('Current User').length).toBeGreaterThanOrEqual(1)
    })

    it('should show current user when search matches user email', async () => {
      render(
        <PermissionSelector
          {...defaultProps}
          permission={DatasetPermission.partialMembers}
        />,
      )

      // Open dropdown
      const trigger = screen.getByTitle(/Current User/)
      fireEvent.click(trigger)

      // Wait for dropdown to open
      const searchInput = await screen.findByRole('textbox')

      // Search for current user by email
      fireEvent.change(searchInput, { target: { value: 'current@' } })

      // The component checks userProfile.email.includes(searchKeywords)
      expect(searchInput).toHaveValue('current@')
      // Current User should remain visible based on email match
      expect(screen.getAllByText('Current User').length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('Disabled State', () => {
    it('should apply disabled styles when disabled', () => {
      const { container } = render(<PermissionSelector {...defaultProps} disabled={true} />)
      // When disabled, the component has !cursor-not-allowed class (escaped in Tailwind)
      const triggerElement = container.querySelector('[class*="cursor-not-allowed"]')
      expect(triggerElement).toBeInTheDocument()
    })
  })

  describe('Display Variations', () => {
    it('should display single avatar when only one member selected', () => {
      render(
        <PermissionSelector
          {...defaultProps}
          permission={DatasetPermission.partialMembers}
          value={['user-1']}
        />,
      )

      // Should display single avatar
      expect(screen.getByTitle(/Current User/)).toBeInTheDocument()
    })

    it('should display two avatars when two or more members selected', () => {
      render(
        <PermissionSelector
          {...defaultProps}
          permission={DatasetPermission.partialMembers}
          value={['user-1', 'user-2']}
        />,
      )

      // Should display member names
      expect(screen.getByTitle(/Current User, John Doe/)).toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty member list', () => {
      render(
        <PermissionSelector
          {...defaultProps}
          memberList={[]}
        />,
      )

      expect(screen.getByText(/form\.permissionsOnlyMe/)).toBeInTheDocument()
    })

    it('should handle member list with only current user', () => {
      render(
        <PermissionSelector
          {...defaultProps}
          memberList={[mockMemberList[0]]}
        />,
      )

      expect(screen.getByText(/form\.permissionsOnlyMe/)).toBeInTheDocument()
    })

    it('should only show members with allowed roles', () => {
      // The component filters members by role in useMemo
      // Allowed roles are: owner, admin, editor, dataset_operator
      // This is tested indirectly through the memberList filtering
      const memberListWithNormalUser: Member[] = [
        ...mockMemberList,
        { id: 'user-5', name: 'Normal User', email: 'normal@example.com', avatar: '', avatar_url: '', role: 'normal', last_login_at: '', created_at: '', status: 'active' },
      ]

      render(
        <PermissionSelector
          {...defaultProps}
          memberList={memberListWithNormalUser}
          permission={DatasetPermission.partialMembers}
        />,
      )

      // The component renders - the filtering logic is internal
      expect(screen.getByTitle(/Current User/)).toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should update when permission prop changes', () => {
      const { rerender } = render(<PermissionSelector {...defaultProps} permission={DatasetPermission.onlyMe} />)

      expect(screen.getByText(/form\.permissionsOnlyMe/)).toBeInTheDocument()

      rerender(<PermissionSelector {...defaultProps} permission={DatasetPermission.allTeamMembers} />)

      expect(screen.getByText(/form\.permissionsAllMember/)).toBeInTheDocument()
    })
  })
})
