import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithAccountProfile } from '@/test/console/account-profile'
import CheckEmail from '../check-email'

const mockGetDeleteEmailVerifyCode = vi.fn()

vi.mock('../../state', () => ({
  useSendDeleteAccountEmail: () => ({
    isPending: false,
    mutateAsync: mockGetDeleteEmailVerifyCode,
  }),
}))

describe('CheckEmail', () => {
  beforeEach(() => {
    mockGetDeleteEmailVerifyCode.mockReset().mockResolvedValue({ result: 'success' })
  })

  it('submits with Enter only after the account email matches', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()

    renderWithAccountProfile(<CheckEmail onCancel={vi.fn()} onConfirm={onConfirm} />, {
      accountProfile: { email: 'owner@example.com' },
    })

    const input = screen.getByRole('textbox', { name: 'accountSettings.account.deleteLabel' })
    const submitButton = screen.getByRole('button', {
      name: 'accountSettings.account.sendVerificationButton',
    })

    await user.type(input, 'someone@example.com{Enter}')

    expect(submitButton).toBeDisabled()
    expect(mockGetDeleteEmailVerifyCode).not.toHaveBeenCalled()

    await user.clear(input)
    await user.type(input, 'owner@example.com{Enter}')

    await waitFor(() => {
      expect(mockGetDeleteEmailVerifyCode).toHaveBeenCalledOnce()
    })
    expect(submitButton).toBeEnabled()
    expect(onConfirm).toHaveBeenCalledOnce()
  })
})
