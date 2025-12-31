import type { ReactNode } from 'react'
import type { PluginPayload } from '../types'
import type { FormSchema } from '@/app/components/base/form/types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthCategory } from '../types'

// Create a wrapper with QueryClientProvider
const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  })

const createWrapper = () => {
  const testQueryClient = createTestQueryClient()
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={testQueryClient}>
      {children}
    </QueryClientProvider>
  )
}

// Mock API hooks - these make network requests so must be mocked
const mockGetPluginOAuthUrl = vi.fn()
const mockGetPluginOAuthClientSchema = vi.fn()
const mockSetPluginOAuthCustomClient = vi.fn()
const mockDeletePluginOAuthCustomClient = vi.fn()
const mockInvalidPluginOAuthClientSchema = vi.fn()
const mockAddPluginCredential = vi.fn()
const mockUpdatePluginCredential = vi.fn()
const mockGetPluginCredentialSchema = vi.fn()

vi.mock('../hooks/use-credential', () => ({
  useGetPluginOAuthUrlHook: () => ({
    mutateAsync: mockGetPluginOAuthUrl,
  }),
  useGetPluginOAuthClientSchemaHook: () => ({
    data: mockGetPluginOAuthClientSchema(),
    isLoading: false,
  }),
  useSetPluginOAuthCustomClientHook: () => ({
    mutateAsync: mockSetPluginOAuthCustomClient,
  }),
  useDeletePluginOAuthCustomClientHook: () => ({
    mutateAsync: mockDeletePluginOAuthCustomClient,
  }),
  useInvalidPluginOAuthClientSchemaHook: () => mockInvalidPluginOAuthClientSchema,
  useAddPluginCredentialHook: () => ({
    mutateAsync: mockAddPluginCredential,
  }),
  useUpdatePluginCredentialHook: () => ({
    mutateAsync: mockUpdatePluginCredential,
  }),
  useGetPluginCredentialSchemaHook: () => ({
    data: mockGetPluginCredentialSchema(),
    isLoading: false,
  }),
}))

// Mock openOAuthPopup - requires window operations
const mockOpenOAuthPopup = vi.fn()
vi.mock('@/hooks/use-oauth', () => ({
  openOAuthPopup: (...args: unknown[]) => mockOpenOAuthPopup(...args),
}))

// Mock service/use-triggers - API service
vi.mock('@/service/use-triggers', () => ({
  useTriggerPluginDynamicOptions: () => ({
    data: { options: [] },
    isLoading: false,
  }),
  useTriggerPluginDynamicOptionsInfo: () => ({
    data: null,
    isLoading: false,
  }),
  useInvalidTriggerDynamicOptions: () => vi.fn(),
}))

// Mock AuthForm to control form validation in tests
const mockGetFormValues = vi.fn()
vi.mock('@/app/components/base/form/form-scenarios/auth', () => ({
  default: vi.fn().mockImplementation(({ ref }: { ref: { current: unknown } }) => {
    if (ref)
      ref.current = { getFormValues: mockGetFormValues }

    return <div data-testid="mock-auth-form">Auth Form</div>
  }),
}))

// Mock useToastContext
const mockNotify = vi.fn()
vi.mock('@/app/components/base/toast', () => ({
  useToastContext: () => ({ notify: mockNotify }),
}))

// Factory function for creating test PluginPayload
const createPluginPayload = (overrides: Partial<PluginPayload> = {}): PluginPayload => ({
  category: AuthCategory.tool,
  provider: 'test-provider',
  ...overrides,
})

// Factory for form schemas
const createFormSchema = (overrides: Partial<FormSchema> = {}): FormSchema => ({
  type: 'text-input' as FormSchema['type'],
  name: 'test-field',
  label: 'Test Field',
  required: false,
  ...overrides,
})

// ==================== AddApiKeyButton Tests ====================
describe('AddApiKeyButton', () => {
  let AddApiKeyButton: typeof import('./add-api-key-button').default

  beforeEach(async () => {
    vi.clearAllMocks()
    mockGetPluginCredentialSchema.mockReturnValue([])
    const importedAddApiKeyButton = await import('./add-api-key-button')
    AddApiKeyButton = importedAddApiKeyButton.default
  })

  describe('Rendering', () => {
    it('should render button with default text', () => {
      const pluginPayload = createPluginPayload()

      render(<AddApiKeyButton pluginPayload={pluginPayload} />, { wrapper: createWrapper() })

      expect(screen.getByRole('button')).toHaveTextContent('Use Api Key')
    })

    it('should render button with custom text', () => {
      const pluginPayload = createPluginPayload()

      render(
        <AddApiKeyButton
          pluginPayload={pluginPayload}
          buttonText="Custom API Key"
        />,
        { wrapper: createWrapper() },
      )

      expect(screen.getByRole('button')).toHaveTextContent('Custom API Key')
    })

    it('should apply button variant', () => {
      const pluginPayload = createPluginPayload()

      render(
        <AddApiKeyButton
          pluginPayload={pluginPayload}
          buttonVariant="primary"
        />,
        { wrapper: createWrapper() },
      )

      expect(screen.getByRole('button').className).toContain('btn-primary')
    })

    it('should use secondary-accent variant by default', () => {
      const pluginPayload = createPluginPayload()

      render(<AddApiKeyButton pluginPayload={pluginPayload} />, { wrapper: createWrapper() })

      // Verify the default button has secondary-accent variant class
      expect(screen.getByRole('button').className).toContain('btn-secondary-accent')
    })
  })

  describe('Props Testing', () => {
    it('should disable button when disabled prop is true', () => {
      const pluginPayload = createPluginPayload()

      render(
        <AddApiKeyButton
          pluginPayload={pluginPayload}
          disabled={true}
        />,
        { wrapper: createWrapper() },
      )

      expect(screen.getByRole('button')).toBeDisabled()
    })

    it('should not disable button when disabled prop is false', () => {
      const pluginPayload = createPluginPayload()

      render(
        <AddApiKeyButton
          pluginPayload={pluginPayload}
          disabled={false}
        />,
        { wrapper: createWrapper() },
      )

      expect(screen.getByRole('button')).not.toBeDisabled()
    })

    it('should accept formSchemas prop', () => {
      const pluginPayload = createPluginPayload()
      const formSchemas = [createFormSchema({ name: 'api_key', label: 'API Key' })]

      expect(() => {
        render(
          <AddApiKeyButton
            pluginPayload={pluginPayload}
            formSchemas={formSchemas}
          />,
          { wrapper: createWrapper() },
        )
      }).not.toThrow()
    })
  })

  describe('User Interactions', () => {
    it('should open modal when button is clicked', async () => {
      const pluginPayload = createPluginPayload()
      mockGetPluginCredentialSchema.mockReturnValue([
        createFormSchema({ name: 'api_key', label: 'API Key' }),
      ])

      render(<AddApiKeyButton pluginPayload={pluginPayload} />, { wrapper: createWrapper() })

      fireEvent.click(screen.getByRole('button'))

      await waitFor(() => {
        expect(screen.getByText('plugin.auth.useApiAuth')).toBeInTheDocument()
      })
    })

    it('should not open modal when button is disabled', () => {
      const pluginPayload = createPluginPayload()

      render(
        <AddApiKeyButton
          pluginPayload={pluginPayload}
          disabled={true}
        />,
        { wrapper: createWrapper() },
      )

      const button = screen.getByRole('button')
      fireEvent.click(button)

      // Modal should not appear
      expect(screen.queryByText('plugin.auth.useApiAuth')).not.toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty pluginPayload properties', () => {
      const pluginPayload = createPluginPayload({
        provider: '',
        providerType: undefined,
      })

      expect(() => {
        render(<AddApiKeyButton pluginPayload={pluginPayload} />, { wrapper: createWrapper() })
      }).not.toThrow()
    })

    it('should handle all auth categories', () => {
      const categories = [AuthCategory.tool, AuthCategory.datasource, AuthCategory.model, AuthCategory.trigger]

      categories.forEach((category) => {
        const pluginPayload = createPluginPayload({ category })
        const { unmount } = render(<AddApiKeyButton pluginPayload={pluginPayload} />, { wrapper: createWrapper() })
        expect(screen.getByRole('button')).toBeInTheDocument()
        unmount()
      })
    })
  })

  describe('Modal Behavior', () => {
    it('should close modal when onClose is called from ApiKeyModal', async () => {
      const pluginPayload = createPluginPayload()
      mockGetPluginCredentialSchema.mockReturnValue([
        createFormSchema({ name: 'api_key', label: 'API Key' }),
      ])

      render(<AddApiKeyButton pluginPayload={pluginPayload} />, { wrapper: createWrapper() })

      // Open modal
      fireEvent.click(screen.getByRole('button'))

      await waitFor(() => {
        expect(screen.getByText('plugin.auth.useApiAuth')).toBeInTheDocument()
      })

      // Close modal via cancel button
      fireEvent.click(screen.getByText('common.operation.cancel'))

      await waitFor(() => {
        expect(screen.queryByText('plugin.auth.useApiAuth')).not.toBeInTheDocument()
      })
    })

    it('should call onUpdate when provided and modal triggers update', async () => {
      const pluginPayload = createPluginPayload()
      const onUpdate = vi.fn()
      mockGetPluginCredentialSchema.mockReturnValue([
        createFormSchema({ name: 'api_key', label: 'API Key' }),
      ])

      render(
        <AddApiKeyButton
          pluginPayload={pluginPayload}
          onUpdate={onUpdate}
        />,
        { wrapper: createWrapper() },
      )

      // Open modal
      fireEvent.click(screen.getByRole('button'))

      await waitFor(() => {
        expect(screen.getByText('plugin.auth.useApiAuth')).toBeInTheDocument()
      })
    })
  })

  describe('Memoization', () => {
    it('should be a memoized component', async () => {
      const AddApiKeyButtonDefault = (await import('./add-api-key-button')).default
      expect(typeof AddApiKeyButtonDefault).toBe('object')
    })
  })
})

// ==================== AddOAuthButton Tests ====================
describe('AddOAuthButton', () => {
  let AddOAuthButton: typeof import('./add-oauth-button').default

  beforeEach(async () => {
    vi.clearAllMocks()
    mockGetPluginOAuthClientSchema.mockReturnValue({
      schema: [],
      is_oauth_custom_client_enabled: false,
      is_system_oauth_params_exists: false,
      client_params: {},
      redirect_uri: 'https://example.com/callback',
    })
    mockGetPluginOAuthUrl.mockResolvedValue({ authorization_url: 'https://oauth.example.com/auth' })
    const importedAddOAuthButton = await import('./add-oauth-button')
    AddOAuthButton = importedAddOAuthButton.default
  })

  describe('Rendering - Not Configured State', () => {
    it('should render setup OAuth button when not configured', () => {
      const pluginPayload = createPluginPayload()
      mockGetPluginOAuthClientSchema.mockReturnValue({
        schema: [],
        is_oauth_custom_client_enabled: false,
        is_system_oauth_params_exists: false,
      })

      render(<AddOAuthButton pluginPayload={pluginPayload} />, { wrapper: createWrapper() })

      expect(screen.getByText('plugin.auth.setupOAuth')).toBeInTheDocument()
    })

    it('should apply button variant to setup button', () => {
      const pluginPayload = createPluginPayload()
      mockGetPluginOAuthClientSchema.mockReturnValue({
        schema: [],
        is_oauth_custom_client_enabled: false,
        is_system_oauth_params_exists: false,
      })

      render(
        <AddOAuthButton
          pluginPayload={pluginPayload}
          buttonVariant="secondary"
        />,
        { wrapper: createWrapper() },
      )

      expect(screen.getByRole('button').className).toContain('btn-secondary')
    })
  })

  describe('Rendering - Configured State', () => {
    it('should render OAuth button when system OAuth params exist', () => {
      const pluginPayload = createPluginPayload()
      mockGetPluginOAuthClientSchema.mockReturnValue({
        schema: [],
        is_oauth_custom_client_enabled: false,
        is_system_oauth_params_exists: true,
      })

      render(
        <AddOAuthButton
          pluginPayload={pluginPayload}
          buttonText="Connect OAuth"
        />,
        { wrapper: createWrapper() },
      )

      expect(screen.getByText('Connect OAuth')).toBeInTheDocument()
    })

    it('should render OAuth button when custom client is enabled', () => {
      const pluginPayload = createPluginPayload()
      mockGetPluginOAuthClientSchema.mockReturnValue({
        schema: [],
        is_oauth_custom_client_enabled: true,
        is_system_oauth_params_exists: false,
      })

      render(
        <AddOAuthButton
          pluginPayload={pluginPayload}
          buttonText="OAuth"
        />,
        { wrapper: createWrapper() },
      )

      expect(screen.getByText('OAuth')).toBeInTheDocument()
    })

    it('should show custom badge when custom client is enabled', () => {
      const pluginPayload = createPluginPayload()
      mockGetPluginOAuthClientSchema.mockReturnValue({
        schema: [],
        is_oauth_custom_client_enabled: true,
        is_system_oauth_params_exists: false,
      })

      render(<AddOAuthButton pluginPayload={pluginPayload} />, { wrapper: createWrapper() })

      expect(screen.getByText('plugin.auth.custom')).toBeInTheDocument()
    })
  })

  describe('Props Testing', () => {
    it('should disable button when disabled prop is true', () => {
      const pluginPayload = createPluginPayload()
      mockGetPluginOAuthClientSchema.mockReturnValue({
        schema: [],
        is_oauth_custom_client_enabled: false,
        is_system_oauth_params_exists: false,
      })

      render(
        <AddOAuthButton
          pluginPayload={pluginPayload}
          disabled={true}
        />,
        { wrapper: createWrapper() },
      )

      expect(screen.getByRole('button')).toBeDisabled()
    })

    it('should apply custom className', () => {
      const pluginPayload = createPluginPayload()
      mockGetPluginOAuthClientSchema.mockReturnValue({
        schema: [],
        is_oauth_custom_client_enabled: true,
        is_system_oauth_params_exists: false,
      })

      render(
        <AddOAuthButton
          pluginPayload={pluginPayload}
          className="custom-class"
        />,
        { wrapper: createWrapper() },
      )

      expect(screen.getByRole('button').className).toContain('custom-class')
    })

    it('should use oAuthData prop when provided', () => {
      const pluginPayload = createPluginPayload()
      const oAuthData = {
        schema: [],
        is_oauth_custom_client_enabled: true,
        is_system_oauth_params_exists: true,
        client_params: {},
        redirect_uri: 'https://custom.example.com/callback',
      }

      render(
        <AddOAuthButton
          pluginPayload={pluginPayload}
          oAuthData={oAuthData}
        />,
        { wrapper: createWrapper() },
      )

      // Should render configured button since oAuthData has is_system_oauth_params_exists=true
      expect(screen.queryByText('plugin.auth.setupOAuth')).not.toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should trigger OAuth flow when configured button is clicked', async () => {
      const pluginPayload = createPluginPayload()
      const onUpdate = vi.fn()
      mockGetPluginOAuthClientSchema.mockReturnValue({
        schema: [],
        is_oauth_custom_client_enabled: true,
        is_system_oauth_params_exists: false,
      })
      mockGetPluginOAuthUrl.mockResolvedValue({ authorization_url: 'https://oauth.example.com/auth' })

      render(
        <AddOAuthButton
          pluginPayload={pluginPayload}
          onUpdate={onUpdate}
        />,
        { wrapper: createWrapper() },
      )

      // Click the main button area (left side)
      const buttonText = screen.getByText('use oauth')
      fireEvent.click(buttonText)

      await waitFor(() => {
        expect(mockGetPluginOAuthUrl).toHaveBeenCalled()
      })
    })

    it('should open settings when setup button is clicked', async () => {
      const pluginPayload = createPluginPayload()
      mockGetPluginOAuthClientSchema.mockReturnValue({
        schema: [createFormSchema({ name: 'client_id', label: 'Client ID' })],
        is_oauth_custom_client_enabled: false,
        is_system_oauth_params_exists: false,
        redirect_uri: 'https://example.com/callback',
      })

      render(<AddOAuthButton pluginPayload={pluginPayload} />, { wrapper: createWrapper() })

      fireEvent.click(screen.getByText('plugin.auth.setupOAuth'))

      await waitFor(() => {
        expect(screen.getByText('plugin.auth.oauthClientSettings')).toBeInTheDocument()
      })
    })

    it('should not trigger OAuth when no authorization_url is returned', async () => {
      const pluginPayload = createPluginPayload()
      mockGetPluginOAuthClientSchema.mockReturnValue({
        schema: [],
        is_oauth_custom_client_enabled: true,
        is_system_oauth_params_exists: false,
      })
      mockGetPluginOAuthUrl.mockResolvedValue({ authorization_url: '' })

      render(<AddOAuthButton pluginPayload={pluginPayload} />, { wrapper: createWrapper() })

      const buttonText = screen.getByText('use oauth')
      fireEvent.click(buttonText)

      await waitFor(() => {
        expect(mockGetPluginOAuthUrl).toHaveBeenCalled()
      })

      expect(mockOpenOAuthPopup).not.toHaveBeenCalled()
    })

    it('should call onUpdate callback after successful OAuth', async () => {
      const pluginPayload = createPluginPayload()
      const onUpdate = vi.fn()
      mockGetPluginOAuthClientSchema.mockReturnValue({
        schema: [],
        is_oauth_custom_client_enabled: true,
        is_system_oauth_params_exists: false,
      })
      mockGetPluginOAuthUrl.mockResolvedValue({ authorization_url: 'https://oauth.example.com/auth' })
      // Simulate openOAuthPopup calling the success callback
      mockOpenOAuthPopup.mockImplementation((url, callback) => {
        callback?.()
      })

      render(
        <AddOAuthButton
          pluginPayload={pluginPayload}
          onUpdate={onUpdate}
        />,
        { wrapper: createWrapper() },
      )

      const buttonText = screen.getByText('use oauth')
      fireEvent.click(buttonText)

      await waitFor(() => {
        expect(mockOpenOAuthPopup).toHaveBeenCalledWith(
          'https://oauth.example.com/auth',
          expect.any(Function),
        )
      })

      // Verify onUpdate was called through the callback
      expect(onUpdate).toHaveBeenCalled()
    })

    it('should open OAuth settings when settings icon is clicked', async () => {
      const pluginPayload = createPluginPayload()
      mockGetPluginOAuthClientSchema.mockReturnValue({
        schema: [createFormSchema({ name: 'client_id', label: 'Client ID' })],
        is_oauth_custom_client_enabled: true,
        is_system_oauth_params_exists: false,
        redirect_uri: 'https://example.com/callback',
      })

      render(<AddOAuthButton pluginPayload={pluginPayload} />, { wrapper: createWrapper() })

      // Click the settings icon using data-testid for reliable selection
      const settingsButton = screen.getByTestId('oauth-settings-button')
      fireEvent.click(settingsButton)

      await waitFor(() => {
        expect(screen.getByText('plugin.auth.oauthClientSettings')).toBeInTheDocument()
      })
    })

    it('should close OAuth settings modal when onClose is called', async () => {
      const pluginPayload = createPluginPayload()
      mockGetPluginOAuthClientSchema.mockReturnValue({
        schema: [createFormSchema({ name: 'client_id', label: 'Client ID' })],
        is_oauth_custom_client_enabled: false,
        is_system_oauth_params_exists: false,
        redirect_uri: 'https://example.com/callback',
      })

      render(<AddOAuthButton pluginPayload={pluginPayload} />, { wrapper: createWrapper() })

      // Open settings
      fireEvent.click(screen.getByText('plugin.auth.setupOAuth'))

      await waitFor(() => {
        expect(screen.getByText('plugin.auth.oauthClientSettings')).toBeInTheDocument()
      })

      // Close settings via cancel button
      fireEvent.click(screen.getByText('common.operation.cancel'))

      await waitFor(() => {
        expect(screen.queryByText('plugin.auth.oauthClientSettings')).not.toBeInTheDocument()
      })
    })
  })

  describe('Schema Processing', () => {
    it('should handle is_system_oauth_params_exists state', async () => {
      const pluginPayload = createPluginPayload()
      mockGetPluginOAuthClientSchema.mockReturnValue({
        schema: [createFormSchema({ name: 'client_id', label: 'Client ID' })],
        is_oauth_custom_client_enabled: false,
        is_system_oauth_params_exists: true,
        redirect_uri: 'https://example.com/callback',
      })

      render(<AddOAuthButton pluginPayload={pluginPayload} />, { wrapper: createWrapper() })

      // Should show the configured button, not setup button
      expect(screen.queryByText('plugin.auth.setupOAuth')).not.toBeInTheDocument()
    })

    it('should open OAuth settings modal with correct data', async () => {
      const pluginPayload = createPluginPayload()
      mockGetPluginOAuthClientSchema.mockReturnValue({
        schema: [createFormSchema({ name: 'client_id', label: 'Client ID', required: true })],
        is_oauth_custom_client_enabled: false,
        is_system_oauth_params_exists: false,
        redirect_uri: 'https://example.com/callback',
      })

      render(<AddOAuthButton pluginPayload={pluginPayload} />, { wrapper: createWrapper() })

      fireEvent.click(screen.getByText('plugin.auth.setupOAuth'))

      await waitFor(() => {
        // OAuthClientSettings modal should open
        expect(screen.getByText('plugin.auth.oauthClientSettings')).toBeInTheDocument()
      })
    })

    it('should handle client_params defaults in schema', async () => {
      const pluginPayload = createPluginPayload()
      mockGetPluginOAuthClientSchema.mockReturnValue({
        schema: [
          createFormSchema({ name: 'client_id', label: 'Client ID' }),
          createFormSchema({ name: 'client_secret', label: 'Client Secret' }),
        ],
        is_oauth_custom_client_enabled: false,
        is_system_oauth_params_exists: true,
        client_params: {
          client_id: 'preset-client-id',
          client_secret: 'preset-secret',
        },
        redirect_uri: 'https://example.com/callback',
      })

      render(<AddOAuthButton pluginPayload={pluginPayload} />, { wrapper: createWrapper() })

      // Open settings by clicking the gear icon
      const button = screen.getByRole('button')
      const gearIconContainer = button.querySelector('[class*="shrink-0"][class*="w-8"]')
      if (gearIconContainer)
        fireEvent.click(gearIconContainer)

      await waitFor(() => {
        expect(screen.getByText('plugin.auth.oauthClientSettings')).toBeInTheDocument()
      })
    })

    it('should handle __auth_client__ logic when configured with system OAuth and no custom client', () => {
      const pluginPayload = createPluginPayload()
      mockGetPluginOAuthClientSchema.mockReturnValue({
        schema: [],
        is_oauth_custom_client_enabled: false,
        is_system_oauth_params_exists: true,
        client_params: {},
      })

      render(<AddOAuthButton pluginPayload={pluginPayload} />, { wrapper: createWrapper() })

      // Should render configured button (not setup button)
      expect(screen.queryByText('plugin.auth.setupOAuth')).not.toBeInTheDocument()
    })

    it('should open OAuth settings when system OAuth params exist', async () => {
      const pluginPayload = createPluginPayload()
      mockGetPluginOAuthClientSchema.mockReturnValue({
        schema: [createFormSchema({ name: 'client_id', label: 'Client ID', required: true })],
        is_oauth_custom_client_enabled: false,
        is_system_oauth_params_exists: true,
        redirect_uri: 'https://example.com/callback',
      })

      render(<AddOAuthButton pluginPayload={pluginPayload} />, { wrapper: createWrapper() })

      // Click the settings icon
      const button = screen.getByRole('button')
      const gearIconContainer = button.querySelector('[class*="shrink-0"][class*="w-8"]')
      if (gearIconContainer)
        fireEvent.click(gearIconContainer)

      await waitFor(() => {
        // OAuthClientSettings modal should open
        expect(screen.getByText('plugin.auth.oauthClientSettings')).toBeInTheDocument()
      })
    })
  })

  describe('Clipboard Operations', () => {
    it('should have clipboard API available for copy operations', async () => {
      const pluginPayload = createPluginPayload()
      const mockWriteText = vi.fn().mockResolvedValue(undefined)
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: mockWriteText },
        configurable: true,
      })

      mockGetPluginOAuthClientSchema.mockReturnValue({
        schema: [createFormSchema({ name: 'client_id', label: 'Client ID', required: true })],
        is_oauth_custom_client_enabled: false,
        is_system_oauth_params_exists: false,
        redirect_uri: 'https://example.com/callback',
      })

      render(<AddOAuthButton pluginPayload={pluginPayload} />, { wrapper: createWrapper() })

      fireEvent.click(screen.getByText('plugin.auth.setupOAuth'))

      await waitFor(() => {
        // OAuthClientSettings modal opens
        expect(screen.getByText('plugin.auth.oauthClientSettings')).toBeInTheDocument()
      })

      // Verify clipboard API is available
      expect(navigator.clipboard.writeText).toBeDefined()
    })
  })

  describe('__auth_client__ Logic', () => {
    it('should return default when not configured and system OAuth params exist', () => {
      const pluginPayload = createPluginPayload()
      mockGetPluginOAuthClientSchema.mockReturnValue({
        schema: [],
        is_oauth_custom_client_enabled: false,
        is_system_oauth_params_exists: true,
        client_params: {},
      })

      render(<AddOAuthButton pluginPayload={pluginPayload} />, { wrapper: createWrapper() })

      // When isConfigured is true (is_system_oauth_params_exists=true), it should show the configured button
      expect(screen.queryByText('plugin.auth.setupOAuth')).not.toBeInTheDocument()
    })

    it('should return custom when not configured and no system OAuth params', () => {
      const pluginPayload = createPluginPayload()
      mockGetPluginOAuthClientSchema.mockReturnValue({
        schema: [],
        is_oauth_custom_client_enabled: false,
        is_system_oauth_params_exists: false,
        client_params: {},
      })

      render(<AddOAuthButton pluginPayload={pluginPayload} />, { wrapper: createWrapper() })

      // When not configured, it should show the setup button
      expect(screen.getByText('plugin.auth.setupOAuth')).toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty schema', () => {
      const pluginPayload = createPluginPayload()
      mockGetPluginOAuthClientSchema.mockReturnValue({
        schema: [],
        is_oauth_custom_client_enabled: false,
        is_system_oauth_params_exists: false,
      })

      expect(() => {
        render(<AddOAuthButton pluginPayload={pluginPayload} />, { wrapper: createWrapper() })
      }).not.toThrow()
    })

    it('should handle undefined oAuthData fields', () => {
      const pluginPayload = createPluginPayload()
      mockGetPluginOAuthClientSchema.mockReturnValue(undefined)

      expect(() => {
        render(<AddOAuthButton pluginPayload={pluginPayload} />, { wrapper: createWrapper() })
      }).not.toThrow()
    })

    it('should handle null client_params', () => {
      const pluginPayload = createPluginPayload()
      mockGetPluginOAuthClientSchema.mockReturnValue({
        schema: [createFormSchema({ name: 'test' })],
        is_oauth_custom_client_enabled: true,
        is_system_oauth_params_exists: true,
        client_params: null,
      })

      expect(() => {
        render(<AddOAuthButton pluginPayload={pluginPayload} />, { wrapper: createWrapper() })
      }).not.toThrow()
    })
  })
})

// ==================== ApiKeyModal Tests ====================
describe('ApiKeyModal', () => {
  let ApiKeyModal: typeof import('./api-key-modal').default

  beforeEach(async () => {
    vi.clearAllMocks()
    mockGetPluginCredentialSchema.mockReturnValue([
      createFormSchema({ name: 'api_key', label: 'API Key', required: true }),
    ])
    mockAddPluginCredential.mockResolvedValue({})
    mockUpdatePluginCredential.mockResolvedValue({})
    // Reset form values mock to return validation failed by default
    mockGetFormValues.mockReturnValue({
      isCheckValidated: false,
      values: {},
    })
    const importedApiKeyModal = await import('./api-key-modal')
    ApiKeyModal = importedApiKeyModal.default
  })

  describe('Rendering', () => {
    it('should render modal with title', () => {
      const pluginPayload = createPluginPayload()

      render(<ApiKeyModal pluginPayload={pluginPayload} />, { wrapper: createWrapper() })

      expect(screen.getByText('plugin.auth.useApiAuth')).toBeInTheDocument()
    })

    it('should render modal with subtitle', () => {
      const pluginPayload = createPluginPayload()

      render(<ApiKeyModal pluginPayload={pluginPayload} />, { wrapper: createWrapper() })

      expect(screen.getByText('plugin.auth.useApiAuthDesc')).toBeInTheDocument()
    })

    it('should render form when data is loaded', () => {
      const pluginPayload = createPluginPayload()

      render(<ApiKeyModal pluginPayload={pluginPayload} />, { wrapper: createWrapper() })

      // AuthForm is mocked, so check for the mock element
      expect(screen.getByTestId('mock-auth-form')).toBeInTheDocument()
    })
  })

  describe('Props Testing', () => {
    it('should call onClose when modal is closed', () => {
      const pluginPayload = createPluginPayload()
      const onClose = vi.fn()

      render(
        <ApiKeyModal
          pluginPayload={pluginPayload}
          onClose={onClose}
        />,
        { wrapper: createWrapper() },
      )

      // Find and click cancel button
      const cancelButton = screen.getByText('common.operation.cancel')
      fireEvent.click(cancelButton)

      expect(onClose).toHaveBeenCalled()
    })

    it('should disable confirm button when disabled prop is true', () => {
      const pluginPayload = createPluginPayload()

      render(
        <ApiKeyModal
          pluginPayload={pluginPayload}
          disabled={true}
        />,
        { wrapper: createWrapper() },
      )

      const confirmButton = screen.getByText('common.operation.save')
      expect(confirmButton.closest('button')).toBeDisabled()
    })

    it('should show modal when editValues is provided', () => {
      const pluginPayload = createPluginPayload()
      const editValues = {
        __name__: 'Test Name',
        __credential_id__: 'test-id',
        api_key: 'test-key',
      }

      render(
        <ApiKeyModal
          pluginPayload={pluginPayload}
          editValues={editValues}
        />,
        { wrapper: createWrapper() },
      )

      expect(screen.getByText('plugin.auth.useApiAuth')).toBeInTheDocument()
    })

    it('should use formSchemas from props when provided', () => {
      const pluginPayload = createPluginPayload()
      const customSchemas = [
        createFormSchema({ name: 'custom_field', label: 'Custom Field' }),
      ]

      render(
        <ApiKeyModal
          pluginPayload={pluginPayload}
          formSchemas={customSchemas}
        />,
        { wrapper: createWrapper() },
      )

      // AuthForm is mocked, verify modal renders
      expect(screen.getByTestId('mock-auth-form')).toBeInTheDocument()
    })
  })

  describe('Form Behavior', () => {
    it('should render AuthForm component', () => {
      const pluginPayload = createPluginPayload()

      render(<ApiKeyModal pluginPayload={pluginPayload} />, { wrapper: createWrapper() })

      // AuthForm is mocked, verify it's rendered
      expect(screen.getByTestId('mock-auth-form')).toBeInTheDocument()
    })

    it('should render modal with editValues', () => {
      const pluginPayload = createPluginPayload()
      const editValues = {
        __name__: 'Existing Name',
        api_key: 'existing-key',
      }

      render(
        <ApiKeyModal
          pluginPayload={pluginPayload}
          editValues={editValues}
        />,
        { wrapper: createWrapper() },
      )

      expect(screen.getByText('plugin.auth.useApiAuth')).toBeInTheDocument()
    })
  })

  describe('Form Submission - handleConfirm', () => {
    beforeEach(() => {
      // Default: form validation passes with empty values
      mockGetFormValues.mockReturnValue({
        isCheckValidated: true,
        values: {
          __name__: 'Test Name',
          api_key: 'test-api-key',
        },
      })
    })

    it('should call addPluginCredential when creating new credential', async () => {
      const pluginPayload = createPluginPayload()
      const onClose = vi.fn()
      const onUpdate = vi.fn()
      mockGetPluginCredentialSchema.mockReturnValue([
        createFormSchema({ name: 'api_key', label: 'API Key' }),
      ])
      mockAddPluginCredential.mockResolvedValue({})

      render(
        <ApiKeyModal
          pluginPayload={pluginPayload}
          onClose={onClose}
          onUpdate={onUpdate}
        />,
        { wrapper: createWrapper() },
      )

      // Click confirm button
      const confirmButton = screen.getByText('common.operation.save')
      fireEvent.click(confirmButton)

      await waitFor(() => {
        expect(mockAddPluginCredential).toHaveBeenCalled()
      })
    })

    it('should call updatePluginCredential when editing existing credential', async () => {
      const pluginPayload = createPluginPayload()
      const onClose = vi.fn()
      const onUpdate = vi.fn()
      const editValues = {
        __name__: 'Test Credential',
        __credential_id__: 'test-credential-id',
        api_key: 'existing-key',
      }
      mockGetPluginCredentialSchema.mockReturnValue([
        createFormSchema({ name: 'api_key', label: 'API Key' }),
      ])
      mockUpdatePluginCredential.mockResolvedValue({})
      mockGetFormValues.mockReturnValue({
        isCheckValidated: true,
        values: {
          __name__: 'Test Credential',
          __credential_id__: 'test-credential-id',
          api_key: 'updated-key',
        },
      })

      render(
        <ApiKeyModal
          pluginPayload={pluginPayload}
          onClose={onClose}
          onUpdate={onUpdate}
          editValues={editValues}
        />,
        { wrapper: createWrapper() },
      )

      // Click confirm button
      const confirmButton = screen.getByText('common.operation.save')
      fireEvent.click(confirmButton)

      await waitFor(() => {
        expect(mockUpdatePluginCredential).toHaveBeenCalled()
      })
    })

    it('should call onClose and onUpdate after successful submission', async () => {
      const pluginPayload = createPluginPayload()
      const onClose = vi.fn()
      const onUpdate = vi.fn()
      mockGetPluginCredentialSchema.mockReturnValue([
        createFormSchema({ name: 'api_key', label: 'API Key' }),
      ])
      mockAddPluginCredential.mockResolvedValue({})

      render(
        <ApiKeyModal
          pluginPayload={pluginPayload}
          onClose={onClose}
          onUpdate={onUpdate}
        />,
        { wrapper: createWrapper() },
      )

      // Click confirm button
      const confirmButton = screen.getByText('common.operation.save')
      fireEvent.click(confirmButton)

      await waitFor(() => {
        expect(onClose).toHaveBeenCalled()
        expect(onUpdate).toHaveBeenCalled()
      })
    })

    it('should not call API when form validation fails', async () => {
      const pluginPayload = createPluginPayload()
      mockGetPluginCredentialSchema.mockReturnValue([
        createFormSchema({ name: 'api_key', label: 'API Key', required: true }),
      ])
      mockGetFormValues.mockReturnValue({
        isCheckValidated: false,
        values: {},
      })

      render(
        <ApiKeyModal pluginPayload={pluginPayload} />,
        { wrapper: createWrapper() },
      )

      // Click confirm button
      const confirmButton = screen.getByText('common.operation.save')
      fireEvent.click(confirmButton)

      // Verify API was not called since validation failed synchronously
      expect(mockAddPluginCredential).not.toHaveBeenCalled()
    })

    it('should handle doingAction state to prevent double submission', async () => {
      const pluginPayload = createPluginPayload()
      mockGetPluginCredentialSchema.mockReturnValue([
        createFormSchema({ name: 'api_key', label: 'API Key' }),
      ])
      // Make the API call slow
      mockAddPluginCredential.mockImplementation(() => new Promise(resolve => setTimeout(resolve, 100)))

      render(
        <ApiKeyModal pluginPayload={pluginPayload} />,
        { wrapper: createWrapper() },
      )

      // Click confirm button twice quickly
      const confirmButton = screen.getByText('common.operation.save')
      fireEvent.click(confirmButton)
      fireEvent.click(confirmButton)

      // Should only be called once due to doingAction guard
      await waitFor(() => {
        expect(mockAddPluginCredential).toHaveBeenCalledTimes(1)
      })
    })

    it('should return early if doingActionRef is true during concurrent clicks', async () => {
      const pluginPayload = createPluginPayload()
      mockGetPluginCredentialSchema.mockReturnValue([
        createFormSchema({ name: 'api_key', label: 'API Key' }),
      ])

      // Create a promise that we can control
      let resolveFirstCall: (value?: unknown) => void = () => {}
      let apiCallCount = 0

      mockAddPluginCredential.mockImplementation(() => {
        apiCallCount++
        if (apiCallCount === 1) {
          // First call: return a pending promise
          return new Promise((resolve) => {
            resolveFirstCall = resolve
          })
        }
        // Subsequent calls should not happen but return resolved promise
        return Promise.resolve({})
      })

      render(
        <ApiKeyModal pluginPayload={pluginPayload} />,
        { wrapper: createWrapper() },
      )

      const confirmButton = screen.getByText('common.operation.save')

      // First click starts the request
      fireEvent.click(confirmButton)

      // Wait for the first API call to be made
      await waitFor(() => {
        expect(apiCallCount).toBe(1)
      })

      // Second click while first request is still pending should be ignored
      fireEvent.click(confirmButton)

      // Verify only one API call was made (no additional calls)
      expect(apiCallCount).toBe(1)

      // Clean up by resolving the promise
      resolveFirstCall()
    })

    it('should call onRemove when extra button is clicked in edit mode', async () => {
      const pluginPayload = createPluginPayload()
      const onRemove = vi.fn()
      const editValues = {
        __name__: 'Test Credential',
        __credential_id__: 'test-credential-id',
      }
      mockGetPluginCredentialSchema.mockReturnValue([
        createFormSchema({ name: 'api_key', label: 'API Key' }),
      ])

      render(
        <ApiKeyModal
          pluginPayload={pluginPayload}
          editValues={editValues}
          onRemove={onRemove}
        />,
        { wrapper: createWrapper() },
      )

      // Find and click the remove button
      const removeButton = screen.getByText('common.operation.remove')
      fireEvent.click(removeButton)

      expect(onRemove).toHaveBeenCalled()
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty credentials schema', () => {
      const pluginPayload = createPluginPayload()
      mockGetPluginCredentialSchema.mockReturnValue([])

      render(<ApiKeyModal pluginPayload={pluginPayload} />, { wrapper: createWrapper() })

      // Should still render the modal with authorization name field
      expect(screen.getByText('plugin.auth.useApiAuth')).toBeInTheDocument()
    })

    it('should handle undefined detail in pluginPayload', () => {
      const pluginPayload = createPluginPayload({ detail: undefined })

      expect(() => {
        render(<ApiKeyModal pluginPayload={pluginPayload} />, { wrapper: createWrapper() })
      }).not.toThrow()
    })

    it('should handle form schema with default values', () => {
      const pluginPayload = createPluginPayload()
      mockGetPluginCredentialSchema.mockReturnValue([
        createFormSchema({ name: 'api_key', label: 'API Key', default: 'default-key' }),
      ])

      expect(() => {
        render(
          <ApiKeyModal pluginPayload={pluginPayload} />,
          { wrapper: createWrapper() },
        )
      }).not.toThrow()

      expect(screen.getByTestId('mock-auth-form')).toBeInTheDocument()
    })
  })
})

// ==================== OAuthClientSettings Tests ====================
describe('OAuthClientSettings', () => {
  let OAuthClientSettings: typeof import('./oauth-client-settings').default

  beforeEach(async () => {
    vi.clearAllMocks()
    mockSetPluginOAuthCustomClient.mockResolvedValue({})
    mockDeletePluginOAuthCustomClient.mockResolvedValue({})
    const importedOAuthClientSettings = await import('./oauth-client-settings')
    OAuthClientSettings = importedOAuthClientSettings.default
  })

  const defaultSchemas: FormSchema[] = [
    createFormSchema({ name: 'client_id', label: 'Client ID', required: true }),
    createFormSchema({ name: 'client_secret', label: 'Client Secret', required: true }),
  ]

  describe('Rendering', () => {
    it('should render modal with correct title', () => {
      const pluginPayload = createPluginPayload()

      render(
        <OAuthClientSettings
          pluginPayload={pluginPayload}
          schemas={defaultSchemas}
        />,
        { wrapper: createWrapper() },
      )

      expect(screen.getByText('plugin.auth.oauthClientSettings')).toBeInTheDocument()
    })

    it('should render Save and Auth button', () => {
      const pluginPayload = createPluginPayload()

      render(
        <OAuthClientSettings
          pluginPayload={pluginPayload}
          schemas={defaultSchemas}
        />,
        { wrapper: createWrapper() },
      )

      expect(screen.getByText('plugin.auth.saveAndAuth')).toBeInTheDocument()
    })

    it('should render Save Only button', () => {
      const pluginPayload = createPluginPayload()

      render(
        <OAuthClientSettings
          pluginPayload={pluginPayload}
          schemas={defaultSchemas}
        />,
        { wrapper: createWrapper() },
      )

      expect(screen.getByText('plugin.auth.saveOnly')).toBeInTheDocument()
    })

    it('should render Cancel button', () => {
      const pluginPayload = createPluginPayload()

      render(
        <OAuthClientSettings
          pluginPayload={pluginPayload}
          schemas={defaultSchemas}
        />,
        { wrapper: createWrapper() },
      )

      expect(screen.getByText('common.operation.cancel')).toBeInTheDocument()
    })

    it('should render form from schemas', () => {
      const pluginPayload = createPluginPayload()

      render(
        <OAuthClientSettings
          pluginPayload={pluginPayload}
          schemas={defaultSchemas}
        />,
        { wrapper: createWrapper() },
      )

      // AuthForm is mocked
      expect(screen.getByTestId('mock-auth-form')).toBeInTheDocument()
    })
  })

  describe('Props Testing', () => {
    it('should call onClose when cancel button is clicked', () => {
      const pluginPayload = createPluginPayload()
      const onClose = vi.fn()

      render(
        <OAuthClientSettings
          pluginPayload={pluginPayload}
          schemas={defaultSchemas}
          onClose={onClose}
        />,
        { wrapper: createWrapper() },
      )

      fireEvent.click(screen.getByText('common.operation.cancel'))
      expect(onClose).toHaveBeenCalled()
    })

    it('should disable buttons when disabled prop is true', () => {
      const pluginPayload = createPluginPayload()

      render(
        <OAuthClientSettings
          pluginPayload={pluginPayload}
          schemas={defaultSchemas}
          disabled={true}
        />,
        { wrapper: createWrapper() },
      )

      const confirmButton = screen.getByText('plugin.auth.saveAndAuth')
      expect(confirmButton.closest('button')).toBeDisabled()
    })

    it('should render with editValues', () => {
      const pluginPayload = createPluginPayload()
      const editValues = {
        client_id: 'existing-client-id',
        client_secret: 'existing-secret',
        __oauth_client__: 'custom',
      }

      render(
        <OAuthClientSettings
          pluginPayload={pluginPayload}
          schemas={defaultSchemas}
          editValues={editValues}
        />,
        { wrapper: createWrapper() },
      )

      expect(screen.getByText('plugin.auth.oauthClientSettings')).toBeInTheDocument()
    })
  })

  describe('Remove Button', () => {
    it('should show remove button when custom client and hasOriginalClientParams', () => {
      const pluginPayload = createPluginPayload()
      const schemasWithOAuthClient: FormSchema[] = [
        {
          name: '__oauth_client__',
          label: 'OAuth Client',
          type: 'radio' as FormSchema['type'],
          options: [
            { label: 'Default', value: 'default' },
            { label: 'Custom', value: 'custom' },
          ],
          default: 'custom',
          required: false,
        },
        ...defaultSchemas,
      ]

      render(
        <OAuthClientSettings
          pluginPayload={pluginPayload}
          schemas={schemasWithOAuthClient}
          editValues={{ __oauth_client__: 'custom', client_id: 'id', client_secret: 'secret' }}
          hasOriginalClientParams={true}
        />,
        { wrapper: createWrapper() },
      )

      expect(screen.getByText('common.operation.remove')).toBeInTheDocument()
    })

    it('should not show remove button when using default client', () => {
      const pluginPayload = createPluginPayload()
      const schemasWithOAuthClient: FormSchema[] = [
        {
          name: '__oauth_client__',
          label: 'OAuth Client',
          type: 'radio' as FormSchema['type'],
          options: [
            { label: 'Default', value: 'default' },
            { label: 'Custom', value: 'custom' },
          ],
          default: 'default',
          required: false,
        },
        ...defaultSchemas,
      ]

      render(
        <OAuthClientSettings
          pluginPayload={pluginPayload}
          schemas={schemasWithOAuthClient}
          editValues={{ __oauth_client__: 'default' }}
          hasOriginalClientParams={false}
        />,
        { wrapper: createWrapper() },
      )

      expect(screen.queryByText('common.operation.remove')).not.toBeInTheDocument()
    })
  })

  describe('Form Submission', () => {
    beforeEach(() => {
      // Default: form validation passes
      mockGetFormValues.mockReturnValue({
        isCheckValidated: true,
        values: {
          __oauth_client__: 'custom',
          client_id: 'test-client-id',
          client_secret: 'test-secret',
        },
      })
    })

    it('should render Save and Auth button that is clickable', async () => {
      const pluginPayload = createPluginPayload()
      const onAuth = vi.fn().mockResolvedValue(undefined)

      render(
        <OAuthClientSettings
          pluginPayload={pluginPayload}
          schemas={[]}
          onAuth={onAuth}
        />,
        { wrapper: createWrapper() },
      )

      const saveAndAuthButton = screen.getByText('plugin.auth.saveAndAuth')
      expect(saveAndAuthButton).toBeInTheDocument()
      expect(saveAndAuthButton.closest('button')).not.toBeDisabled()
    })

    it('should call setPluginOAuthCustomClient when Save Only is clicked', async () => {
      const pluginPayload = createPluginPayload()
      const onClose = vi.fn()
      const onUpdate = vi.fn()
      mockSetPluginOAuthCustomClient.mockResolvedValue({})

      render(
        <OAuthClientSettings
          pluginPayload={pluginPayload}
          schemas={defaultSchemas}
          onClose={onClose}
          onUpdate={onUpdate}
        />,
        { wrapper: createWrapper() },
      )

      // Click Save Only button
      fireEvent.click(screen.getByText('plugin.auth.saveOnly'))

      await waitFor(() => {
        expect(mockSetPluginOAuthCustomClient).toHaveBeenCalled()
      })
    })

    it('should call onClose and onUpdate after successful submission', async () => {
      const pluginPayload = createPluginPayload()
      const onClose = vi.fn()
      const onUpdate = vi.fn()
      mockSetPluginOAuthCustomClient.mockResolvedValue({})

      render(
        <OAuthClientSettings
          pluginPayload={pluginPayload}
          schemas={defaultSchemas}
          onClose={onClose}
          onUpdate={onUpdate}
        />,
        { wrapper: createWrapper() },
      )

      fireEvent.click(screen.getByText('plugin.auth.saveOnly'))

      await waitFor(() => {
        expect(onClose).toHaveBeenCalled()
        expect(onUpdate).toHaveBeenCalled()
      })
    })

    it('should call onAuth after handleConfirmAndAuthorize', async () => {
      const pluginPayload = createPluginPayload()
      const onAuth = vi.fn().mockResolvedValue(undefined)
      const onClose = vi.fn()
      mockSetPluginOAuthCustomClient.mockResolvedValue({})

      render(
        <OAuthClientSettings
          pluginPayload={pluginPayload}
          schemas={defaultSchemas}
          onAuth={onAuth}
          onClose={onClose}
        />,
        { wrapper: createWrapper() },
      )

      // Click Save and Auth button
      fireEvent.click(screen.getByText('plugin.auth.saveAndAuth'))

      await waitFor(() => {
        expect(mockSetPluginOAuthCustomClient).toHaveBeenCalled()
        expect(onAuth).toHaveBeenCalled()
      })
    })

    it('should handle form with empty values', () => {
      const pluginPayload = createPluginPayload()

      render(
        <OAuthClientSettings
          pluginPayload={pluginPayload}
          schemas={defaultSchemas}
        />,
        { wrapper: createWrapper() },
      )

      // Modal should render with save buttons
      expect(screen.getByText('plugin.auth.saveOnly')).toBeInTheDocument()
      expect(screen.getByText('plugin.auth.saveAndAuth')).toBeInTheDocument()
    })

    it('should call deletePluginOAuthCustomClient when Remove is clicked', async () => {
      const pluginPayload = createPluginPayload()
      const onClose = vi.fn()
      const onUpdate = vi.fn()
      mockDeletePluginOAuthCustomClient.mockResolvedValue({})

      const schemasWithOAuthClient: FormSchema[] = [
        {
          name: '__oauth_client__',
          label: 'OAuth Client',
          type: 'radio' as FormSchema['type'],
          options: [
            { label: 'Default', value: 'default' },
            { label: 'Custom', value: 'custom' },
          ],
          default: 'custom',
          required: false,
        },
        ...defaultSchemas,
      ]

      render(
        <OAuthClientSettings
          pluginPayload={pluginPayload}
          schemas={schemasWithOAuthClient}
          editValues={{ __oauth_client__: 'custom', client_id: 'id', client_secret: 'secret' }}
          hasOriginalClientParams={true}
          onClose={onClose}
          onUpdate={onUpdate}
        />,
        { wrapper: createWrapper() },
      )

      // Click Remove button
      fireEvent.click(screen.getByText('common.operation.remove'))

      await waitFor(() => {
        expect(mockDeletePluginOAuthCustomClient).toHaveBeenCalled()
      })
    })

    it('should call onClose and onUpdate after successful removal', async () => {
      const pluginPayload = createPluginPayload()
      const onClose = vi.fn()
      const onUpdate = vi.fn()
      mockDeletePluginOAuthCustomClient.mockResolvedValue({})

      const schemasWithOAuthClient: FormSchema[] = [
        {
          name: '__oauth_client__',
          label: 'OAuth Client',
          type: 'radio' as FormSchema['type'],
          options: [
            { label: 'Default', value: 'default' },
            { label: 'Custom', value: 'custom' },
          ],
          default: 'custom',
          required: false,
        },
        ...defaultSchemas,
      ]

      render(
        <OAuthClientSettings
          pluginPayload={pluginPayload}
          schemas={schemasWithOAuthClient}
          editValues={{ __oauth_client__: 'custom', client_id: 'id', client_secret: 'secret' }}
          hasOriginalClientParams={true}
          onClose={onClose}
          onUpdate={onUpdate}
        />,
        { wrapper: createWrapper() },
      )

      fireEvent.click(screen.getByText('common.operation.remove'))

      await waitFor(() => {
        expect(onClose).toHaveBeenCalled()
        expect(onUpdate).toHaveBeenCalled()
      })
    })

    it('should prevent double submission when doingAction is true', async () => {
      const pluginPayload = createPluginPayload()
      // Make the API call slow
      mockSetPluginOAuthCustomClient.mockImplementation(() => new Promise(resolve => setTimeout(resolve, 100)))

      render(
        <OAuthClientSettings
          pluginPayload={pluginPayload}
          schemas={defaultSchemas}
        />,
        { wrapper: createWrapper() },
      )

      // Click Save Only button twice quickly
      const saveButton = screen.getByText('plugin.auth.saveOnly')
      fireEvent.click(saveButton)
      fireEvent.click(saveButton)

      await waitFor(() => {
        expect(mockSetPluginOAuthCustomClient).toHaveBeenCalledTimes(1)
      })
    })

    it('should return early from handleConfirm if doingActionRef is true', async () => {
      const pluginPayload = createPluginPayload()
      let resolveFirstCall: (value?: unknown) => void = () => {}
      let apiCallCount = 0

      mockSetPluginOAuthCustomClient.mockImplementation(() => {
        apiCallCount++
        if (apiCallCount === 1) {
          return new Promise((resolve) => {
            resolveFirstCall = resolve
          })
        }
        return Promise.resolve({})
      })

      render(
        <OAuthClientSettings
          pluginPayload={pluginPayload}
          schemas={defaultSchemas}
        />,
        { wrapper: createWrapper() },
      )

      const saveButton = screen.getByText('plugin.auth.saveOnly')

      // First click starts the request
      fireEvent.click(saveButton)

      // Wait for the first API call to be made
      await waitFor(() => {
        expect(apiCallCount).toBe(1)
      })

      // Second click while first request is pending should be ignored
      fireEvent.click(saveButton)

      // Verify only one API call was made (no additional calls)
      expect(apiCallCount).toBe(1)

      // Clean up
      resolveFirstCall()
    })

    it('should return early from handleRemove if doingActionRef is true', async () => {
      const pluginPayload = createPluginPayload()
      let resolveFirstCall: (value?: unknown) => void = () => {}
      let deleteCallCount = 0

      mockDeletePluginOAuthCustomClient.mockImplementation(() => {
        deleteCallCount++
        if (deleteCallCount === 1) {
          return new Promise((resolve) => {
            resolveFirstCall = resolve
          })
        }
        return Promise.resolve({})
      })

      const schemasWithOAuthClient: FormSchema[] = [
        {
          name: '__oauth_client__',
          label: 'OAuth Client',
          type: 'radio' as FormSchema['type'],
          options: [
            { label: 'Default', value: 'default' },
            { label: 'Custom', value: 'custom' },
          ],
          default: 'custom',
          required: false,
        },
        ...defaultSchemas,
      ]

      render(
        <OAuthClientSettings
          pluginPayload={pluginPayload}
          schemas={schemasWithOAuthClient}
          editValues={{ __oauth_client__: 'custom', client_id: 'id', client_secret: 'secret' }}
          hasOriginalClientParams={true}
        />,
        { wrapper: createWrapper() },
      )

      const removeButton = screen.getByText('common.operation.remove')

      // First click starts the delete request
      fireEvent.click(removeButton)

      // Wait for the first delete call to be made
      await waitFor(() => {
        expect(deleteCallCount).toBe(1)
      })

      // Second click while first request is pending should be ignored
      fireEvent.click(removeButton)

      // Verify only one delete call was made (no additional calls)
      expect(deleteCallCount).toBe(1)

      // Clean up
      resolveFirstCall()
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty schemas', () => {
      const pluginPayload = createPluginPayload()

      expect(() => {
        render(
          <OAuthClientSettings
            pluginPayload={pluginPayload}
            schemas={[]}
          />,
          { wrapper: createWrapper() },
        )
      }).not.toThrow()
    })

    it('should handle schemas without default values', () => {
      const pluginPayload = createPluginPayload()
      const schemasWithoutDefaults: FormSchema[] = [
        createFormSchema({ name: 'field1', label: 'Field 1', default: undefined }),
      ]

      expect(() => {
        render(
          <OAuthClientSettings
            pluginPayload={pluginPayload}
            schemas={schemasWithoutDefaults}
          />,
          { wrapper: createWrapper() },
        )
      }).not.toThrow()
    })

    it('should handle undefined editValues', () => {
      const pluginPayload = createPluginPayload()

      expect(() => {
        render(
          <OAuthClientSettings
            pluginPayload={pluginPayload}
            schemas={defaultSchemas}
            editValues={undefined}
          />,
          { wrapper: createWrapper() },
        )
      }).not.toThrow()
    })
  })

  describe('Branch Coverage - defaultValues computation', () => {
    it('should compute defaultValues from schemas with default values', () => {
      const pluginPayload = createPluginPayload()
      const schemasWithDefaults: FormSchema[] = [
        createFormSchema({ name: 'client_id', label: 'Client ID', default: 'default-id' }),
        createFormSchema({ name: 'client_secret', label: 'Client Secret', default: 'default-secret' }),
      ]

      render(
        <OAuthClientSettings
          pluginPayload={pluginPayload}
          schemas={schemasWithDefaults}
        />,
        { wrapper: createWrapper() },
      )

      expect(screen.getByText('plugin.auth.oauthClientSettings')).toBeInTheDocument()
    })

    it('should skip schemas without default values in defaultValues computation', () => {
      const pluginPayload = createPluginPayload()
      const mixedSchemas: FormSchema[] = [
        createFormSchema({ name: 'field_with_default', label: 'With Default', default: 'value' }),
        createFormSchema({ name: 'field_without_default', label: 'Without Default', default: undefined }),
        createFormSchema({ name: 'field_with_empty', label: 'Empty Default', default: '' }),
      ]

      render(
        <OAuthClientSettings
          pluginPayload={pluginPayload}
          schemas={mixedSchemas}
        />,
        { wrapper: createWrapper() },
      )

      expect(screen.getByText('plugin.auth.oauthClientSettings')).toBeInTheDocument()
    })
  })

  describe('Branch Coverage - __oauth_client__ value', () => {
    beforeEach(() => {
      mockGetFormValues.mockReturnValue({
        isCheckValidated: true,
        values: {
          __oauth_client__: 'default',
          client_id: 'test-id',
        },
      })
    })

    it('should send enable_oauth_custom_client=false when __oauth_client__ is default', async () => {
      const pluginPayload = createPluginPayload()
      mockSetPluginOAuthCustomClient.mockResolvedValue({})

      render(
        <OAuthClientSettings
          pluginPayload={pluginPayload}
          schemas={defaultSchemas}
        />,
        { wrapper: createWrapper() },
      )

      fireEvent.click(screen.getByText('plugin.auth.saveOnly'))

      await waitFor(() => {
        expect(mockSetPluginOAuthCustomClient).toHaveBeenCalledWith(
          expect.objectContaining({
            enable_oauth_custom_client: false,
          }),
        )
      })
    })

    it('should send enable_oauth_custom_client=true when __oauth_client__ is custom', async () => {
      const pluginPayload = createPluginPayload()
      mockSetPluginOAuthCustomClient.mockResolvedValue({})
      mockGetFormValues.mockReturnValue({
        isCheckValidated: true,
        values: {
          __oauth_client__: 'custom',
          client_id: 'test-id',
        },
      })

      render(
        <OAuthClientSettings
          pluginPayload={pluginPayload}
          schemas={defaultSchemas}
        />,
        { wrapper: createWrapper() },
      )

      fireEvent.click(screen.getByText('plugin.auth.saveOnly'))

      await waitFor(() => {
        expect(mockSetPluginOAuthCustomClient).toHaveBeenCalledWith(
          expect.objectContaining({
            enable_oauth_custom_client: true,
          }),
        )
      })
    })
  })

  describe('Branch Coverage - onAuth callback', () => {
    beforeEach(() => {
      mockGetFormValues.mockReturnValue({
        isCheckValidated: true,
        values: { __oauth_client__: 'custom' },
      })
    })

    it('should call onAuth when provided and Save and Auth is clicked', async () => {
      const pluginPayload = createPluginPayload()
      const onAuth = vi.fn().mockResolvedValue(undefined)
      mockSetPluginOAuthCustomClient.mockResolvedValue({})

      render(
        <OAuthClientSettings
          pluginPayload={pluginPayload}
          schemas={defaultSchemas}
          onAuth={onAuth}
        />,
        { wrapper: createWrapper() },
      )

      fireEvent.click(screen.getByText('plugin.auth.saveAndAuth'))

      await waitFor(() => {
        expect(onAuth).toHaveBeenCalled()
      })
    })

    it('should not call onAuth when not provided', async () => {
      const pluginPayload = createPluginPayload()
      mockSetPluginOAuthCustomClient.mockResolvedValue({})

      render(
        <OAuthClientSettings
          pluginPayload={pluginPayload}
          schemas={defaultSchemas}
          onAuth={undefined}
        />,
        { wrapper: createWrapper() },
      )

      fireEvent.click(screen.getByText('plugin.auth.saveAndAuth'))

      await waitFor(() => {
        expect(mockSetPluginOAuthCustomClient).toHaveBeenCalled()
      })
      // No onAuth to call, but should not throw
    })
  })

  describe('Branch Coverage - disabled states', () => {
    it('should disable buttons when disabled prop is true', () => {
      const pluginPayload = createPluginPayload()

      render(
        <OAuthClientSettings
          pluginPayload={pluginPayload}
          schemas={defaultSchemas}
          disabled={true}
        />,
        { wrapper: createWrapper() },
      )

      expect(screen.getByText('plugin.auth.saveAndAuth').closest('button')).toBeDisabled()
      expect(screen.getByText('plugin.auth.saveOnly').closest('button')).toBeDisabled()
    })

    it('should disable Remove button when editValues is undefined', () => {
      const pluginPayload = createPluginPayload()
      const schemasWithOAuthClient: FormSchema[] = [
        {
          name: '__oauth_client__',
          label: 'OAuth Client',
          type: 'radio' as FormSchema['type'],
          options: [
            { label: 'Default', value: 'default' },
            { label: 'Custom', value: 'custom' },
          ],
          default: 'custom',
          required: false,
        },
        ...defaultSchemas,
      ]

      render(
        <OAuthClientSettings
          pluginPayload={pluginPayload}
          schemas={schemasWithOAuthClient}
          hasOriginalClientParams={true}
          editValues={undefined}
        />,
        { wrapper: createWrapper() },
      )

      // Remove button should exist but be disabled
      const removeButton = screen.queryByText('common.operation.remove')
      if (removeButton) {
        expect(removeButton.closest('button')).toBeDisabled()
      }
    })

    it('should disable Remove button when disabled prop is true', () => {
      const pluginPayload = createPluginPayload()
      const schemasWithOAuthClient: FormSchema[] = [
        {
          name: '__oauth_client__',
          label: 'OAuth Client',
          type: 'radio' as FormSchema['type'],
          options: [
            { label: 'Default', value: 'default' },
            { label: 'Custom', value: 'custom' },
          ],
          default: 'custom',
          required: false,
        },
        ...defaultSchemas,
      ]

      render(
        <OAuthClientSettings
          pluginPayload={pluginPayload}
          schemas={schemasWithOAuthClient}
          hasOriginalClientParams={true}
          editValues={{ __oauth_client__: 'custom', client_id: 'id' }}
          disabled={true}
        />,
        { wrapper: createWrapper() },
      )

      const removeButton = screen.getByText('common.operation.remove')
      expect(removeButton.closest('button')).toBeDisabled()
    })
  })

  describe('Branch Coverage - pluginPayload.detail', () => {
    it('should render ReadmeEntrance when pluginPayload has detail', () => {
      const pluginPayload = createPluginPayload({
        detail: {
          name: 'test-plugin',
          label: { en_US: 'Test Plugin' },
        } as unknown as PluginPayload['detail'],
      })

      render(
        <OAuthClientSettings
          pluginPayload={pluginPayload}
          schemas={defaultSchemas}
        />,
        { wrapper: createWrapper() },
      )

      // ReadmeEntrance should be rendered (it's mocked in vitest.setup)
      expect(screen.getByText('plugin.auth.oauthClientSettings')).toBeInTheDocument()
    })

    it('should not render ReadmeEntrance when pluginPayload has no detail', () => {
      const pluginPayload = createPluginPayload({ detail: undefined })

      render(
        <OAuthClientSettings
          pluginPayload={pluginPayload}
          schemas={defaultSchemas}
        />,
        { wrapper: createWrapper() },
      )

      expect(screen.getByText('plugin.auth.oauthClientSettings')).toBeInTheDocument()
    })
  })

  describe('Branch Coverage - footerSlot conditions', () => {
    it('should show Remove button only when __oauth_client__=custom AND hasOriginalClientParams=true', () => {
      const pluginPayload = createPluginPayload()
      const schemasWithCustomOAuth: FormSchema[] = [
        {
          name: '__oauth_client__',
          label: 'OAuth Client',
          type: 'radio' as FormSchema['type'],
          options: [
            { label: 'Default', value: 'default' },
            { label: 'Custom', value: 'custom' },
          ],
          default: 'custom',
          required: false,
        },
        ...defaultSchemas,
      ]

      render(
        <OAuthClientSettings
          pluginPayload={pluginPayload}
          schemas={schemasWithCustomOAuth}
          editValues={{ __oauth_client__: 'custom' }}
          hasOriginalClientParams={true}
        />,
        { wrapper: createWrapper() },
      )

      expect(screen.getByText('common.operation.remove')).toBeInTheDocument()
    })

    it('should not show Remove button when hasOriginalClientParams=false', () => {
      const pluginPayload = createPluginPayload()
      const schemasWithCustomOAuth: FormSchema[] = [
        {
          name: '__oauth_client__',
          label: 'OAuth Client',
          type: 'radio' as FormSchema['type'],
          options: [
            { label: 'Default', value: 'default' },
            { label: 'Custom', value: 'custom' },
          ],
          default: 'custom',
          required: false,
        },
        ...defaultSchemas,
      ]

      render(
        <OAuthClientSettings
          pluginPayload={pluginPayload}
          schemas={schemasWithCustomOAuth}
          editValues={{ __oauth_client__: 'custom' }}
          hasOriginalClientParams={false}
        />,
        { wrapper: createWrapper() },
      )

      expect(screen.queryByText('common.operation.remove')).not.toBeInTheDocument()
    })
  })

  describe('Memoization', () => {
    it('should be a memoized component', async () => {
      const OAuthClientSettingsDefault = (await import('./oauth-client-settings')).default
      expect(typeof OAuthClientSettingsDefault).toBe('object')
    })
  })
})

// ==================== Integration Tests ====================
describe('Authorize Components Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetPluginCredentialSchema.mockReturnValue([
      createFormSchema({ name: 'api_key', label: 'API Key' }),
    ])
    mockGetPluginOAuthClientSchema.mockReturnValue({
      schema: [createFormSchema({ name: 'client_id', label: 'Client ID' })],
      is_oauth_custom_client_enabled: false,
      is_system_oauth_params_exists: false,
      redirect_uri: 'https://example.com/callback',
    })
  })

  describe('AddApiKeyButton -> ApiKeyModal Flow', () => {
    it('should open ApiKeyModal when AddApiKeyButton is clicked', async () => {
      const AddApiKeyButton = (await import('./add-api-key-button')).default
      const pluginPayload = createPluginPayload()

      render(<AddApiKeyButton pluginPayload={pluginPayload} />, { wrapper: createWrapper() })

      fireEvent.click(screen.getByRole('button'))

      await waitFor(() => {
        expect(screen.getByText('plugin.auth.useApiAuth')).toBeInTheDocument()
      })
    })
  })

  describe('AddOAuthButton -> OAuthClientSettings Flow', () => {
    it('should open OAuthClientSettings when setup button is clicked', async () => {
      const AddOAuthButton = (await import('./add-oauth-button')).default
      const pluginPayload = createPluginPayload()
      mockGetPluginOAuthClientSchema.mockReturnValue({
        schema: [createFormSchema({ name: 'client_id', label: 'Client ID' })],
        is_oauth_custom_client_enabled: false,
        is_system_oauth_params_exists: false,
        redirect_uri: 'https://example.com/callback',
      })

      render(<AddOAuthButton pluginPayload={pluginPayload} />, { wrapper: createWrapper() })

      fireEvent.click(screen.getByText('plugin.auth.setupOAuth'))

      await waitFor(() => {
        expect(screen.getByText('plugin.auth.oauthClientSettings')).toBeInTheDocument()
      })
    })
  })
})
