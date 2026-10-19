import type { ReactNode } from 'react'
import type { Credential, PluginPayload } from '../types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { seedAccountProfileQuery } from '@/test/console/account-profile'
import { render } from '@/test/console/render'
import { AuthCategory, CredentialTypeEnum } from '../types'

// ==================== Mock Setup ====================

const mockGetPluginCredentialInfo = vi.fn()
const mockGetPluginOAuthClientSchema = vi.fn()

vi.mock('@/service/use-plugins-auth', () => ({
  useGetPluginCredentialInfo: (url: string) => ({
    data: url ? mockGetPluginCredentialInfo() : undefined,
    isLoading: false,
  }),
  useDeletePluginCredential: () => ({ mutateAsync: vi.fn() }),
  useSetPluginDefaultCredential: () => ({ mutateAsync: vi.fn() }),
  useUpdatePluginCredential: () => ({ mutateAsync: vi.fn() }),
  useInvalidPluginCredentialInfo: () => vi.fn(),
  useGetPluginOAuthUrl: () => ({ mutateAsync: vi.fn() }),
  useGetPluginOAuthClientSchema: () => ({
    data: mockGetPluginOAuthClientSchema(),
    isLoading: false,
  }),
  useSetPluginOAuthCustomClient: () => ({ mutateAsync: vi.fn() }),
  useDeletePluginOAuthCustomClient: () => ({ mutateAsync: vi.fn() }),
  useInvalidPluginOAuthClientSchema: () => vi.fn(),
  useAddPluginCredential: () => ({ mutateAsync: vi.fn() }),
  useGetPluginCredentialSchema: () => ({ data: undefined, isLoading: false }),
}))

const mockIsCurrentWorkspaceManager = vi.fn()
const mockUserProfile = {
  id: 'test-user',
  name: 'Test User',
  email: 'test@example.com',
  avatar_url: '',
}

vi.mock('@/context/workspace-state', async () => {
  const { createWorkspaceStateModuleMock } = await import('@/test/console/state-fixture')
  return createWorkspaceStateModuleMock(() => ({
    userProfile: mockUserProfile,
    isCurrentWorkspaceManager: mockIsCurrentWorkspaceManager(),
    workspacePermissionKeys: ['credential.use', 'credential.create', 'credential.manage'],
  }))
})
vi.mock('@/context/permission-state', async () => {
  const { createPermissionStateModuleMock } = await import('@/test/console/state-fixture')
  return createPermissionStateModuleMock(() => ({
    userProfile: mockUserProfile,
    isCurrentWorkspaceManager: mockIsCurrentWorkspaceManager(),
    workspacePermissionKeys: ['credential.use', 'credential.create', 'credential.manage'],
  }))
})

vi.mock('@/hooks/use-oauth', () => ({
  openOAuthPopup: vi.fn(),
}))

vi.mock('@/service/use-triggers', () => ({
  useTriggerPluginDynamicOptions: () => ({ data: { options: [] }, isLoading: false }),
}))

// ==================== Test Utilities ====================

const createConsoleQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
    },
  })

const createWrapper = () => {
  const testQueryClient = createConsoleQueryClient()
  seedAccountProfileQuery(testQueryClient, mockUserProfile)
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={testQueryClient}>{children}</QueryClientProvider>
  )
}

const createPluginPayload = (overrides: Partial<PluginPayload> = {}): PluginPayload => ({
  category: AuthCategory.tool,
  provider: 'test-provider',
  ...overrides,
})

const createCredential = (overrides: Partial<Credential> = {}): Credential => ({
  id: 'test-credential-id',
  name: 'Test Credential',
  provider: 'test-provider',
  credential_type: CredentialTypeEnum.API_KEY,
  is_default: false,
  credentials: { api_key: 'test-key' },
  ...overrides,
})

// ==================== Tests ====================

describe('PluginAuthInAgent Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsCurrentWorkspaceManager.mockReturnValue(true)
    mockGetPluginCredentialInfo.mockReturnValue({
      credentials: [createCredential()],
      supported_credential_types: [CredentialTypeEnum.API_KEY],
      allow_custom_token: true,
    })
    mockGetPluginOAuthClientSchema.mockReturnValue({
      schema: [],
      is_oauth_custom_client_enabled: false,
      is_system_oauth_params_exists: false,
    })
  })

  it('should render Authorize when not authorized', async () => {
    const PluginAuthInAgent = (await import('../plugin-auth-in-agent')).default
    mockGetPluginCredentialInfo.mockReturnValue({
      credentials: [],
      supported_credential_types: [CredentialTypeEnum.API_KEY],
      allow_custom_token: true,
    })
    const pluginPayload = createPluginPayload()
    render(<PluginAuthInAgent pluginPayload={pluginPayload} />, { wrapper: createWrapper() })
    expect(screen.getByRole('button', { name: 'plugin.auth.useApiAuth' })).toBeEnabled()
  })

  it('should render Authorized with workspace default when authorized', async () => {
    const PluginAuthInAgent = (await import('../plugin-auth-in-agent')).default
    const pluginPayload = createPluginPayload()
    render(<PluginAuthInAgent pluginPayload={pluginPayload} />, { wrapper: createWrapper() })
    expect(screen.getByText('plugin.auth.workspaceDefault'))!.toBeInTheDocument()
  })

  it('should show credential name when credentialId is provided', async () => {
    const PluginAuthInAgent = (await import('../plugin-auth-in-agent')).default
    const credential = createCredential({ id: 'selected-id', name: 'Selected Credential' })
    mockGetPluginCredentialInfo.mockReturnValue({
      credentials: [credential],
      supported_credential_types: [CredentialTypeEnum.API_KEY],
      allow_custom_token: true,
    })
    const pluginPayload = createPluginPayload()
    render(<PluginAuthInAgent pluginPayload={pluginPayload} credentialId="selected-id" />, {
      wrapper: createWrapper(),
    })
    expect(screen.getByText('Selected Credential'))!.toBeInTheDocument()
  })

  it('should show auth removed when credential not found', async () => {
    const PluginAuthInAgent = (await import('../plugin-auth-in-agent')).default
    mockGetPluginCredentialInfo.mockReturnValue({
      credentials: [createCredential()],
      supported_credential_types: [CredentialTypeEnum.API_KEY],
      allow_custom_token: true,
    })
    const pluginPayload = createPluginPayload()
    render(<PluginAuthInAgent pluginPayload={pluginPayload} credentialId="non-existent-id" />, {
      wrapper: createWrapper(),
    })
    expect(screen.getByText('plugin.auth.authRemoved'))!.toBeInTheDocument()
  })

  it('should show unavailable when credential is not allowed to use', async () => {
    const PluginAuthInAgent = (await import('../plugin-auth-in-agent')).default
    const credential = createCredential({
      id: 'unavailable-id',
      name: 'Unavailable Credential',
      not_allowed_to_use: true,
      from_enterprise: false,
    })
    mockGetPluginCredentialInfo.mockReturnValue({
      credentials: [credential],
      supported_credential_types: [CredentialTypeEnum.API_KEY],
      allow_custom_token: true,
    })
    const pluginPayload = createPluginPayload()
    render(<PluginAuthInAgent pluginPayload={pluginPayload} credentialId="unavailable-id" />, {
      wrapper: createWrapper(),
    })
    const button = screen.getByRole('button')
    expect(button.textContent).toContain('plugin.auth.unavailable')
  })

  it('should trigger handleAuthorizationItemClick and close popup when item is clicked', async () => {
    const PluginAuthInAgent = (await import('../plugin-auth-in-agent')).default
    const onAuthorizationItemClick = vi.fn()
    const credential = createCredential({ id: 'test-cred-id', name: 'Test Credential' })
    mockGetPluginCredentialInfo.mockReturnValue({
      credentials: [credential],
      supported_credential_types: [CredentialTypeEnum.API_KEY],
      allow_custom_token: true,
    })
    const pluginPayload = createPluginPayload()
    render(
      <PluginAuthInAgent
        pluginPayload={pluginPayload}
        onAuthorizationItemClick={onAuthorizationItemClick}
      />,
      { wrapper: createWrapper() },
    )
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'plugin.auth.workspaceDefault' }))
    await user.click(
      within(await screen.findByRole('dialog')).getByText('plugin.auth.workspaceDefault'),
    )
    expect(onAuthorizationItemClick).toHaveBeenCalledExactlyOnceWith('')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('should call onAuthorizationItemClick with credential id when specific credential is clicked', async () => {
    const PluginAuthInAgent = (await import('../plugin-auth-in-agent')).default
    const onAuthorizationItemClick = vi.fn()
    const credential = createCredential({
      id: 'specific-cred-id',
      name: 'Specific Credential',
      credential_type: CredentialTypeEnum.API_KEY,
    })
    mockGetPluginCredentialInfo.mockReturnValue({
      credentials: [credential],
      supported_credential_types: [CredentialTypeEnum.API_KEY],
      allow_custom_token: true,
    })
    const pluginPayload = createPluginPayload()
    render(
      <PluginAuthInAgent
        pluginPayload={pluginPayload}
        onAuthorizationItemClick={onAuthorizationItemClick}
      />,
      { wrapper: createWrapper() },
    )
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'plugin.auth.workspaceDefault' }))
    await user.click(within(await screen.findByRole('dialog')).getByText('Specific Credential'))
    expect(onAuthorizationItemClick).toHaveBeenCalledExactlyOnceWith('specific-cred-id')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})
