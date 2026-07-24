import { fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthCategory } from '../../types'

const mockGetPluginOAuthUrl = vi.fn().mockResolvedValue({ authorization_url: 'https://auth.example.com' })
const mockOpenOAuthPopup = vi.fn()

vi.mock('@/hooks/use-i18n', () => ({
  useRenderI18nObject: () => (obj: Record<string, string> | string) => typeof obj === 'string' ? obj : obj.en_US || '',
}))

vi.mock('@/hooks/use-oauth', () => ({
  openOAuthPopup: (...args: unknown[]) => mockOpenOAuthPopup(...args),
}))

vi.mock('../../hooks/use-credential', () => ({
  useGetPluginOAuthUrlHook: () => ({
    mutateAsync: mockGetPluginOAuthUrl,
  }),
  useGetPluginOAuthClientSchemaHook: () => ({
    data: {
      schema: [],
      is_oauth_custom_client_enabled: false,
      is_system_oauth_params_exists: true,
      client_params: {},
      redirect_uri: 'https://redirect.example.com',
    },
    isLoading: false,
  }),
}))

vi.mock('../oauth-client-settings', () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="oauth-settings-modal">
      <button data-testid="oauth-settings-close" onClick={onClose}>Close</button>
    </div>
  ),
}))

vi.mock('@/app/components/base/form/types', () => ({
  FormTypeEnum: { radio: 'radio' },
}))

vi.mock('@/utils/classnames', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}))

const basePayload = {
  category: AuthCategory.tool,
  provider: 'test-provider',
}

describe('AddOAuthButton', () => {
  let AddOAuthButton: (typeof import('../add-oauth-button'))['default']

  beforeEach(async () => {
    vi.clearAllMocks()
    const mod = await import('../add-oauth-button')
    AddOAuthButton = mod.default
  })

  it('should render OAuth button when configured (system params exist)', () => {
    render(<AddOAuthButton pluginPayload={basePayload} buttonText="Use OAuth" />)

    expect(screen.getByText('Use OAuth')).toBeInTheDocument()
  })

  it('should open OAuth settings modal when settings icon clicked', () => {
    render(<AddOAuthButton pluginPayload={basePayload} buttonText="Use OAuth" />)

    fireEvent.click(screen.getByTestId('oauth-settings-button'))

    expect(screen.getByTestId('oauth-settings-modal')).toBeInTheDocument()
  })

  it('should close OAuth settings modal', () => {
    render(<AddOAuthButton pluginPayload={basePayload} buttonText="Use OAuth" />)

    fireEvent.click(screen.getByTestId('oauth-settings-button'))
    fireEvent.click(screen.getByTestId('oauth-settings-close'))

    expect(screen.queryByTestId('oauth-settings-modal')).not.toBeInTheDocument()
  })

  it('should trigger OAuth flow on main button click', async () => {
    render(<AddOAuthButton pluginPayload={basePayload} buttonText="Use OAuth" />)

    const button = screen.getByText('Use OAuth').closest('button')
    if (button)
      fireEvent.click(button)

    expect(mockGetPluginOAuthUrl).toHaveBeenCalled()
  })

  it('should be disabled when disabled prop is true', () => {
    render(<AddOAuthButton pluginPayload={basePayload} buttonText="Use OAuth" disabled />)

    const button = screen.getByText('Use OAuth').closest('button')
    expect(button).toBeDisabled()
  })
})
