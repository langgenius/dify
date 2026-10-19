import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { setPostLoginRedirect } from '@/app/signin/utils/post-login-redirect'
import Chooser from '../chooser'

vi.mock('@/app/signin/utils/post-login-redirect', () => ({ setPostLoginRedirect: vi.fn() }))

it('keeps the device code when starting account sign-in without SSO', async () => {
  const user = userEvent.setup()
  render(<Chooser userCode="ABCD-3456" ssoAvailable={false} />)
  const link = screen.getByRole('link', { name: /deviceFlow.chooser.signInAccount/i })
  expect(link).toHaveAttribute('href', '/signin')
  expect(
    screen.queryByRole('link', { name: /deviceFlow.chooser.signInSSO/i }),
  ).not.toBeInTheDocument()
  await user.click(link)
  expect(setPostLoginRedirect).toHaveBeenCalledWith('/device?user_code=ABCD-3456')
})

it('links directly to the available SSO device flow', () => {
  render(<Chooser userCode="ABCD-3456" ssoAvailable />)
  expect(screen.getByRole('link', { name: /deviceFlow.chooser.signInSSO/i })).toHaveAttribute(
    'href',
    '/openapi/v1/oauth/device/sso-initiate?user_code=ABCD-3456',
  )
})
