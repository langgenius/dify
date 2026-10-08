import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import SSOAuth from '../sso-auth'

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ push: mocks.push }),
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/app/notifications', () => ({
  toast: { error: mocks.toastError },
}))

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

const clickSSOButton = async () => {
  const user = userEvent.setup()
  const button = screen.getByRole('button', { name: 'login.withSSO' })
  await user.click(button)
  return button
}

describe('SSOAuth', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
  })

  it.each(['saml', 'oidc', 'oauth2'] as const)(
    'should redirect to the %s provider url on success',
    async (protocol) => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(jsonResponse({ url: 'https://idp.example.com/login', state: 'state' }))
      render(<SSOAuth protocol={protocol} />)

      await clickSSOButton()

      await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('https://idp.example.com/login'))
      expect(String((fetchSpy.mock.calls[0]![0] as Request).url)).toContain(
        `/enterprise/sso/${protocol}/login`,
      )
      expect(mocks.toastError).not.toHaveBeenCalled()
    },
  )

  it.each(['saml', 'oidc', 'oauth2'] as const)(
    'should show an error and re-enable the button when the %s request fails',
    async (protocol) => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'))
      render(<SSOAuth protocol={protocol} />)

      const button = await clickSSOButton()

      await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith('login.error.ssoFailed'))
      expect(mocks.toastError).toHaveBeenCalledTimes(1)
      expect(button).toBeEnabled()
      expect(mocks.push).not.toHaveBeenCalled()
    },
  )

  it('should show an error when the server responds without a JSON error message', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<html>Bad Gateway</html>', {
        status: 502,
        headers: { 'Content-Type': 'text/html' },
      }),
    )
    render(<SSOAuth protocol="saml" />)

    const button = await clickSSOButton()

    await waitFor(() => expect(button).toBeEnabled())
    expect(mocks.toastError).toHaveBeenCalledTimes(1)
    expect(mocks.toastError).toHaveBeenCalledWith('login.error.ssoFailed')
  })

  it('should only show the server message when the error response carries one', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ message: 'SSO provider unavailable' }, 500),
    )
    render(<SSOAuth protocol="saml" />)

    const button = await clickSSOButton()

    await waitFor(() => expect(button).toBeEnabled())
    expect(mocks.toastError).toHaveBeenCalledTimes(1)
    expect(mocks.toastError).toHaveBeenCalledWith('SSO provider unavailable')
  })
})
