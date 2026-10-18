import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { render as renderWithoutUrlState } from '@/test/console/render'
import { createNuqsTestRenderer } from '@/test/nuqs-testing'
import PluginAuth from '../plugin-auth'
import { AuthCategory } from '../types'

const mockUsePluginAuth = vi.fn()
const mockConsoleState = vi.hoisted(() => ({
  workspacePermissionKeys: ['credential.use', 'credential.create', 'credential.manage'] as string[],
}))

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

vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')
  return createPermissionStateModuleMock(() => ({
    workspacePermissionKeys: mockConsoleState.workspacePermissionKeys,
  }))
})

const defaultPayload = {
  category: AuthCategory.tool,
  provider: 'test-provider',
}

const onUrlUpdate = vi.fn()
const render = createNuqsTestRenderer(renderWithoutUrlState, () => ({ onUrlUpdate }))

describe('PluginAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockConsoleState.workspacePermissionKeys = [
      'credential.use',
      'credential.create',
      'credential.manage',
    ]
  })

  it('renders Authorize component when not authorized', () => {
    mockUsePluginAuth.mockReturnValue({
      isAuthorized: false,
      canOAuth: false,
      canApiKey: true,
      credentials: [],
      invalidPluginCredentialInfo: vi.fn(),
      notAllowCustomCredential: false,
    })

    render(<PluginAuth pluginPayload={defaultPayload} />)
    expect(mockUsePluginAuth).toHaveBeenCalledWith(defaultPayload, true)
    expect(screen.getByRole('button', { name: 'plugin.auth.useApiAuth' })).toBeEnabled()
    expect(screen.queryByText('plugin.auth.permissionHint.title')).not.toBeInTheDocument()
    expect(screen.queryByTestId('authorized')).not.toBeInTheDocument()
  })

  it('renders Authorized component when authorized and no children', () => {
    mockUsePluginAuth.mockReturnValue({
      isAuthorized: true,
      canOAuth: true,
      canApiKey: true,
      credentials: [{ id: '1', name: 'key', is_default: true, provider: 'test' }],
      invalidPluginCredentialInfo: vi.fn(),
      notAllowCustomCredential: false,
    })

    render(<PluginAuth pluginPayload={defaultPayload} />)
    expect(screen.getByTestId('authorized')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'plugin.auth.useApiAuth' })).not.toBeInTheDocument()
  })

  it('renders children when authorized and children provided', () => {
    mockUsePluginAuth.mockReturnValue({
      isAuthorized: true,
      canOAuth: false,
      canApiKey: true,
      credentials: [{ id: '1', name: 'key', is_default: true, provider: 'test' }],
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

  it('disables authorization without credential.create and links to members settings', async () => {
    const user = userEvent.setup()
    mockConsoleState.workspacePermissionKeys = ['credential.use']
    mockUsePluginAuth.mockReturnValue({
      isAuthorized: false,
      canOAuth: false,
      canApiKey: true,
      credentials: [],
      invalidPluginCredentialInfo: vi.fn(),
      notAllowCustomCredential: false,
    })

    render(<PluginAuth pluginPayload={defaultPayload} />)

    expect(screen.getByRole('button', { name: 'plugin.auth.useApiAuth' })).toBeDisabled()
    expect(screen.getByText('plugin.auth.permissionHint.title')).toBeInTheDocument()
    expect(screen.getByText('plugin.auth.permissionHint.description')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'plugin.auth.permissionHint.action' }))
    await waitFor(() =>
      expect(onUrlUpdate.mock.lastCall?.[0].searchParams.get('settings')).toBe('members'),
    )
  })

  it('does not render permission hint for datasource authorization', () => {
    mockConsoleState.workspacePermissionKeys = ['credential.use']
    mockUsePluginAuth.mockReturnValue({
      isAuthorized: false,
      canOAuth: false,
      canApiKey: true,
      credentials: [],
      invalidPluginCredentialInfo: vi.fn(),
      notAllowCustomCredential: false,
    })

    render(<PluginAuth pluginPayload={{ ...defaultPayload, category: AuthCategory.datasource }} />)

    expect(screen.queryByText('plugin.auth.permissionHint.title')).not.toBeInTheDocument()
  })

  it('does not render permission hint when custom credentials are unavailable', () => {
    mockConsoleState.workspacePermissionKeys = ['credential.use']
    mockUsePluginAuth.mockReturnValue({
      isAuthorized: false,
      canOAuth: false,
      canApiKey: true,
      credentials: [],
      invalidPluginCredentialInfo: vi.fn(),
      notAllowCustomCredential: true,
    })

    render(<PluginAuth pluginPayload={defaultPayload} />)

    expect(screen.queryByText('plugin.auth.permissionHint.title')).not.toBeInTheDocument()
  })
})
