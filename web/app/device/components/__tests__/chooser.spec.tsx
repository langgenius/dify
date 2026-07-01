import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { setPostLoginRedirect } from '@/app/signin/utils/post-login-redirect'
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

  it('sets post-login redirect and navigates to /signin on account button click', () => {
    render(<Chooser userCode="ABCD-3456" ssoAvailable={false} />)
    fireEvent.click(screen.getByRole('button', { name: /Sign in with Dify account/i }))
    expect(vi.mocked(setPostLoginRedirect)).toHaveBeenCalledWith('/device?user_code=ABCD-3456')
    expect(mockPush).toHaveBeenCalledWith('/signin')
  })

  it('encodes userCode in post-login redirect', () => {
    // Uses a code with a space to exercise encodeURIComponent
    render(<Chooser userCode="AB CD" ssoAvailable={false} />)
    fireEvent.click(screen.getByRole('button', { name: /Sign in with Dify account/i }))
    expect(vi.mocked(setPostLoginRedirect)).toHaveBeenCalledWith('/device?user_code=AB%20CD')
  })

  it('navigates to SSO initiate URL on SSO button click', () => {
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { href: '' },
    })
    render(<Chooser userCode="ABCD-3456" ssoAvailable={true} />)
    fireEvent.click(screen.getByRole('button', { name: /Sign in with SSO/i }))
    expect(window.location.href).toBe(
      '/openapi/v1/oauth/device/sso-initiate?user_code=ABCD-3456',
    )
  })
})
