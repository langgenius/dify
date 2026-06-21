import type { DataSourceCredential } from '../types'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CredentialTypeEnum } from '@/app/components/plugins/plugin-auth/types'
import { PermissionLevel } from '@/models/permission'
import VisibilityModal from '../visibility-modal'

/**
 * VisibilityModal Component Tests
 *
 * Covers the new credential-sharing-scope editing flow:
 * - payload shaping per permission level (partial_member_list only for partial_members)
 * - the empty-partial-members guard (the backend rejects an empty list)
 * - success side effects (onUpdate + onClose) and cancel handling
 */

const mockUpdateVisibility = vi.fn()

vi.mock('@/service/use-datasource', () => ({
  useUpdateDataSourceCredentialVisibility: () => ({ mutateAsync: mockUpdateVisibility }),
}))

vi.mock('@/service/use-common', () => ({
  useMembers: () => ({
    data: {
      accounts: [
        { id: 'm1', name: 'Member One', email: 'm1@example.com', role: 'editor' },
        { id: 'm2', name: 'Member Two', email: 'm2@example.com', role: 'editor' },
      ],
    },
  }),
}))

// app-context is a complex provider; PermissionSelector only needs userProfile from it.
vi.mock('@/context/app-context', () => ({
  useSelector: (selector: (state: { userProfile: { id: string, name: string, email: string } }) => unknown) =>
    selector({ userProfile: { id: 'owner', name: 'Owner', email: 'owner@example.com' } }),
}))

describe('VisibilityModal Component', () => {
  const mockOnClose = vi.fn()
  const mockOnUpdate = vi.fn()

  const createCredential = (overrides: Partial<DataSourceCredential> = {}): DataSourceCredential => ({
    id: 'cred-1',
    name: 'Test Credential',
    credential: {},
    type: CredentialTypeEnum.API_KEY,
    is_default: false,
    avatar_url: '',
    visibility: PermissionLevel.allTeamMembers,
    ...overrides,
  })

  const renderModal = (credentialOverrides: Partial<DataSourceCredential> = {}) =>
    render(
      <VisibilityModal
        provider="plugin-id/datasource"
        credentialItem={createCredential(credentialOverrides)}
        onClose={mockOnClose}
        onUpdate={mockOnUpdate}
      />,
    )

  beforeEach(() => {
    vi.clearAllMocks()
    mockUpdateVisibility.mockResolvedValue(undefined)
  })

  describe('Rendering', () => {
    it('should render the dialog title and save button', () => {
      renderModal()

      expect(screen.getByText('plugin.auth.whoCanUse')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'common.operation.save' })).toBeInTheDocument()
    })
  })

  describe('Save payload shaping', () => {
    it('should submit without partial_member_list for all_team_members', async () => {
      renderModal({ visibility: PermissionLevel.allTeamMembers })

      fireEvent.click(screen.getByRole('button', { name: 'common.operation.save' }))

      await waitFor(() => {
        expect(mockUpdateVisibility).toHaveBeenCalledWith({
          credential_id: 'cred-1',
          visibility: PermissionLevel.allTeamMembers,
        })
      })
    })

    it('should submit partial_member_list for partial_members', async () => {
      renderModal({ visibility: PermissionLevel.partialMembers, partial_member_list: ['m1'] })

      fireEvent.click(screen.getByRole('button', { name: 'common.operation.save' }))

      await waitFor(() => {
        expect(mockUpdateVisibility).toHaveBeenCalledWith({
          credential_id: 'cred-1',
          visibility: PermissionLevel.partialMembers,
          partial_member_list: ['m1'],
        })
      })
    })
  })

  describe('Empty partial members guard', () => {
    it('should disable save when partial_members is selected with no members', () => {
      renderModal({ visibility: PermissionLevel.partialMembers, partial_member_list: [] })

      expect(screen.getByRole('button', { name: 'common.operation.save' })).toBeDisabled()
    })

    it('should not call the update API when the guard blocks submission', () => {
      renderModal({ visibility: PermissionLevel.partialMembers, partial_member_list: [] })

      fireEvent.click(screen.getByRole('button', { name: 'common.operation.save' }))

      expect(mockUpdateVisibility).not.toHaveBeenCalled()
    })
  })

  describe('Side effects', () => {
    it('should call onUpdate and onClose after a successful save', async () => {
      renderModal({ visibility: PermissionLevel.allTeamMembers })

      fireEvent.click(screen.getByRole('button', { name: 'common.operation.save' }))

      await waitFor(() => {
        expect(mockOnUpdate).toHaveBeenCalledTimes(1)
        expect(mockOnClose).toHaveBeenCalledTimes(1)
      })
    })

    it('should close without saving when cancel is clicked', () => {
      renderModal()

      fireEvent.click(screen.getByRole('button', { name: 'common.operation.cancel' }))

      expect(mockOnClose).toHaveBeenCalledTimes(1)
      expect(mockUpdateVisibility).not.toHaveBeenCalled()
    })
  })
})
