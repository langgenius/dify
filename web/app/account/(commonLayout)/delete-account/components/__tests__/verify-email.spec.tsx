import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import VerifyEmail from '../verify-email'

const mockConfirmDeleteAccount = vi.fn()
const mockSendEmail = vi.fn()

vi.mock('../../state', () => ({
  useAccountDeleteStore: (selector: (state: { sendEmailToken: string }) => string) =>
    selector({ sendEmailToken: 'email-token' }),
  useConfirmDeleteAccount: () => ({
    isPending: false,
    mutateAsync: mockConfirmDeleteAccount,
  }),
  useSendDeleteAccountEmail: () => ({ mutate: mockSendEmail }),
}))

vi.mock('@/app/components/signin/countdown', () => ({
  default: () => null,
}))

describe('VerifyEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockConfirmDeleteAccount.mockResolvedValue({ result: 'success' })
  })

  it('submits a complete verification code through the form', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()

    render(<VerifyEmail onCancel={vi.fn()} onConfirm={onConfirm} />)

    const input = screen.getByLabelText('common.account.verificationLabel')
    const submitButton = screen.getByRole('button', {
      name: 'common.account.permanentlyDeleteButton',
    })

    expect(submitButton).toBeEnabled()
    await user.click(submitButton)

    const errors = await screen.findAllByText('common.account.verificationPlaceholder')
    expect(errors).toHaveLength(1)
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAccessibleDescription('common.account.verificationPlaceholder')
    expect(input).toHaveFocus()
    expect(mockConfirmDeleteAccount).not.toHaveBeenCalled()

    await user.type(input, '123456')

    expect(submitButton).toBeEnabled()
    await user.keyboard('{Enter}')

    await waitFor(() => {
      expect(mockConfirmDeleteAccount).toHaveBeenCalledWith({
        code: '123456',
        token: 'email-token',
      })
    })
    expect(onConfirm).toHaveBeenCalledOnce()
  })
})
