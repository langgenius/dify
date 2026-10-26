import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithAccountProfile } from '@/test/console/account-profile'
import FeedBack from '../feed-back'

const mockUseLogout = vi.fn()
const mockSendFeedback = vi.fn()
const mockLogout = vi.fn()

vi.mock('@/service/use-common', () => ({
  useLogout: (...args: unknown[]) => mockUseLogout(...args),
}))

vi.mock('../../state', () => ({
  useDeleteAccountFeedback: () => ({
    isPending: false,
    mutateAsync: mockSendFeedback,
  }),
}))

describe('FeedBack', () => {
  beforeEach(() => {
    mockSendFeedback.mockReset().mockResolvedValue(undefined)
    mockLogout.mockReset().mockResolvedValue(undefined)
    mockUseLogout.mockReset().mockReturnValue({ mutateAsync: mockLogout })
  })

  it('labels and submits the optional feedback field through the form', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()

    renderWithAccountProfile(<FeedBack onCancel={vi.fn()} onConfirm={onConfirm} />, {
      accountProfile: { email: 'owner@example.com' },
    })

    const feedback = screen.getByRole('textbox', { name: 'accountSettings.account.feedbackLabel' })
    await user.type(feedback, 'The workspace is no longer needed.')
    await user.click(screen.getByRole('button', { name: 'common.operation.submit' }))

    await waitFor(() => {
      expect(mockSendFeedback).toHaveBeenCalledWith({
        email: 'owner@example.com',
        feedback: 'The workspace is no longer needed.',
      })
    })
    expect(onConfirm).toHaveBeenCalledOnce()
    expect(mockLogout).toHaveBeenCalledOnce()
    expect(mockUseLogout).toHaveBeenCalledWith({ redirectTo: '/signin?account_deleted=true' })
  })
})
