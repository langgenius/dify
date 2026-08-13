import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import useDocumentTitle from '@/hooks/use-document-title'
import { useRouter, useSearchParams } from '@/next/navigation'
import { changeWebAppPasswordWithToken } from '@/service/common'
import ChangePasswordForm from '../page'

vi.mock('ahooks', () => ({
  useCountDown: () => [5000],
}))

vi.mock('@/next/navigation', () => ({
  useRouter: vi.fn(),
  useSearchParams: vi.fn(),
}))

vi.mock('@/service/common', () => ({
  changeWebAppPasswordWithToken: vi.fn(),
}))

vi.mock('@/hooks/use-document-title', () => ({
  default: vi.fn(),
}))

const mockUseDocumentTitle = vi.mocked(useDocumentTitle)

describe('Webapp Reset Password Set Password Page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useRouter).mockReturnValue({ replace: vi.fn() } as unknown as ReturnType<
      typeof useRouter
    >)
    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams({ token: 'reset-token' }) as unknown as ReturnType<
        typeof useSearchParams
      >,
    )
    vi.mocked(changeWebAppPasswordWithToken).mockResolvedValue({ result: 'success' })
  })

  it('reconciles the route title initially and updates it after a successful reset', async () => {
    render(<ChangePasswordForm />)

    expect(mockUseDocumentTitle).toHaveBeenCalledWith('login.changePassword')

    fireEvent.change(screen.getByLabelText('common.account.newPassword'), {
      target: { value: 'ValidPass123!' },
    })
    fireEvent.change(screen.getByLabelText('common.account.confirmPassword'), {
      target: { value: 'ValidPass123!' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'login.changePasswordBtn' }))

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
        'login.passwordChangedTip',
      )
    })
    expect(mockUseDocumentTitle).toHaveBeenLastCalledWith('login.passwordChangedTip')
  })
})
