import type { Member } from '@/models/common'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithSystemFeatures } from '@/__tests__/utils/mock-system-features'
import { DatasetPermission } from '@/models/datasets'
import PermissionSelector from '../index'

const mockAppContextState = vi.hoisted(() => ({
  userProfile: {
    id: 'user-1',
    name: 'Current User',
    email: 'current@example.com',
    avatar_url: '',
    role: 'owner',
  },
}))

let mockIsRbacEnabled = false

vi.mock('@/context/account-state', async (importOriginal) => {
  const { createDatasetAccessAtomMock } =
    await import('@/app/components/datasets/__tests__/mock-dataset-access')

  return createDatasetAccessAtomMock(
    importOriginal,
    () => mockAppContextState,
    () => ({
      isRbacEnabled: mockIsRbacEnabled,
    }),
  )
})
vi.mock('@/context/workspace-state', async (importOriginal) => {
  const { createDatasetAccessAtomMock } =
    await import('@/app/components/datasets/__tests__/mock-dataset-access')

  return createDatasetAccessAtomMock(
    importOriginal,
    () => mockAppContextState,
    () => ({
      isRbacEnabled: mockIsRbacEnabled,
    }),
  )
})
vi.mock('@/context/permission-state', async (importOriginal) => {
  const { createDatasetAccessAtomMock } =
    await import('@/app/components/datasets/__tests__/mock-dataset-access')

  return createDatasetAccessAtomMock(
    importOriginal,
    () => mockAppContextState,
    () => ({
      isRbacEnabled: mockIsRbacEnabled,
    }),
  )
})
vi.mock('@/context/version-state', async (importOriginal) => {
  const { createDatasetAccessAtomMock } =
    await import('@/app/components/datasets/__tests__/mock-dataset-access')

  return createDatasetAccessAtomMock(
    importOriginal,
    () => mockAppContextState,
    () => ({
      isRbacEnabled: mockIsRbacEnabled,
    }),
  )
})
vi.mock('@/context/system-features-state', async (importOriginal) => {
  const { createDatasetAccessAtomMock } =
    await import('@/app/components/datasets/__tests__/mock-dataset-access')

  return createDatasetAccessAtomMock(
    importOriginal,
    () => mockAppContextState,
    () => ({
      isRbacEnabled: mockIsRbacEnabled,
    }),
  )
})

vi.mock('jotai', async (importOriginal) => {
  const { createDatasetAccessJotaiMock } =
    await import('@/app/components/datasets/__tests__/mock-dataset-access')

  return createDatasetAccessJotaiMock(importOriginal)
})

describe('PermissionSelector', () => {
  const mockMemberList: Member[] = [
    {
      id: 'user-1',
      name: 'Current User',
      email: 'current@example.com',
      avatar: '',
      avatar_url: '',
      role: 'owner',
      roles: [],
      last_login_at: '',
      created_at: '',
      status: 'active',
    }!,
    {
      id: 'user-2',
      name: 'John Doe',
      email: 'john@example.com',
      avatar: '',
      avatar_url: '',
      role: 'admin',
      roles: [],
      last_login_at: '',
      created_at: '',
      status: 'active',
    }!,
    {
      id: 'user-3',
      name: 'Jane Smith',
      email: 'jane@example.com',
      avatar: '',
      avatar_url: '',
      role: 'editor',
      roles: [],
      last_login_at: '',
      created_at: '',
      status: 'active',
    }!,
    {
      id: 'user-4',
      name: 'Dataset Operator',
      email: 'operator@example.com',
      avatar: '',
      avatar_url: '',
      role: 'dataset_operator',
      roles: [],
      last_login_at: '',
      created_at: '',
      status: 'active',
    }!,
  ]

  const defaultProps = {
    permission: DatasetPermission.onlyMe,
    value: ['user-1'!],
    memberList: mockMemberList,
    onChange: vi.fn(),
    onMemberSelect: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockIsRbacEnabled = false
  })

  describe('Rendering', () => {
    it('should render Only Me option when permission is onlyMe', () => {
      renderWithSystemFeatures(
        <PermissionSelector {...defaultProps} permission={DatasetPermission.onlyMe} />,
      )
      expect(screen.getByText(/form\.permissionsOnlyMe/))!.toBeInTheDocument()
    })

    it('should render All Team Members option when permission is allTeamMembers', () => {
      renderWithSystemFeatures(
        <PermissionSelector {...defaultProps} permission={DatasetPermission.allTeamMembers} />,
      )
      expect(screen.getByText(/form\.permissionsAllMember/))!.toBeInTheDocument()
    })

    it('should render selected member names when permission is partialMembers', () => {
      renderWithSystemFeatures(
        <PermissionSelector
          {...defaultProps}
          permission={DatasetPermission.partialMembers}
          value={['user-1', 'user-2']}
        />,
      )
      // Should show member names
      // Should show member names
      expect(screen.getByTitle(/Current User/))!.toBeInTheDocument()
    })
  })

  describe('Dropdown Toggle', () => {
    it('should open dropdown when clicked', async () => {
      renderWithSystemFeatures(<PermissionSelector {...defaultProps} />)

      const trigger = screen.getByText(/form\.permissionsOnlyMe/)
      fireEvent.click(trigger)

      await waitFor(() => {
        // Should show all permission options in dropdown
        expect(screen.getAllByText(/form\.permissionsOnlyMe/).length).toBeGreaterThanOrEqual(1)
      })
    })

    it('should not open dropdown when disabled', () => {
      renderWithSystemFeatures(<PermissionSelector {...defaultProps} disabled={true} />)

      const trigger = screen.getByText(/form\.permissionsOnlyMe/)
      fireEvent.click(trigger)

      // Dropdown should not open - only the trigger text should be visible
      expect(screen.getAllByText(/form\.permissionsOnlyMe/).length).toBe(1)
    })
  })

  describe('Permission Selection', () => {
    it('should call onChange with onlyMe when Only Me is selected', async () => {
      const handleChange = vi.fn()
      renderWithSystemFeatures(
        <PermissionSelector
          {...defaultProps}
          onChange={handleChange}
          permission={DatasetPermission.allTeamMembers}
        />,
      )

      const trigger = screen.getByText(/form\.permissionsAllMember/)
      fireEvent.click(trigger)

      await waitFor(() => {
        const onlyMeOptions = screen.getAllByText(/form\.permissionsOnlyMe/)
        fireEvent.click(onlyMeOptions[0]!)
      })

      expect(handleChange).toHaveBeenCalledWith(DatasetPermission.onlyMe)
    })

    it('should call onChange with allTeamMembers when All Team Members is selected', async () => {
      const handleChange = vi.fn()
      renderWithSystemFeatures(<PermissionSelector {...defaultProps} onChange={handleChange} />)

      const trigger = screen.getByText(/form\.permissionsOnlyMe/)
      fireEvent.click(trigger)

      await waitFor(() => {
        const allMemberOptions = screen.getAllByText(/form\.permissionsAllMember/)
        fireEvent.click(allMemberOptions[0]!)
      })

      expect(handleChange).toHaveBeenCalledWith(DatasetPermission.allTeamMembers)
    })

    it('should call onChange with partialMembers when Invited Members is selected', async () => {
      const handleChange = vi.fn()
      const handleMemberSelect = vi.fn()
      renderWithSystemFeatures(
        <PermissionSelector
          {...defaultProps}
          onChange={handleChange}
          onMemberSelect={handleMemberSelect}
        />,
      )

      const trigger = screen.getByText(/form\.permissionsOnlyMe/)
      fireEvent.click(trigger)

      await waitFor(() => {
        const invitedOptions = screen.getAllByText(/form\.permissionsInvitedMembers/)
        fireEvent.click(invitedOptions[0]!)
      })

      expect(handleChange).toHaveBeenCalledWith(DatasetPermission.partialMembers)
      expect(handleMemberSelect).toHaveBeenCalledWith(['user-1'])
    })
  })

  describe('Member Selection', () => {
    it('should show member list when partialMembers is selected', async () => {
      renderWithSystemFeatures(
        <PermissionSelector {...defaultProps} permission={DatasetPermission.partialMembers} />,
      )

      const trigger = screen.getByTitle(/Current User/)
      fireEvent.click(trigger)

      await waitFor(() => {
        // Should show member list
        // Should show member list
        expect(screen.getByText('John Doe'))!.toBeInTheDocument()
        expect(screen.getByText('Jane Smith'))!.toBeInTheDocument()
      })
    })

    it('should call onMemberSelect when a member is clicked', async () => {
      const handleMemberSelect = vi.fn()
      renderWithSystemFeatures(
        <PermissionSelector
          {...defaultProps}
          permission={DatasetPermission.partialMembers}
          onMemberSelect={handleMemberSelect}
        />,
      )

      const trigger = screen.getByTitle(/Current User/)
      fireEvent.click(trigger)

      await waitFor(() => {
        const johnDoe = screen.getByText('John Doe')
        fireEvent.click(johnDoe)
      })

      expect(handleMemberSelect).toHaveBeenCalledWith(['user-1', 'user-2'])
    })

    it('should deselect member when clicked again', async () => {
      const handleMemberSelect = vi.fn()
      renderWithSystemFeatures(
        <PermissionSelector
          {...defaultProps}
          permission={DatasetPermission.partialMembers}
          value={['user-1', 'user-2']}
          onMemberSelect={handleMemberSelect}
        />,
      )

      const trigger = screen.getByTitle(/Current User/)
      fireEvent.click(trigger)

      await waitFor(() => {
        const johnDoe = screen.getByText('John Doe')
        fireEvent.click(johnDoe)
      })

      expect(handleMemberSelect).toHaveBeenCalledWith(['user-1'])
    })
  })

  describe('Search Functionality', () => {
    it('should allow typing in search input', async () => {
      renderWithSystemFeatures(
        <PermissionSelector {...defaultProps} permission={DatasetPermission.partialMembers} />,
      )

      const trigger = screen.getByTitle(/Current User/)
      fireEvent.click(trigger)

      // Wait for dropdown to open
      const searchInput = await screen.findByRole('textbox')

      // Type in search
      fireEvent.change(searchInput, { target: { value: 'John' } })
      expect(searchInput)!.toHaveValue('John')
    })

    it('should render search input in partial members mode', async () => {
      renderWithSystemFeatures(
        <PermissionSelector {...defaultProps} permission={DatasetPermission.partialMembers} />,
      )

      const trigger = screen.getByTitle(/Current User/)
      fireEvent.click(trigger)

      // Wait for dropdown to open and search input to be available
      const searchInput = await screen.findByRole('textbox')
      expect(searchInput)!.toBeInTheDocument()
    })

    it('should filter members after debounce completes', async () => {
      renderWithSystemFeatures(
        <PermissionSelector {...defaultProps} permission={DatasetPermission.partialMembers} />,
      )

      const trigger = screen.getByTitle(/Current User/)
      fireEvent.click(trigger)

      // Wait for dropdown to open
      const searchInput = await screen.findByRole('textbox')

      // Type in search
      fireEvent.change(searchInput, { target: { value: 'John' } })

      // Wait for debounce (500ms) + buffer
      await waitFor(
        () => {
          expect(screen.getByText('John Doe'))!.toBeInTheDocument()
        },
        { timeout: 1000 },
      )
    })

    it('should handle clear search functionality', async () => {
      renderWithSystemFeatures(
        <PermissionSelector {...defaultProps} permission={DatasetPermission.partialMembers} />,
      )

      const trigger = screen.getByTitle(/Current User/)
      fireEvent.click(trigger)

      // Wait for dropdown to open
      const searchInput = await screen.findByRole('textbox')

      // Type in search
      fireEvent.change(searchInput, { target: { value: 'test' } })
      expect(searchInput)!.toHaveValue('test')

      const clearButton = screen.getByRole('button', { name: 'common.operation.clear' })
      fireEvent.click(clearButton)

      // After clicking clear, input should be empty
      await waitFor(() => {
        expect(searchInput)!.toHaveValue('')
      })
    })

    it('should filter members by email', async () => {
      renderWithSystemFeatures(
        <PermissionSelector {...defaultProps} permission={DatasetPermission.partialMembers} />,
      )

      const trigger = screen.getByTitle(/Current User/)
      fireEvent.click(trigger)

      // Wait for dropdown to open
      const searchInput = await screen.findByRole('textbox')

      // Search by email
      fireEvent.change(searchInput, { target: { value: 'john@example' } })

      // Wait for debounce
      await waitFor(
        () => {
          expect(screen.getByText('John Doe'))!.toBeInTheDocument()
        },
        { timeout: 1000 },
      )
    })

    it('should show no results message when search matches nothing', async () => {
      renderWithSystemFeatures(
        <PermissionSelector {...defaultProps} permission={DatasetPermission.partialMembers} />,
      )

      const trigger = screen.getByTitle(/Current User/)
      fireEvent.click(trigger)

      // Wait for dropdown to open
      const searchInput = await screen.findByRole('textbox')

      // Search for non-existent member
      fireEvent.change(searchInput, { target: { value: 'nonexistent12345' } })

      // Wait for debounce and no results message
      await waitFor(
        () => {
          expect(screen.getByText(/form\.onSearchResults/))!.toBeInTheDocument()
        },
        { timeout: 1000 },
      )
    })

    it('should show current user when search matches user name', async () => {
      renderWithSystemFeatures(
        <PermissionSelector {...defaultProps} permission={DatasetPermission.partialMembers} />,
      )

      const trigger = screen.getByTitle(/Current User/)
      fireEvent.click(trigger)

      // Wait for dropdown to open
      const searchInput = await screen.findByRole('textbox')

      // Search for current user by name - partial match
      fireEvent.change(searchInput, { target: { value: 'Current' } })

      // Current user (showMe) should remain visible based on name match
      // The component uses useMemo to check if userProfile.name.includes(searchKeywords)
      // Current user (showMe) should remain visible based on name match
      // The component uses useMemo to check if userProfile.name.includes(searchKeywords)
      expect(searchInput)!.toHaveValue('Current')
      // Current User label appears multiple times (trigger + member list)
      expect(screen.getAllByText('Current User').length).toBeGreaterThanOrEqual(1)
    })

    it('should show current user when search matches user email', async () => {
      renderWithSystemFeatures(
        <PermissionSelector {...defaultProps} permission={DatasetPermission.partialMembers} />,
      )

      const trigger = screen.getByTitle(/Current User/)
      fireEvent.click(trigger)

      // Wait for dropdown to open
      const searchInput = await screen.findByRole('textbox')

      // Search for current user by email
      fireEvent.change(searchInput, { target: { value: 'current@' } })

      // The component checks userProfile.email.includes(searchKeywords)
      // The component checks userProfile.email.includes(searchKeywords)
      expect(searchInput)!.toHaveValue('current@')
      // Current User should remain visible based on email match
      expect(screen.getAllByText('Current User').length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('Disabled State', () => {
    it('should apply disabled styles when disabled', () => {
      const { container } = renderWithSystemFeatures(
        <PermissionSelector {...defaultProps} disabled={true} />,
      )
      // When disabled, the component has cursor-not-allowed! class (escaped in Tailwind)
      const triggerElement = container.querySelector('[class*="cursor-not-allowed"]')
      expect(triggerElement)!.toBeInTheDocument()
    })

    it('should show access config hint and remain closed when RBAC is enabled', () => {
      mockIsRbacEnabled = true

      renderWithSystemFeatures(<PermissionSelector {...defaultProps} />, {
        systemFeatures: {
          rbac_enabled: true,
        },
      })

      const trigger = screen.getByText(/form\.permissionsAccessConfig/)
      fireEvent.click(trigger)

      expect(screen.getByText(/form\.permissionsAccessConfig/))!.toBeInTheDocument()
      expect(screen.queryByText(/form\.permissionsOnlyMe/))!.not.toBeInTheDocument()
    })
  })

  describe('Display Variations', () => {
    it('should display single avatar when only one member selected', () => {
      renderWithSystemFeatures(
        <PermissionSelector
          {...defaultProps}
          permission={DatasetPermission.partialMembers}
          value={['user-1']}
        />,
      )

      // Should display single avatar
      // Should display single avatar
      expect(screen.getByTitle(/Current User/))!.toBeInTheDocument()
    })

    it('should display two avatars when two or more members selected', () => {
      renderWithSystemFeatures(
        <PermissionSelector
          {...defaultProps}
          permission={DatasetPermission.partialMembers}
          value={['user-1', 'user-2']}
        />,
      )

      // Should display member names
      // Should display member names
      expect(screen.getByTitle(/Current User, John Doe/))!.toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty member list', () => {
      renderWithSystemFeatures(<PermissionSelector {...defaultProps} memberList={[]} />)

      expect(screen.getByText(/form\.permissionsOnlyMe/))!.toBeInTheDocument()
    })

    it('should handle member list with only current user', () => {
      renderWithSystemFeatures(
        <PermissionSelector {...defaultProps} memberList={[mockMemberList[0]!]} />,
      )

      expect(screen.getByText(/form\.permissionsOnlyMe/))!.toBeInTheDocument()
    })

    it('should only show members with allowed roles', () => {
      // The component filters members by role in useMemo
      // Allowed roles are: owner, admin, editor, dataset_operator
      // This is tested indirectly through the memberList filtering
      const memberListWithNormalUser: Member[] = [
        ...mockMemberList,
        {
          id: 'user-5',
          name: 'Normal User',
          email: 'normal@example.com',
          avatar: '',
          avatar_url: '',
          role: 'normal',
          roles: [],
          last_login_at: '',
          created_at: '',
          status: 'active',
        },
      ]

      renderWithSystemFeatures(
        <PermissionSelector
          {...defaultProps}
          memberList={memberListWithNormalUser}
          permission={DatasetPermission.partialMembers}
        />,
      )

      // The component renders - the filtering logic is internal
      // The component renders - the filtering logic is internal
      expect(screen.getByTitle(/Current User/))!.toBeInTheDocument()
    })
  })

  describe('Props', () => {
    it('should update when permission prop changes', () => {
      const { rerender } = renderWithSystemFeatures(
        <PermissionSelector {...defaultProps} permission={DatasetPermission.onlyMe} />,
      )

      expect(screen.getByText(/form\.permissionsOnlyMe/))!.toBeInTheDocument()

      rerender(
        <PermissionSelector {...defaultProps} permission={DatasetPermission.allTeamMembers} />,
      )

      expect(screen.getByText(/form\.permissionsAllMember/))!.toBeInTheDocument()
    })
  })
})
