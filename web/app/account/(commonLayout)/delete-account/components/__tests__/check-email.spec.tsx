import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { consoleClient } from '@/service/console'
import { renderWithAccountProfile } from '@/test/console/account-profile'
import { useAccountDeleteStore } from '../../state'
import CheckEmail from '../check-email'

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'account.delete.verify.get': vi.fn(),
    }),
  }
})

describe('CheckEmail', () => {
  beforeEach(() => {
    vi.mocked(consoleClient.account.delete.verify.get).mockResolvedValue({
      result: 'success',
      data: 'deletion-email-token',
    })
  })

  it('requests and stores a verification token only after the account email matches', async () => {
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
    expect(consoleClient.account.delete.verify.get).not.toHaveBeenCalled()

    await user.clear(input)
    await user.type(input, 'owner@example.com{Enter}')

    await waitFor(() => {
      expect(useAccountDeleteStore.getState().sendEmailToken).toBe('deletion-email-token')
    })
    expect(submitButton).toBeEnabled()
    expect(consoleClient.account.delete.verify.get).toHaveBeenCalledExactlyOnceWith()
    expect(onConfirm).toHaveBeenCalledOnce()
  })
})
