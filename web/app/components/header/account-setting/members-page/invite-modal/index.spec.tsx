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

    const input = screen.getByRole('textbox')
    await user.type(input, 'user@example.com{enter}')

    expect(screen.getByRole('button', { name: /members\.sendInvite/i })).toBeEnabled()
  })

  it('should not close modal when invite request fails', async () => {
    const user = userEvent.setup()
    vi.mocked(inviteMember).mockRejectedValue(new Error('request failed'))

    renderModal()

    await user.type(screen.getByRole('textbox'), 'user@example.com{enter}')
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

    const input = screen.getByRole('textbox')
    await user.type(input, 'user@example.com{enter}')
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

    const input = screen.getByRole('textbox')
    await user.type(input, 'user@example.com{enter}')

    expect(screen.getByRole('button', { name: /members\.sendInvite/i })).toBeDisabled()
  })
})
