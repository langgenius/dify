import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import Chooser from '../chooser'

const mockPush = vi.fn()

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

vi.mock('@/app/signin/utils/post-login-redirect', () => ({
  setPostLoginRedirect: vi.fn(),
}))

describe('Chooser', () => {
  it('renders account button', () => {
    render(<Chooser userCode="ABCD-3456" ssoAvailable={false} />)
    expect(screen.getByRole('button', { name: /Sign in with Dify account/i })).toBeInTheDocument()
  })

  it('hides SSO button when ssoAvailable is false', () => {
    render(<Chooser userCode="ABCD-3456" ssoAvailable={false} />)
    expect(screen.queryByRole('button', { name: /Sign in with SSO/i })).not.toBeInTheDocument()
  })

  it('shows SSO button when ssoAvailable is true', () => {
    render(<Chooser userCode="ABCD-3456" ssoAvailable={true} />)
    expect(screen.getByRole('button', { name: /Sign in with SSO/i })).toBeInTheDocument()
  })

  it('navigates to /signin on account button click', () => {
    render(<Chooser userCode="ABCD-3456" ssoAvailable={false} />)
    fireEvent.click(screen.getByRole('button', { name: /Sign in with Dify account/i }))
    expect(mockPush).toHaveBeenCalledWith('/signin')
  })
})
