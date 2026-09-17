import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CheckEmail from '../check-email'

const mockGetDeleteEmailVerifyCode = vi.fn()

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>()
  return {
    ...actual,
    useSuspenseQuery: ({
      select,
    }: {
      select: (data: { profile: { email: string } }) => string
    }) => ({
      data: select({ profile: { email: 'owner@example.com' } }),
    }),
  }
})

vi.mock('../../state', () => ({
  useSendDeleteAccountEmail: () => ({
    isPending: false,
    mutateAsync: mockGetDeleteEmailVerifyCode,
  }),
}))

describe('CheckEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetDeleteEmailVerifyCode.mockResolvedValue({ result: 'success' })
  })

  it('submits with Enter only after the account email matches', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()

    render(<CheckEmail onCancel={vi.fn()} onConfirm={onConfirm} />)

    const input = screen.getByRole('textbox', { name: 'common.account.deleteLabel' })
    const submitButton = screen.getByRole('button', {
      name: 'common.account.sendVerificationButton',
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
