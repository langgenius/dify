import type { InvitationResponse } from '@/models/common'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { toast } from '@/app/components/base/ui/toast'
import { useProviderContextSelector } from '@/context/provider-context'
import { inviteMember } from '@/service/common'
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
vi.mock('@/app/components/base/ui/toast', () => ({
  toast: {
    error: mockToastError,
  },
}))
vi.mock('@/context/i18n', () => ({
  useLocale: () => 'en-US',
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

  beforeEach(() => {
    vi.clearAllMocks()

    vi.mocked(useProviderContextSelector).mockImplementation(selector => selector({
      licenseLimit: { workspace_members: { size: 5, limit: 10 } },
      refreshLicenseLimit: mockRefreshLicenseLimit,
    } as unknown as Parameters<typeof selector>[0]))
  })

  const renderModal = (isEmailSetup = true) => render(
    <InviteModal isEmailSetup={isEmailSetup} onCancel={mockOnCancel} onSend={mockOnSend} />,
  )
  const fillEmails = (value: string) => {
    fireEvent.change(screen.getByTestId('mock-email-input'), { target: { value } })
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

  it('should enable send button after entering an email', async () => {
    renderModal()
    fillEmails('user@example.com')

    expect(screen.getByRole('button', { name: /members\.sendInvite/i })).toBeEnabled()
  })

  it('should not close modal when invite request fails', async () => {
    const user = userEvent.setup()
    vi.mocked(inviteMember).mockRejectedValue(new Error('request failed'))

    renderModal()

    fillEmails('user@example.com')
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
    await user.click(screen.getByRole('button', { name: /members\.sendInvite/i }))

    await waitFor(() => {
      expect(inviteMember).toHaveBeenCalled()
      expect(mockRefreshLicenseLimit).toHaveBeenCalled()
      expect(mockOnCancel).toHaveBeenCalled()
      expect(mockOnSend).toHaveBeenCalled()
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

    await user.click(screen.getByTestId('invite-modal-close'))

    expect(mockOnCancel).toHaveBeenCalled()
  })

  it('should show error notification for invalid email submission', async () => {
    const user = userEvent.setup()
    renderModal()

    // Use an email that passes basic validation but fails our strict regex (needs 2+ char TLD)
    fillEmails('invalid@email.c')
    await user.click(screen.getByRole('button', { name: /members\.sendInvite/i }))

    expect(toast.error).toHaveBeenCalledWith('common.members.emailInvalid')
    expect(inviteMember).not.toHaveBeenCalled()
  })

  it('should remove email from list when remove icon is clicked', async () => {
    const user = userEvent.setup()
    renderModal()

    fillEmails('user@example.com')

    expect(screen.getByText('user@example.com')).toBeInTheDocument()

    const removeBtn = screen.getByTestId('remove-email-btn')
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
