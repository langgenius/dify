import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import FeedBack from '../feed-back'

const mockPush = vi.fn()
const mockSendFeedback = vi.fn()
const mockLogout = vi.fn()

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

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

vi.mock('@/service/use-common', () => ({
  useLogout: () => ({ mutateAsync: mockLogout }),
}))

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: { info: vi.fn() },
}))

vi.mock('../../state', () => ({
  useDeleteAccountFeedback: () => ({
    isPending: false,
    mutateAsync: mockSendFeedback,
  }),
}))

describe('FeedBack', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSendFeedback.mockResolvedValue(undefined)
    mockLogout.mockResolvedValue(undefined)
  })

  it('labels and submits the optional feedback field through the form', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()

    render(<FeedBack onCancel={vi.fn()} onConfirm={onConfirm} />)

    const feedback = screen.getByRole('textbox', { name: 'common.account.feedbackLabel' })
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
    expect(mockPush).toHaveBeenCalledWith('/signin')
  })
})
