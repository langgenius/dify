import type { SsoProtocol } from '@dify/contracts/api/console/system-features/types.gen'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import SSOAuth from '../sso-auth'

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  toastError: vi.fn(),
  getUserSAMLSSOUrl: vi.fn(),
  getUserOIDCSSOUrl: vi.fn(),
  getUserOAuth2SSOUrl: vi.fn(),
}))

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ push: mocks.push }),
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/app/notifications', () => ({
  toast: { error: mocks.toastError },
}))

vi.mock('@/service/sso', () => ({
  getUserSAMLSSOUrl: (...args: unknown[]) => mocks.getUserSAMLSSOUrl(...args),
  getUserOIDCSSOUrl: (...args: unknown[]) => mocks.getUserOIDCSSOUrl(...args),
  getUserOAuth2SSOUrl: (...args: unknown[]) => mocks.getUserOAuth2SSOUrl(...args),
}))

const requests: Record<SsoProtocol, ReturnType<typeof vi.fn>> = {
  saml: mocks.getUserSAMLSSOUrl,
  oidc: mocks.getUserOIDCSSOUrl,
  oauth2: mocks.getUserOAuth2SSOUrl,
}

describe('SSOAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each(['saml', 'oidc', 'oauth2'] as const)(
    'should redirect to the %s provider url on success',
    async (protocol) => {
      const user = userEvent.setup()
      requests[protocol].mockResolvedValue({ url: 'https://idp.example.com/login', state: 'state' })
      render(<SSOAuth protocol={protocol} />)

      await user.click(screen.getByRole('button', { name: 'login.withSSO' }))

      await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('https://idp.example.com/login'))
      expect(mocks.toastError).not.toHaveBeenCalled()
    },
  )

  it.each(['saml', 'oidc', 'oauth2'] as const)(
    'should show an error and re-enable the button when the %s request fails',
    async (protocol) => {
      const user = userEvent.setup()
      requests[protocol].mockRejectedValue(new TypeError('Failed to fetch'))
      render(<SSOAuth protocol={protocol} />)
      const button = screen.getByRole('button', { name: 'login.withSSO' })

      await user.click(button)

      await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith('login.error.ssoFailed'))
      expect(button).toBeEnabled()
      expect(mocks.push).not.toHaveBeenCalled()
    },
  )
})
