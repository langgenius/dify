import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { COUNT_DOWN_KEY } from '@/app/components/signin/storage'
import { toast } from '@/app/notifications'
import { consoleClient } from '@/service/console'
import { renderWithAccountProfile } from '@/test/console/account-profile'
import CheckEmail from '../check-email'
import VerifyEmail from '../verify-email'

vi.mock('@/app/notifications', () => ({ toast: { error: vi.fn() } }))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'account.delete.verify.get': vi.fn(),
      'account.delete.post': vi.fn(),
    }),
  }
})

describe('VerifyEmail', () => {
  beforeEach(() => {
    localStorage.setItem(COUNT_DOWN_KEY, '0')
    vi.mocked(consoleClient.account.delete.verify.get).mockResolvedValue({
      result: 'success',
      data: 'issued-deletion-token',
    })
    vi.mocked(consoleClient.account.delete.post).mockResolvedValue({ result: 'success' })
  })

  afterEach(() => {
    localStorage.removeItem(COUNT_DOWN_KEY)
  })

  it.each([new Error('Too many requests'), new TypeError('Failed to fetch')])(
    'reports a failed resend without advancing the deletion flow: %s',
    async (error) => {
      const user = userEvent.setup()
      const onConfirm = vi.fn()
      vi.mocked(consoleClient.account.delete.verify.get).mockRejectedValueOnce(error)
      renderWithAccountProfile(<VerifyEmail onCancel={vi.fn()} onConfirm={onConfirm} />)
      await user.click(await screen.findByRole('button', { name: 'login.checkCode.resend' }))
      await waitFor(() => expect(toast.error).toHaveBeenCalledExactlyOnceWith(error.message))
      expect(onConfirm).not.toHaveBeenCalled()
      expect(screen.getByLabelText('accountSettings.account.verificationLabel')).toBeInTheDocument()
    },
  )

  it('submits a complete verification code with the token issued for this account', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()

    // Reach verification through the real email request so the token comes from its owner.
    function DeleteAccountFlow() {
      const [sent, setSent] = useState(false)
      return sent ? (
        <VerifyEmail onCancel={() => setSent(false)} onConfirm={onConfirm} />
      ) : (
        <CheckEmail onCancel={vi.fn()} onConfirm={() => setSent(true)} />
      )
    }
    renderWithAccountProfile(<DeleteAccountFlow />, {
      accountProfile: { email: 'owner@example.com' },
    })
    await user.type(
      screen.getByRole('textbox', { name: 'accountSettings.account.deleteLabel' }),
      'owner@example.com{Enter}',
    )
    await screen.findByLabelText('accountSettings.account.verificationLabel')

    const input = screen.getByLabelText('accountSettings.account.verificationLabel')
    const submitButton = screen.getByRole('button', {
      name: 'accountSettings.account.permanentlyDeleteButton',
    })

    await user.click(submitButton)

    const errors = await screen.findAllByText('accountSettings.account.verificationPlaceholder')
    expect(errors).toHaveLength(1)
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAccessibleDescription('accountSettings.account.verificationPlaceholder')
    expect(input).toHaveFocus()
    expect(consoleClient.account.delete.post).not.toHaveBeenCalled()

    await user.type(input, '123456')

    await user.keyboard('{Enter}')

    await waitFor(() => {
      expect(consoleClient.account.delete.post).toHaveBeenCalledWith({
        body: { code: '123456', token: 'issued-deletion-token' },
      })
    })
    expect(onConfirm).toHaveBeenCalledOnce()
  })
})
