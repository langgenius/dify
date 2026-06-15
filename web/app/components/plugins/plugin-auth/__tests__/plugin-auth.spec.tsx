import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ACCOUNT_SETTING_TAB } from '@/app/components/header/account-setting/constants'
import PluginAuth from '../plugin-auth'
import { AuthCategory } from '../types'

const mockUsePluginAuth = vi.fn()
const mockSetShowAccountSettingModal = vi.fn()

vi.mock('../hooks/use-plugin-auth', () => ({
  usePluginAuth: (...args: unknown[]) => mockUsePluginAuth(...args),
}))

vi.mock('../authorized', () => ({
  default: ({ pluginPayload }: { pluginPayload: { provider: string } }) => (
    <div data-testid="authorized">
      Authorized:
      {pluginPayload.provider}
    </div>
  ),
}))

vi.mock('@/context/modal-context', () => ({
  useModalContext: () => ({
    setShowAccountSettingModal: mockSetShowAccountSettingModal,
  }),
}))

const defaultPayload = {
  category: AuthCategory.tool,
  provider: 'test-provider',
}

describe('PluginAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

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

    render(<PluginAuth pluginPayload={defaultPayload} />)
    expect(screen.getByRole('button', { name: 'plugin.auth.useApiAuth' })).toBeEnabled()
    expect(screen.queryByTestId('authorized')).not.toBeInTheDocument()
  })

  it('renders Authorized component when authorized and no children', () => {
    mockUsePluginAuth.mockReturnValue({
      isAuthorized: true,
      canOAuth: true,
      canApiKey: true,
      credentials: [{ id: '1', name: 'key', is_default: true, provider: 'test' }],
      disabled: false,
      invalidPluginCredentialInfo: vi.fn(),
      notAllowCustomCredential: false,
    })

    render(<PluginAuth pluginPayload={defaultPayload} />)
    expect(screen.getByTestId('authorized')).toBeInTheDocument()
    expect(screen.queryByTestId('authorize')).not.toBeInTheDocument()
  })

  it('renders children when authorized and children provided', () => {
    mockUsePluginAuth.mockReturnValue({
      isAuthorized: true,
      canOAuth: false,
      canApiKey: true,
      credentials: [{ id: '1', name: 'key', is_default: true, provider: 'test' }],
      disabled: false,
      invalidPluginCredentialInfo: vi.fn(),
      notAllowCustomCredential: false,
    })

    render(
      <PluginAuth pluginPayload={defaultPayload}>
        <div data-testid="custom-children">Custom Content</div>
      </PluginAuth>,
    )
    expect(screen.getByTestId('custom-children')).toBeInTheDocument()
    expect(screen.queryByTestId('authorized')).not.toBeInTheDocument()
  })

  it('renders with className wrapper when not authorized', () => {
    mockUsePluginAuth.mockReturnValue({
      isAuthorized: false,
      canOAuth: false,
      canApiKey: true,
      credentials: [],
      disabled: false,
      invalidPluginCredentialInfo: vi.fn(),
      notAllowCustomCredential: false,
    })

    const { container } = render(<PluginAuth pluginPayload={defaultPayload} className="custom-class" />)
    expect(container.innerHTML).toContain('custom-class')
  })

  it('does not render className wrapper when authorized', () => {
    mockUsePluginAuth.mockReturnValue({
      isAuthorized: true,
      canOAuth: false,
      canApiKey: true,
      credentials: [],
      disabled: false,
      invalidPluginCredentialInfo: vi.fn(),
      notAllowCustomCredential: false,
    })

    const { container } = render(<PluginAuth pluginPayload={defaultPayload} className="custom-class" />)
    expect(container.innerHTML).not.toContain('custom-class')
  })

  it('passes pluginPayload.provider to usePluginAuth', () => {
    mockUsePluginAuth.mockReturnValue({
      isAuthorized: false,
      canOAuth: false,
      canApiKey: false,
      credentials: [],
      disabled: false,
      invalidPluginCredentialInfo: vi.fn(),
      notAllowCustomCredential: false,
    })

    render(<PluginAuth pluginPayload={defaultPayload} />)
    expect(mockUsePluginAuth).toHaveBeenCalledWith(defaultPayload, true)
  })

  it('renders permission hint when authorization configuration is disabled by workspace permissions', () => {
    mockUsePluginAuth.mockReturnValue({
      isAuthorized: false,
      canOAuth: false,
      canApiKey: true,
      credentials: [],
      disabled: true,
      invalidPluginCredentialInfo: vi.fn(),
      notAllowCustomCredential: false,
    })

    render(<PluginAuth pluginPayload={defaultPayload} />)

    expect(screen.getByRole('button', { name: 'plugin.auth.useApiAuth' })).toBeDisabled()
    expect(screen.getByText('plugin.auth.permissionHint.title')).toBeInTheDocument()
    expect(screen.getByText('plugin.auth.permissionHint.description')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'plugin.auth.permissionHint.action' })).toBeInTheDocument()
  })

  it('opens members settings when permission hint action is clicked', () => {
    mockUsePluginAuth.mockReturnValue({
      isAuthorized: false,
      canOAuth: false,
      canApiKey: true,
      credentials: [],
      disabled: true,
      invalidPluginCredentialInfo: vi.fn(),
      notAllowCustomCredential: false,
    })

    render(<PluginAuth pluginPayload={defaultPayload} />)
    fireEvent.click(screen.getByRole('button', { name: 'plugin.auth.permissionHint.action' }))

    expect(mockSetShowAccountSettingModal).toHaveBeenCalledWith({
      payload: ACCOUNT_SETTING_TAB.MEMBERS,
    })
  })

  it('does not render permission hint for datasource authorization', () => {
    mockUsePluginAuth.mockReturnValue({
      isAuthorized: false,
      canOAuth: false,
      canApiKey: true,
      credentials: [],
      disabled: true,
      invalidPluginCredentialInfo: vi.fn(),
      notAllowCustomCredential: false,
    })

    render(<PluginAuth pluginPayload={{ ...defaultPayload, category: AuthCategory.datasource }} />)

    expect(screen.queryByText('plugin.auth.permissionHint.title')).not.toBeInTheDocument()
  })

  it('does not render permission hint when custom credentials are unavailable', () => {
    mockUsePluginAuth.mockReturnValue({
      isAuthorized: false,
      canOAuth: false,
      canApiKey: true,
      credentials: [],
      disabled: true,
      invalidPluginCredentialInfo: vi.fn(),
      notAllowCustomCredential: true,
    })

    render(<PluginAuth pluginPayload={defaultPayload} />)

    expect(screen.queryByText('plugin.auth.permissionHint.title')).not.toBeInTheDocument()
  })
})
