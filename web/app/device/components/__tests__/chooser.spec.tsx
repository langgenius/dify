import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vite-plus/test'
import { setPostLoginRedirect } from '@/app/signin/utils/post-login-redirect'
import Chooser from '../chooser'

vi.mock('@/app/signin/utils/post-login-redirect', () => ({
  setPostLoginRedirect: vi.fn(),
}))

describe('Chooser', () => {
  it('renders an account sign-in link', () => {
    render(<Chooser userCode="ABCD-3456" ssoAvailable={false} />)
    expect(screen.getByRole('link', { name: /deviceFlow.chooser.signInAccount/i })).toHaveAttribute(
      'href',
      '/signin',
    )
  })

  it('hides SSO button when ssoAvailable is false', () => {
    render(<Chooser userCode="ABCD-3456" ssoAvailable={false} />)
    expect(
      screen.queryByRole('link', { name: /deviceFlow.chooser.signInSSO/i }),
    ).not.toBeInTheDocument()
  })

  it('sets the post-login redirect when the account link is activated', () => {
    render(<Chooser userCode="ABCD-3456" ssoAvailable={false} />)
    fireEvent.click(screen.getByRole('link', { name: /deviceFlow.chooser.signInAccount/i }))
    expect(vi.mocked(setPostLoginRedirect)).toHaveBeenCalledWith('/device?user_code=ABCD-3456')
  })

  it('encodes userCode in post-login redirect', () => {
    // Uses a code with a space to exercise encodeURIComponent
    render(<Chooser userCode="AB CD" ssoAvailable={false} />)
    fireEvent.click(screen.getByRole('link', { name: /deviceFlow.chooser.signInAccount/i }))
    expect(vi.mocked(setPostLoginRedirect)).toHaveBeenCalledWith('/device?user_code=AB%20CD')
  })

  it('links to the SSO initiate URL', () => {
    render(<Chooser userCode="ABCD-3456" ssoAvailable={true} />)
    expect(screen.getByRole('link', { name: /deviceFlow.chooser.signInSSO/i })).toHaveAttribute(
      'href',
      '/openapi/v1/oauth/device/sso-initiate?user_code=ABCD-3456',
    )
  })
})
