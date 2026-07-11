import type { InvitationResponse } from '@/models/common'
import { toast } from '@langgenius/dify-ui/toast'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { useProviderContextSelector } from '@/context/provider-context'
import { useWorkspaceRoleList } from '@/service/access-control/use-workspace-roles'
import { inviteMember } from '@/service/common'
import { commonQueryKeys } from '@/service/use-common'
import InviteModal from '../index'

const { mockToastError } = vi.hoisted(() => ({
  mockToastError: vi.fn(),
}))

vi.mock('@/context/provider-context', () => ({
  useProviderContextSelector: vi.fn(),
  useProviderContext: vi.fn(() => ({
    datasetOperatorEnabled: true,
  })),
}))
vi.mock('@/service/common')
vi.mock('@/service/access-control/use-workspace-roles')
vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: {
    error: mockToastError,
  },
}))

vi.mock('react-multi-email', () => ({
  ReactMultiEmail: ({ emails, onChange, getLabel }: { emails: string[], onChange: (emails: string[]) => void, getLabel: (email: string, index: number, removeEmail: (index: number) => void) => React.ReactNode }) => (
    <div>
      <input
        data-testid="mock-email-input"
        onChange={e => onChange(e.target.value ? e.target.value.split(',') : [])}
      />
      {emails.map((email: string, index: number) => (
        <div key={email}>
          {getLabel(email, index, (idx: number) => onChange(emails.filter((_: string, i: number) => i !== idx)))}
        </div>
      ))}
    </div>
  ),
}))

describe('InviteModal', () => {
  const mockOnCancel = vi.fn()
  const mockOnSend = vi.fn()
  const mockRefreshLicenseLimit = vi.fn()

  const createQueryClient = () => new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: Infinity,
      },
      mutations: {
        retry: false,
      },
    },
  })

  beforeEach(() => {
    vi.clearAllMocks()

    vi.mocked(useWorkspaceRoleList).mockReturnValue({
      data: {
        pages: [{
          data: [
            {
              id: 'admin',
              tenant_id: 'tenant-id',
              type: 'workspace',
              category: 'global_system_default',
              name: 'Admin',
              description: 'Can manage workspace settings',
              is_builtin: true,
              permission_keys: [],
              role_tag: '',
            },
            {
              id: 'normal',
              tenant_id: 'tenant-id',
              type: 'workspace',
              category: 'global_system_default',
              name: 'Normal',
              description: 'Can use apps',
              is_builtin: true,
              permission_keys: [],
              role_tag: '',
            },
          ],
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

    vi.mocked(useProviderContextSelector).mockImplementation(selector => selector({
      licenseLimit: { workspace_members: { size: 5, limit: 10 } },
      refreshLicenseLimit: mockRefreshLicenseLimit,
    } as unknown as Parameters<typeof selector>[0]))
  })

  const renderModal = (isEmailSetup = true, queryClient = createQueryClient()) => ({
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <InviteModal isEmailSetup={isEmailSetup} onCancel={mockOnCancel} onSend={mockOnSend} />
      </QueryClientProvider>,
    ),
  })
  const fillEmails = (value: string) => {
    fireEvent.change(screen.getByTestId('mock-email-input'), { target: { value } })
  }
  const selectAdminRole = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole('button', { name: /members\.selectRole/i }))
    await user.click(screen.getByRole('menuitemradio', { name: /Admin/i }))
  }

  it('should render invite modal content', async () => {
    renderModal()

    expect(await screen.findByText(/members\.inviteTeamMember$/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /members\.sendInvite/i })).toBeDisabled()
  })

  it('should show warning when email service is not configured', async () => {
    renderModal(false)

    expect(await screen.findByText(/members\.emailNotSetup$/i)).toBeInTheDocument()
  })

  it('should enable send button after entering an email and selecting a role', async () => {
    renderModal()
    fillEmails('user@example.com')

    expect(screen.getByRole('button', { name: /members\.sendInvite/i })).toBeDisabled()

    const user = userEvent.setup()
    await selectAdminRole(user)

    expect(screen.getByRole('button', { name: /members\.sendInvite/i })).toBeEnabled()
  })

  it('should not close modal when invite request fails', async () => {
    const user = userEvent.setup()
    vi.mocked(inviteMember).mockRejectedValue(new Error('request failed'))

    renderModal()

    fillEmails('user@example.com')
    await selectAdminRole(user)
    await user.click(screen.getByRole('button', { name: /members\.sendInvite/i }))

    await waitFor(() => {
      expect(inviteMember).toHaveBeenCalled()
      expect(mockOnCancel).not.toHaveBeenCalled()
      expect(mockOnSend).not.toHaveBeenCalled()
    })
  })

  it('should send invites and close modal on successful submission', async () => {
    const user = userEvent.setup()
    vi.mocked(inviteMember).mockResolvedValue({
      result: 'success',
      invitation_results: [],
    } as InvitationResponse)

    renderModal()

    fillEmails('user@example.com')
    await selectAdminRole(user)
    await user.click(screen.getByRole('button', { name: /members\.sendInvite/i }))

    await waitFor(() => {
      expect(inviteMember).toHaveBeenCalled()
      expect(mockRefreshLicenseLimit).toHaveBeenCalled()
      expect(mockOnCancel).toHaveBeenCalled()
      expect(mockOnSend).toHaveBeenCalled()
    })
  })

  it('should submit the selected workspace role id', async () => {
    const user = userEvent.setup()
    vi.mocked(inviteMember).mockResolvedValue({
      result: 'success',
      invitation_results: [],
    } as InvitationResponse)

    renderModal()

    fillEmails('user@example.com')
    await selectAdminRole(user)
    await user.click(screen.getByRole('button', { name: /members\.sendInvite/i }))

    await waitFor(() => {
      expect(inviteMember).toHaveBeenCalledWith({
        url: '/workspaces/current/members/invite-email',
        body: {
          emails: ['user@example.com'],
          role: 'admin',
          language: 'en-US',
        },
      })
    })
  })

  it('should invalidate members after successful submission', async () => {
    const user = userEvent.setup()
    const queryClient = createQueryClient()
    const membersQueryKey = [...commonQueryKeys.members, 'en-US']
    queryClient.setQueryData(membersQueryKey, { accounts: [] })
    vi.mocked(inviteMember).mockResolvedValue({
      result: 'success',
      invitation_results: [],
    } as InvitationResponse)

    renderModal(true, queryClient)

    fillEmails('user@example.com')
    await selectAdminRole(user)
    await user.click(screen.getByRole('button', { name: /members\.sendInvite/i }))

    await waitFor(() => {
      expect(queryClient.getQueryState(membersQueryKey)?.isInvalidated).toBe(true)
    })
  })

  it('should keep send button disabled when license limit is exceeded', async () => {
    vi.mocked(useProviderContextSelector).mockImplementation(selector => selector({
      licenseLimit: { workspace_members: { size: 10, limit: 10 } },
      refreshLicenseLimit: mockRefreshLicenseLimit,
    } as unknown as Parameters<typeof selector>[0]))

    renderModal()

    fillEmails('user@example.com')

    expect(screen.getByRole('button', { name: /members\.sendInvite/i })).toBeDisabled()
  })

  it('should call onCancel when close icon is clicked', async () => {
    const user = userEvent.setup()
    renderModal()

    await user.click(screen.getByRole('button', { name: /Close|operation.close/ }))

    expect(mockOnCancel).toHaveBeenCalled()
  })

  it('should show error notification for invalid email submission', async () => {
    const user = userEvent.setup()
    renderModal()

    // Use an email that passes basic validation but fails our strict regex (needs 2+ char TLD)
    fillEmails('invalid@email.c')
    await selectAdminRole(user)
    await user.click(screen.getByRole('button', { name: /members\.sendInvite/i }))

    expect(toast.error).toHaveBeenCalledWith('common.members.emailInvalid')
    expect(inviteMember).not.toHaveBeenCalled()
  })

  it('should remove email from list when remove icon is clicked', async () => {
    const user = userEvent.setup()
    renderModal()

    fillEmails('user@example.com')

    expect(screen.getByText('user@example.com')).toBeInTheDocument()

    const removeBtn = screen.getByRole('button', { name: /operation\.remove.*user@example\.com/i })
    await user.click(removeBtn)

    expect(screen.queryByText('user@example.com')).not.toBeInTheDocument()
  })

  it('should show unlimited label when workspace member limit is zero', async () => {
    vi.mocked(useProviderContextSelector).mockImplementation(selector => selector({
      licenseLimit: { workspace_members: { size: 5, limit: 0 } },
      refreshLicenseLimit: mockRefreshLicenseLimit,
    } as unknown as Parameters<typeof selector>[0]))

    renderModal()

    expect(await screen.findByText(/license\.unlimited/i)).toBeInTheDocument()
  })

  it('should initialize usedSize to zero when workspace_members.size is null', async () => {
    vi.mocked(useProviderContextSelector).mockImplementation(selector => selector({
      licenseLimit: { workspace_members: { size: null, limit: 10 } },
      refreshLicenseLimit: mockRefreshLicenseLimit,
    } as unknown as Parameters<typeof selector>[0]))

    renderModal()

    // usedSize starts at 0 (via ?? 0 fallback), no emails added → counter shows 0
    expect(await screen.findByText('0')).toBeInTheDocument()
  })

  it('should not call onSend when invite result is not success', async () => {
    const user = userEvent.setup()
    vi.mocked(inviteMember).mockResolvedValue({
      result: 'error',
      invitation_results: [],
    } as unknown as InvitationResponse)

    renderModal()

    fillEmails('user@example.com')
    await selectAdminRole(user)
    await user.click(screen.getByRole('button', { name: /members\.sendInvite/i }))

    await waitFor(() => {
      expect(inviteMember).toHaveBeenCalled()
      expect(mockOnSend).not.toHaveBeenCalled()
      expect(mockOnCancel).not.toHaveBeenCalled()
    })
  })

  it('should show destructive text color when used size exceeds limit', async () => {
    vi.mocked(useProviderContextSelector).mockImplementation(selector => selector({
      licenseLimit: { workspace_members: { size: 10, limit: 10 } },
      refreshLicenseLimit: mockRefreshLicenseLimit,
    } as unknown as Parameters<typeof selector>[0]))

    renderModal()

    fillEmails('user@example.com')

    // usedSize = 10 + 1 = 11 > limit 10 → destructive color
    const counter = screen.getByText('11')
    expect(counter.closest('div')).toHaveClass('text-text-destructive')
  })

  it('should not submit if already submitting', async () => {
    const user = userEvent.setup()
    let resolveInvite: (value: InvitationResponse) => void
    const invitePromise = new Promise<InvitationResponse>((resolve) => {
      resolveInvite = resolve
    })
    vi.mocked(inviteMember).mockReturnValue(invitePromise)

    renderModal()

    fillEmails('user@example.com')
    await selectAdminRole(user)

    const sendBtn = screen.getByRole('button', { name: /members\.sendInvite/i })

    // First click
    await user.click(sendBtn)
    expect(inviteMember).toHaveBeenCalledTimes(1)

    // Second click while submitting.
    // userEvent will skip this click because the button is disabled.
    await user.click(sendBtn)
    expect(inviteMember).toHaveBeenCalledTimes(1)

    // Resolve first
    resolveInvite!({ result: 'success', invitation_results: [] })

    await waitFor(() => {
      expect(mockOnCancel).toHaveBeenCalled()
    })
  })

  it('should show destructive color and disable send button when limit is exactly met with one email', async () => {
    // size=10, limit=10 - adding 1 email makes usedSize=11 > limit=10
    vi.mocked(useProviderContextSelector).mockImplementation(selector => selector({
      licenseLimit: { workspace_members: { size: 10, limit: 10 } },
      refreshLicenseLimit: mockRefreshLicenseLimit,
    } as unknown as Parameters<typeof selector>[0]))

    renderModal()

    fillEmails('user@example.com')

    // isLimitExceeded=true → button is disabled, cannot submit
    const sendBtn = screen.getByRole('button', { name: /members\.sendInvite/i })
    expect(sendBtn).toBeDisabled()
    expect(inviteMember).not.toHaveBeenCalled()
  })

  it('should hit isSubmitting guard inside handleSend when button is force-clicked during submission', async () => {
    const user = userEvent.setup()
    let resolveInvite: (value: InvitationResponse) => void
    const invitePromise = new Promise<InvitationResponse>((resolve) => {
      resolveInvite = resolve
    })
    vi.mocked(inviteMember).mockReturnValue(invitePromise)

    renderModal()

    fillEmails('user@example.com')
    await selectAdminRole(user)

    const sendBtn = screen.getByRole('button', { name: /members\.sendInvite/i })

    // First click starts submission
    await user.click(sendBtn)
    expect(inviteMember).toHaveBeenCalledTimes(1)

    // Force-click bypasses disabled attribute → hits isSubmitting guard in handleSend
    fireEvent.click(sendBtn)
    expect(inviteMember).toHaveBeenCalledTimes(1)

    // Cleanup
    resolveInvite!({ result: 'success', invitation_results: [] })
    await waitFor(() => {
      expect(mockOnCancel).toHaveBeenCalled()
    })
  })

  it('should not show error text color when isLimited is false even with many emails', async () => {
    // size=0, limit=0 → isLimited=false, usedSize=emails.length
    vi.mocked(useProviderContextSelector).mockImplementation(selector => selector({
      licenseLimit: { workspace_members: { size: 0, limit: 0 } },
      refreshLicenseLimit: mockRefreshLicenseLimit,
    } as unknown as Parameters<typeof selector>[0]))

    renderModal()

    fillEmails('user@example.com')

    // isLimited=false → no destructive color
    const counter = screen.getByText('1')
    expect(counter.closest('div')).not.toHaveClass('text-text-destructive')
  })
})
