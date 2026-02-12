/**
 * Integration Test: Plugin Authentication Flow
 *
 * Tests the integration between PluginAuth, usePluginAuth hook,
 * Authorize/Authorized components, and credential management.
 * Verifies the complete auth flow from checking authorization status
 * to rendering the correct UI state.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AuthCategory, CredentialTypeEnum } from '@/app/components/plugins/plugin-auth/types'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'plugin.auth.setUpTip': 'Set up your credentials',
        'plugin.auth.authorized': 'Authorized',
        'plugin.auth.apiKey': 'API Key',
        'plugin.auth.oauth': 'OAuth',
      }
      return map[key] ?? key
    },
  }),
}))

vi.mock('@/context/app-context', () => ({
  useAppContext: () => ({
    isCurrentWorkspaceManager: true,
  }),
}))

vi.mock('@/utils/classnames', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}))

const mockUsePluginAuth = vi.fn()
vi.mock('@/app/components/plugins/plugin-auth/hooks/use-plugin-auth', () => ({
  usePluginAuth: (...args: unknown[]) => mockUsePluginAuth(...args),
}))

vi.mock('@/app/components/plugins/plugin-auth/authorize', () => ({
  default: ({ pluginPayload, canOAuth, canApiKey }: {
    pluginPayload: { provider: string }
    canOAuth: boolean
    canApiKey: boolean
  }) => (
    <div data-testid="authorize-component">
      <span data-testid="auth-provider">{pluginPayload.provider}</span>
      {canOAuth && <span data-testid="auth-oauth">OAuth available</span>}
      {canApiKey && <span data-testid="auth-apikey">API Key available</span>}
    </div>
  ),
}))

vi.mock('@/app/components/plugins/plugin-auth/authorized', () => ({
  default: ({ pluginPayload, credentials }: {
    pluginPayload: { provider: string }
    credentials: Array<{ id: string, name: string }>
  }) => (
    <div data-testid="authorized-component">
      <span data-testid="auth-provider">{pluginPayload.provider}</span>
      <span data-testid="auth-credential-count">
        {credentials.length}
        {' '}
        credentials
      </span>
    </div>
  ),
}))

const { default: PluginAuth } = await import('@/app/components/plugins/plugin-auth/plugin-auth')

describe('Plugin Authentication Flow Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    cleanup()
  })

  const basePayload = {
    category: AuthCategory.tool,
    provider: 'test-provider',
  }

  describe('Unauthorized State', () => {
    it('renders Authorize component when not authorized', () => {
      mockUsePluginAuth.mockReturnValue({
        isAuthorized: false,
        canOAuth: false,
        canApiKey: true,
        credentials: [],
        disabled: false,
        invalidPluginCredentialInfo: vi.fn(),
        notAllowCustomCredential: false,
      })

      render(<PluginAuth pluginPayload={basePayload} />)

      expect(screen.getByTestId('authorize-component')).toBeInTheDocument()
      expect(screen.queryByTestId('authorized-component')).not.toBeInTheDocument()
      expect(screen.getByTestId('auth-apikey')).toBeInTheDocument()
    })

    it('shows OAuth option when plugin supports it', () => {
      mockUsePluginAuth.mockReturnValue({
        isAuthorized: false,
        canOAuth: true,
        canApiKey: true,
        credentials: [],
        disabled: false,
        invalidPluginCredentialInfo: vi.fn(),
        notAllowCustomCredential: false,
      })

      render(<PluginAuth pluginPayload={basePayload} />)

      expect(screen.getByTestId('auth-oauth')).toBeInTheDocument()
      expect(screen.getByTestId('auth-apikey')).toBeInTheDocument()
    })

    it('applies className to wrapper when not authorized', () => {
      mockUsePluginAuth.mockReturnValue({
        isAuthorized: false,
        canOAuth: false,
        canApiKey: true,
        credentials: [],
        disabled: false,
        invalidPluginCredentialInfo: vi.fn(),
        notAllowCustomCredential: false,
      })

      const { container } = render(
        <PluginAuth pluginPayload={basePayload} className="custom-class" />,
      )

      expect(container.firstChild).toHaveClass('custom-class')
    })
  })

  describe('Authorized State', () => {
    it('renders Authorized component when authorized and no children', () => {
      mockUsePluginAuth.mockReturnValue({
        isAuthorized: true,
        canOAuth: false,
        canApiKey: true,
        credentials: [
          { id: 'cred-1', name: 'My API Key', is_default: true },
        ],
        disabled: false,
        invalidPluginCredentialInfo: vi.fn(),
        notAllowCustomCredential: false,
      })

      render(<PluginAuth pluginPayload={basePayload} />)

      expect(screen.queryByTestId('authorize-component')).not.toBeInTheDocument()
      expect(screen.getByTestId('authorized-component')).toBeInTheDocument()
      expect(screen.getByTestId('auth-credential-count')).toHaveTextContent('1 credentials')
    })

    it('renders children instead of Authorized when authorized and children provided', () => {
      mockUsePluginAuth.mockReturnValue({
        isAuthorized: true,
        canOAuth: false,
        canApiKey: true,
        credentials: [{ id: 'cred-1', name: 'Key', is_default: true }],
        disabled: false,
        invalidPluginCredentialInfo: vi.fn(),
        notAllowCustomCredential: false,
      })

      render(
        <PluginAuth pluginPayload={basePayload}>
          <div data-testid="custom-children">Custom authorized view</div>
        </PluginAuth>,
      )

      expect(screen.queryByTestId('authorize-component')).not.toBeInTheDocument()
      expect(screen.queryByTestId('authorized-component')).not.toBeInTheDocument()
      expect(screen.getByTestId('custom-children')).toBeInTheDocument()
    })

    it('does not apply className when authorized', () => {
      mockUsePluginAuth.mockReturnValue({
        isAuthorized: true,
        canOAuth: false,
        canApiKey: true,
        credentials: [{ id: 'cred-1', name: 'Key', is_default: true }],
        disabled: false,
        invalidPluginCredentialInfo: vi.fn(),
        notAllowCustomCredential: false,
      })

      const { container } = render(
        <PluginAuth pluginPayload={basePayload} className="custom-class" />,
      )

      expect(container.firstChild).not.toHaveClass('custom-class')
    })
  })

  describe('Auth Category Integration', () => {
    it('passes correct provider to usePluginAuth for tool category', () => {
      mockUsePluginAuth.mockReturnValue({
        isAuthorized: false,
        canOAuth: false,
        canApiKey: true,
        credentials: [],
        disabled: false,
        invalidPluginCredentialInfo: vi.fn(),
        notAllowCustomCredential: false,
      })

      const toolPayload = {
        category: AuthCategory.tool,
        provider: 'google-search-provider',
      }

      render(<PluginAuth pluginPayload={toolPayload} />)

      expect(mockUsePluginAuth).toHaveBeenCalledWith(toolPayload, true)
      expect(screen.getByTestId('auth-provider')).toHaveTextContent('google-search-provider')
    })

    it('passes correct provider to usePluginAuth for datasource category', () => {
      mockUsePluginAuth.mockReturnValue({
        isAuthorized: false,
        canOAuth: true,
        canApiKey: false,
        credentials: [],
        disabled: false,
        invalidPluginCredentialInfo: vi.fn(),
        notAllowCustomCredential: false,
      })

      const dsPayload = {
        category: AuthCategory.datasource,
        provider: 'notion-datasource',
      }

      render(<PluginAuth pluginPayload={dsPayload} />)

      expect(mockUsePluginAuth).toHaveBeenCalledWith(dsPayload, true)
      expect(screen.getByTestId('auth-oauth')).toBeInTheDocument()
      expect(screen.queryByTestId('auth-apikey')).not.toBeInTheDocument()
    })
  })

  describe('Multiple Credentials', () => {
    it('shows credential count when multiple credentials exist', () => {
      mockUsePluginAuth.mockReturnValue({
        isAuthorized: true,
        canOAuth: true,
        canApiKey: true,
        credentials: [
          { id: 'cred-1', name: 'API Key 1', is_default: true },
          { id: 'cred-2', name: 'API Key 2', is_default: false },
          { id: 'cred-3', name: 'OAuth Token', is_default: false, credential_type: CredentialTypeEnum.OAUTH2 },
        ],
        disabled: false,
        invalidPluginCredentialInfo: vi.fn(),
        notAllowCustomCredential: false,
      })

      render(<PluginAuth pluginPayload={basePayload} />)

      expect(screen.getByTestId('auth-credential-count')).toHaveTextContent('3 credentials')
    })
  })
})
