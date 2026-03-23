import type { InvitationResponse } from '@/models/common'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { ToastContext } from '@/app/components/base/toast'
import { useProviderContextSelector } from '@/context/provider-context'
import { inviteMember } from '@/service/common'
import InviteModal from './index'

vi.mock('@/context/provider-context', () => ({
  useProviderContextSelector: vi.fn(),
  useProviderContext: vi.fn(() => ({
    datasetOperatorEnabled: true,
  })),
}))
vi.mock('@/service/common')
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
  const mockNotify = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()

    vi.mocked(useProviderContextSelector).mockImplementation(selector => selector({
      licenseLimit: { workspace_members: { size: 5, limit: 10 } },
      refreshLicenseLimit: mockRefreshLicenseLimit,
    } as unknown as Parameters<typeof selector>[0]))
  })

  const renderModal = (isEmailSetup = true) => render(
    <ToastContext.Provider value={{ notify: mockNotify, close: vi.fn() }}>
      <InviteModal isEmailSetup={isEmailSetup} onCancel={mockOnCancel} onSend={mockOnSend} />
    </ToastContext.Provider>,
  )

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
    const user = userEvent.setup()

    renderModal()

    const input = screen.getByTestId('mock-email-input')
    await user.type(input, 'user@example.com')

    expect(screen.getByRole('button', { name: /members\.sendInvite/i })).toBeEnabled()
  })

  it('should not close modal when invite request fails', async () => {
    const user = userEvent.setup()
    vi.mocked(inviteMember).mockRejectedValue(new Error('request failed'))

    renderModal()

    await user.type(screen.getByTestId('mock-email-input'), 'user@example.com')
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

    const input = screen.getByTestId('mock-email-input')
    await user.type(input, 'user@example.com')
    await user.click(screen.getByRole('button', { name: /members\.sendInvite/i }))

    await waitFor(() => {
      expect(inviteMember).toHaveBeenCalled()
      expect(mockRefreshLicenseLimit).toHaveBeenCalled()
      expect(mockOnCancel).toHaveBeenCalled()
      expect(mockOnSend).toHaveBeenCalled()
    })
  })

  it('should keep send button disabled when license limit is exceeded', async () => {
    const user = userEvent.setup()

    vi.mocked(useProviderContextSelector).mockImplementation(selector => selector({
      licenseLimit: { workspace_members: { size: 10, limit: 10 } },
      refreshLicenseLimit: mockRefreshLicenseLimit,
    } as unknown as Parameters<typeof selector>[0]))

    renderModal()

    const input = screen.getByTestId('mock-email-input')
    await user.type(input, 'user@example.com')

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

    const input = screen.getByTestId('mock-email-input')
    // Use an email that passes basic validation but fails our strict regex (needs 2+ char TLD)
    await user.type(input, 'invalid@email.c')
    await user.click(screen.getByRole('button', { name: /members\.sendInvite/i }))

    expect(mockNotify).toHaveBeenCalledWith({
      type: 'error',
      message: 'common.members.emailInvalid',
    })
    expect(inviteMember).not.toHaveBeenCalled()
  })

  it('should remove email from list when remove icon is clicked', async () => {
    const user = userEvent.setup()
    renderModal()

    const input = screen.getByTestId('mock-email-input')
    await user.type(input, 'user@example.com')

    expect(screen.getByText('user@example.com')).toBeInTheDocument()

    const removeBtn = screen.getByTestId('remove-email-btn')
    await user.click(removeBtn)

    expect(screen.queryByText('user@example.com')).not.toBeInTheDocument()
  })

  it('should not submit if already submitting', async () => {
    const user = userEvent.setup()
    let resolveInvite: (value: InvitationResponse) => void
    const invitePromise = new Promise<InvitationResponse>((resolve) => {
      resolveInvite = resolve
    })
    vi.mocked(inviteMember).mockReturnValue(invitePromise)

    renderModal()

    const input = screen.getByTestId('mock-email-input')
    await user.type(input, 'user@example.com')

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
})
