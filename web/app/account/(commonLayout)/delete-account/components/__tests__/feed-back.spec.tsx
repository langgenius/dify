import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { consoleClient } from '@/service/console'
import { renderWithAccountProfile } from '@/test/console/account-profile'
import FeedBack from '../feed-back'

const { logout } = vi.hoisted(() => ({ logout: vi.fn() }))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses, withConsoleResponses } =
    await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'account.delete.feedback.post': vi.fn(),
    }),
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'logout.post': logout,
    }),
  }
})

// Analytics is an external SDK; logout and its redirect remain real.
vi.mock('@/app/components/base/amplitude/utils', () => ({ resetUser: vi.fn() }))

describe('FeedBack', () => {
  beforeEach(() => {
    vi.mocked(consoleClient.account.delete.feedback.post).mockResolvedValue({ result: 'success' })
    logout.mockResolvedValue({ result: 'success' })
  })

  afterEach(() => vi.restoreAllMocks())

  it('submits feedback and logs out to the account-deleted sign-in page', async () => {
    const replace = vi.spyOn(window.location, 'replace').mockImplementation(() => {})
    const user = userEvent.setup()
    const onConfirm = vi.fn()

    renderWithAccountProfile(<FeedBack onCancel={vi.fn()} onConfirm={onConfirm} />, {
      accountProfile: { email: 'owner@example.com' },
    })

    const feedback = screen.getByRole('textbox', { name: 'accountSettings.account.feedbackLabel' })
    await user.type(feedback, 'The workspace is no longer needed.')
    await user.click(screen.getByRole('button', { name: 'common.operation.submit' }))

    await waitFor(() => {
      expect(replace).toHaveBeenCalledExactlyOnceWith('/signin?account_deleted=true')
    })
    expect(onConfirm).toHaveBeenCalledOnce()
    expect(consoleClient.account.delete.feedback.post).toHaveBeenCalledExactlyOnceWith({
      body: { email: 'owner@example.com', feedback: 'The workspace is no longer needed.' },
    })
    expect(logout).toHaveBeenCalledOnce()
  })
})
