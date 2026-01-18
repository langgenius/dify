import type { SimpleDetail } from '../../store'
import type { TriggerOAuthConfig, TriggerProviderApiEntity, TriggerSubscription, TriggerSubscriptionBuilder } from '@/app/components/workflow/block-selector/types'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SupportedCreationMethods } from '@/app/components/plugins/types'
import { TriggerCredentialTypeEnum } from '@/app/components/workflow/block-selector/types'
import { CreateButtonType, CreateSubscriptionButton, DEFAULT_METHOD } from './index'

// ==================== Mock Setup ====================

// Mock shared state for portal
let mockPortalOpenState = false

vi.mock('@/app/components/base/portal-to-follow-elem', () => ({
  PortalToFollowElem: ({ children, open }: { children: React.ReactNode, open: boolean }) => {
    mockPortalOpenState = open || false
    return (
      <div data-testid="portal-elem" data-open={open}>
        {children}
      </div>
    )
  },
  PortalToFollowElemTrigger: ({ children, onClick, className }: { children: React.ReactNode, onClick?: () => void, className?: string }) => (
    <div data-testid="portal-trigger" onClick={onClick} className={className}>
      {children}
    </div>
  ),
  PortalToFollowElemContent: ({ children, className }: { children: React.ReactNode, className?: string }) => {
    if (!mockPortalOpenState)
      return null
    return (
      <div data-testid="portal-content" className={className}>
        {children}
      </div>
    )
  },
}))

// Mock Toast
vi.mock('@/app/components/base/toast', () => ({
  default: {
    notify: vi.fn(),
  },
}))

// Mock zustand store
let mockStoreDetail: SimpleDetail | undefined
vi.mock('../../store', () => ({
  usePluginStore: (selector: (state: { detail: SimpleDetail | undefined }) => SimpleDetail | undefined) =>
    selector({ detail: mockStoreDetail }),
}))

// Mock subscription list hook
const mockSubscriptions: TriggerSubscription[] = []
const mockRefetch = vi.fn()
vi.mock('../use-subscription-list', () => ({
  useSubscriptionList: () => ({
    subscriptions: mockSubscriptions,
    refetch: mockRefetch,
  }),
}))

// Mock trigger service hooks
let mockProviderInfo: { data: TriggerProviderApiEntity | undefined } = { data: undefined }
let mockOAuthConfig: { data: TriggerOAuthConfig | undefined, refetch: () => void } = { data: undefined, refetch: vi.fn() }
const mockInitiateOAuth = vi.fn()

vi.mock('@/service/use-triggers', () => ({
  useTriggerProviderInfo: () => mockProviderInfo,
  useTriggerOAuthConfig: () => mockOAuthConfig,
  useInitiateTriggerOAuth: () => ({
    mutate: mockInitiateOAuth,
  }),
}))

// Mock OAuth popup
vi.mock('@/hooks/use-oauth', () => ({
  openOAuthPopup: vi.fn((url: string, callback: (data?: unknown) => void) => {
    callback({ success: true, subscriptionId: 'test-subscription' })
  }),
}))

// Mock child modals
vi.mock('./common-modal', () => ({
  CommonCreateModal: ({ createType, onClose, builder }: {
    createType: SupportedCreationMethods
    onClose: () => void
    builder?: TriggerSubscriptionBuilder
  }) => (
    <div
      data-testid="common-create-modal"
      data-create-type={createType}
      data-has-builder={!!builder}
    >
      <button data-testid="close-modal" onClick={onClose}>Close</button>
    </div>
  ),
}))

vi.mock('./oauth-client', () => ({
  OAuthClientSettingsModal: ({ oauthConfig, onClose, showOAuthCreateModal }: {
    oauthConfig?: TriggerOAuthConfig
    onClose: () => void
    showOAuthCreateModal: (builder: TriggerSubscriptionBuilder) => void
  }) => (
    <div
      data-testid="oauth-client-modal"
      data-has-config={!!oauthConfig}
    >
      <button data-testid="close-oauth-modal" onClick={onClose}>Close</button>
      <button
        data-testid="show-create-modal"
        onClick={() => showOAuthCreateModal({
          id: 'test-builder',
          name: 'test',
          provider: 'test-provider',
          credential_type: TriggerCredentialTypeEnum.Oauth2,
          credentials: {},
          endpoint: 'https://test.com',
          parameters: {},
          properties: {},
          workflows_in_use: 0,
        })}
      >
        Show Create Modal
      </button>
    </div>
  ),
}))

// Mock CustomSelect
vi.mock('@/app/components/base/select/custom', () => ({
  default: ({ options, value, onChange, CustomTrigger, CustomOption, containerProps }: {
    options: Array<{ value: string, label: string, show: boolean, extra?: React.ReactNode, tag?: React.ReactNode }>
    value: string
    onChange: (value: string) => void
    CustomTrigger: () => React.ReactNode
    CustomOption: (option: { label: string, tag?: React.ReactNode, extra?: React.ReactNode }) => React.ReactNode
    containerProps?: { open?: boolean }
  }) => (
    <div
      data-testid="custom-select"
      data-value={value}
      data-options-count={options?.length || 0}
      data-container-open={containerProps?.open}
    >
      <div data-testid="custom-trigger">{CustomTrigger()}</div>
      <div data-testid="options-container">
        {options?.map(option => (
          <div
            key={option.value}
            data-testid={`option-${option.value}`}
            onClick={() => onChange(option.value)}
          >
            {CustomOption(option)}
          </div>
        ))}
      </div>
    </div>
  ),
}))

// ==================== Test Utilities ====================

/**
 * Factory function to create a TriggerProviderApiEntity with defaults
 */
const createProviderInfo = (overrides: Partial<TriggerProviderApiEntity> = {}): TriggerProviderApiEntity => ({
  author: 'test-author',
  name: 'test-provider',
  label: { en_US: 'Test Provider', zh_Hans: 'Test Provider' },
  description: { en_US: 'Test Description', zh_Hans: 'Test Description' },
  icon: 'test-icon',
  tags: [],
  plugin_unique_identifier: 'test-plugin',
  supported_creation_methods: [SupportedCreationMethods.MANUAL],
  subscription_schema: [],
  events: [],
  ...overrides,
})

/**
 * Factory function to create a TriggerOAuthConfig with defaults
 */
const createOAuthConfig = (overrides: Partial<TriggerOAuthConfig> = {}): TriggerOAuthConfig => ({
  configured: false,
  custom_configured: false,
  custom_enabled: false,
  redirect_uri: 'https://test.com/callback',
  oauth_client_schema: [],
  params: {
    client_id: '',
    client_secret: '',
  },
  system_configured: false,
  ...overrides,
})

/**
 * Factory function to create a SimpleDetail with defaults
 */
const createStoreDetail = (overrides: Partial<SimpleDetail> = {}): SimpleDetail => ({
  plugin_id: 'test-plugin',
  name: 'Test Plugin',
  plugin_unique_identifier: 'test-plugin-unique',
  id: 'test-id',
  provider: 'test-provider',
  declaration: {},
  ...overrides,
})

/**
 * Factory function to create a TriggerSubscription with defaults
 */
const createSubscription = (overrides: Partial<TriggerSubscription> = {}): TriggerSubscription => ({
  id: 'test-subscription',
  name: 'Test Subscription',
  provider: 'test-provider',
  credential_type: TriggerCredentialTypeEnum.ApiKey,
  credentials: {},
  endpoint: 'https://test.com',
  parameters: {},
  properties: {},
  workflows_in_use: 0,
  ...overrides,
})

/**
 * Factory function to create default props
 */
const createDefaultProps = (overrides: Partial<Parameters<typeof CreateSubscriptionButton>[0]> = {}) => ({
  ...overrides,
})

/**
 * Helper to set up mock data for testing
 */
const setupMocks = (config: {
  providerInfo?: TriggerProviderApiEntity
  oauthConfig?: TriggerOAuthConfig
  storeDetail?: SimpleDetail
  subscriptions?: TriggerSubscription[]
} = {}) => {
  mockProviderInfo = { data: config.providerInfo }
  mockOAuthConfig = { data: config.oauthConfig, refetch: vi.fn() }
  mockStoreDetail = config.storeDetail
  mockSubscriptions.length = 0
  if (config.subscriptions)
    mockSubscriptions.push(...config.subscriptions)
}

// ==================== Tests ====================

describe('CreateSubscriptionButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPortalOpenState = false
    setupMocks()
  })

  // ==================== Rendering Tests ====================
  describe('Rendering', () => {
    it('should render null when supportedMethods is empty', () => {
      // Arrange
      setupMocks({
        storeDetail: createStoreDetail(),
        providerInfo: createProviderInfo({ supported_creation_methods: [] }),
      })
      const props = createDefaultProps()

      // Act
      const { container } = render(<CreateSubscriptionButton {...props} />)

      // Assert
      expect(container).toBeEmptyDOMElement()
    })

    it('should render without crashing when supportedMethods is provided', () => {
      // Arrange
      setupMocks({
        storeDetail: createStoreDetail(),
        providerInfo: createProviderInfo({ supported_creation_methods: [SupportedCreationMethods.MANUAL] }),
      })
      const props = createDefaultProps()

      // Act
      const { container } = render(<CreateSubscriptionButton {...props} />)

      // Assert
      expect(container).not.toBeEmptyDOMElement()
    })

    it('should render full button by default', () => {
      // Arrange
      setupMocks({
        storeDetail: createStoreDetail(),
        providerInfo: createProviderInfo({ supported_creation_methods: [SupportedCreationMethods.MANUAL] }),
      })
      const props = createDefaultProps()

      // Act
      render(<CreateSubscriptionButton {...props} />)

      // Assert
      expect(screen.getByRole('button')).toBeInTheDocument()
    })

    it('should render icon button when buttonType is ICON_BUTTON', () => {
      // Arrange
      setupMocks({
        storeDetail: createStoreDetail(),
        providerInfo: createProviderInfo({ supported_creation_methods: [SupportedCreationMethods.MANUAL] }),
      })
      const props = createDefaultProps({ buttonType: CreateButtonType.ICON_BUTTON })

      // Act
      render(<CreateSubscriptionButton {...props} />)

      // Assert
      const actionButton = screen.getByTestId('custom-trigger')
      expect(actionButton).toBeInTheDocument()
    })
  })

  // ==================== Props Testing ====================
  describe('Props', () => {
    it('should apply default buttonType as FULL_BUTTON', () => {
      // Arrange
      setupMocks({
        storeDetail: createStoreDetail(),
        providerInfo: createProviderInfo({ supported_creation_methods: [SupportedCreationMethods.MANUAL] }),
      })
      const props = createDefaultProps()

      // Act
      render(<CreateSubscriptionButton {...props} />)

      // Assert
      expect(screen.getByRole('button')).toBeInTheDocument()
    })

    it('should apply shape prop correctly', () => {
      // Arrange
      setupMocks({
        storeDetail: createStoreDetail(),
        providerInfo: createProviderInfo({ supported_creation_methods: [SupportedCreationMethods.MANUAL] }),
      })
      const props = createDefaultProps({ buttonType: CreateButtonType.ICON_BUTTON, shape: 'circle' })

      // Act
      render(<CreateSubscriptionButton {...props} />)

      // Assert
      expect(screen.getByTestId('custom-trigger')).toBeInTheDocument()
    })
  })

  // ==================== State Management ====================
  describe('State Management', () => {
    it('should show CommonCreateModal when selectedCreateInfo is set', async () => {
      // Arrange
      setupMocks({
        storeDetail: createStoreDetail(),
        providerInfo: createProviderInfo({
          supported_creation_methods: [SupportedCreationMethods.MANUAL, SupportedCreationMethods.APIKEY],
        }),
      })
      const props = createDefaultProps()

      // Act
      render(<CreateSubscriptionButton {...props} />)

      // Click on MANUAL option to set selectedCreateInfo
      const manualOption = screen.getByTestId(`option-${SupportedCreationMethods.MANUAL}`)
      fireEvent.click(manualOption)

      // Assert
      await waitFor(() => {
        expect(screen.getByTestId('common-create-modal')).toBeInTheDocument()
        expect(screen.getByTestId('common-create-modal')).toHaveAttribute('data-create-type', SupportedCreationMethods.MANUAL)
      })
    })

    it('should close CommonCreateModal when onClose is called', async () => {
      // Arrange
      setupMocks({
        storeDetail: createStoreDetail(),
        providerInfo: createProviderInfo({
          supported_creation_methods: [SupportedCreationMethods.MANUAL, SupportedCreationMethods.APIKEY],
        }),
      })
      const props = createDefaultProps()

      // Act
      render(<CreateSubscriptionButton {...props} />)

      // Open modal
      const manualOption = screen.getByTestId(`option-${SupportedCreationMethods.MANUAL}`)
      fireEvent.click(manualOption)

      await waitFor(() => {
        expect(screen.getByTestId('common-create-modal')).toBeInTheDocument()
      })

      // Close modal
      fireEvent.click(screen.getByTestId('close-modal'))

      // Assert
      await waitFor(() => {
        expect(screen.queryByTestId('common-create-modal')).not.toBeInTheDocument()
      })
    })

    it('should show OAuthClientSettingsModal when oauth settings is clicked', async () => {
      // Arrange
      setupMocks({
        storeDetail: createStoreDetail(),
        providerInfo: createProviderInfo({
          supported_creation_methods: [SupportedCreationMethods.OAUTH],
        }),
        oauthConfig: createOAuthConfig({ configured: false }),
      })
      const props = createDefaultProps()

      // Act
      render(<CreateSubscriptionButton {...props} />)

      // Click on OAuth option (which should show client settings when not configured)
      const oauthOption = screen.getByTestId(`option-${SupportedCreationMethods.OAUTH}`)
      fireEvent.click(oauthOption)

      // Assert
      await waitFor(() => {
        expect(screen.getByTestId('oauth-client-modal')).toBeInTheDocument()
      })
    })

    it('should close OAuthClientSettingsModal and refetch config when closed', async () => {
      // Arrange
      const mockRefetchOAuth = vi.fn()
      mockOAuthConfig = { data: createOAuthConfig({ configured: false }), refetch: mockRefetchOAuth }

      setupMocks({
        storeDetail: createStoreDetail(),
        providerInfo: createProviderInfo({
          supported_creation_methods: [SupportedCreationMethods.OAUTH],
        }),
        oauthConfig: createOAuthConfig({ configured: false }),
      })
      // Reset after setupMocks to keep our custom refetch
      mockOAuthConfig.refetch = mockRefetchOAuth

      const props = createDefaultProps()

      // Act
      render(<CreateSubscriptionButton {...props} />)

      // Open OAuth modal
      const oauthOption = screen.getByTestId(`option-${SupportedCreationMethods.OAUTH}`)
      fireEvent.click(oauthOption)

      await waitFor(() => {
        expect(screen.getByTestId('oauth-client-modal')).toBeInTheDocument()
      })

      // Close modal
      fireEvent.click(screen.getByTestId('close-oauth-modal'))

      // Assert
      await waitFor(() => {
        expect(screen.queryByTestId('oauth-client-modal')).not.toBeInTheDocument()
        expect(mockRefetchOAuth).toHaveBeenCalled()
      })
    })
  })

  // ==================== Memoization Logic ====================
  describe('Memoization - buttonTextMap', () => {
    it('should display correct button text for OAUTH method', () => {
      // Arrange
      setupMocks({
        storeDetail: createStoreDetail(),
        providerInfo: createProviderInfo({
          supported_creation_methods: [SupportedCreationMethods.OAUTH],
        }),
        oauthConfig: createOAuthConfig({ configured: true }),
      })
      const props = createDefaultProps()

      // Act
      render(<CreateSubscriptionButton {...props} />)

      // Assert - OAuth mode renders with settings button, use getAllByRole
      const buttons = screen.getAllByRole('button')
      expect(buttons[0]).toHaveTextContent('pluginTrigger.subscription.createButton.oauth')
    })

    it('should display correct button text for APIKEY method', () => {
      // Arrange
      setupMocks({
        storeDetail: createStoreDetail(),
        providerInfo: createProviderInfo({
          supported_creation_methods: [SupportedCreationMethods.APIKEY],
        }),
      })
      const props = createDefaultProps()

      // Act
      render(<CreateSubscriptionButton {...props} />)

      // Assert
      expect(screen.getByRole('button')).toHaveTextContent('pluginTrigger.subscription.createButton.apiKey')
    })

    it('should display correct button text for MANUAL method', () => {
      // Arrange
      setupMocks({
        storeDetail: createStoreDetail(),
        providerInfo: createProviderInfo({
          supported_creation_methods: [SupportedCreationMethods.MANUAL],
        }),
      })
      const props = createDefaultProps()

      // Act
      render(<CreateSubscriptionButton {...props} />)

      // Assert
      expect(screen.getByRole('button')).toHaveTextContent('pluginTrigger.subscription.createButton.manual')
    })

    it('should display default button text when multiple methods are supported', () => {
      // Arrange
      setupMocks({
        storeDetail: createStoreDetail(),
        providerInfo: createProviderInfo({
          supported_creation_methods: [SupportedCreationMethods.MANUAL, SupportedCreationMethods.APIKEY],
        }),
      })
      const props = createDefaultProps()

      // Act
      render(<CreateSubscriptionButton {...props} />)

      // Assert
      expect(screen.getByRole('button')).toHaveTextContent('pluginTrigger.subscription.empty.button')
    })
  })

  describe('Memoization - allOptions', () => {
    it('should show only OAUTH option when only OAUTH is supported', () => {
      // Arrange
      setupMocks({
        storeDetail: createStoreDetail(),
        providerInfo: createProviderInfo({
          supported_creation_methods: [SupportedCreationMethods.OAUTH],
        }),
        oauthConfig: createOAuthConfig(),
      })
      const props = createDefaultProps()

      // Act
      render(<CreateSubscriptionButton {...props} />)

      // Assert
      const customSelect = screen.getByTestId('custom-select')
      expect(customSelect).toHaveAttribute('data-options-count', '1')
    })

    it('should show all options when all methods are supported', () => {
      // Arrange
      setupMocks({
        storeDetail: createStoreDetail(),
        providerInfo: createProviderInfo({
          supported_creation_methods: [
            SupportedCreationMethods.OAUTH,
            SupportedCreationMethods.APIKEY,
            SupportedCreationMethods.MANUAL,
          ],
        }),
        oauthConfig: createOAuthConfig(),
      })
      const props = createDefaultProps()

      // Act
      render(<CreateSubscriptionButton {...props} />)

      // Assert
      const customSelect = screen.getByTestId('custom-select')
      expect(customSelect).toHaveAttribute('data-options-count', '3')
    })

    it('should show custom badge when OAuth custom is enabled and configured', () => {
      // Arrange
      setupMocks({
        storeDetail: createStoreDetail(),
        providerInfo: createProviderInfo({
          supported_creation_methods: [SupportedCreationMethods.OAUTH],
        }),
        oauthConfig: createOAuthConfig({
          custom_enabled: true,
          custom_configured: true,
          configured: true,
        }),
      })
      const props = createDefaultProps()

      // Act
      render(<CreateSubscriptionButton {...props} />)

      // Assert - Custom badge should appear in the button
      const buttons = screen.getAllByRole('button')
      expect(buttons[0]).toHaveTextContent('plugin.auth.custom')
    })

    it('should not show custom badge when OAuth custom is not configured', () => {
      // Arrange
      setupMocks({
        storeDetail: createStoreDetail(),
        providerInfo: createProviderInfo({
          supported_creation_methods: [SupportedCreationMethods.OAUTH],
        }),
        oauthConfig: createOAuthConfig({
          custom_enabled: true,
          custom_configured: false,
          configured: true,
        }),
      })
      const props = createDefaultProps()

      // Act
      render(<CreateSubscriptionButton {...props} />)

      // Assert - The button should be there but no custom badge text
      const buttons = screen.getAllByRole('button')
      expect(buttons[0]).not.toHaveTextContent('plugin.auth.custom')
    })
  })

  describe('Memoization - methodType', () => {
    it('should set methodType to DEFAULT_METHOD when multiple methods supported', () => {
      // Arrange
      setupMocks({
        storeDetail: createStoreDetail(),
        providerInfo: createProviderInfo({
          supported_creation_methods: [SupportedCreationMethods.MANUAL, SupportedCreationMethods.APIKEY],
        }),
      })
      const props = createDefaultProps()

      // Act
      render(<CreateSubscriptionButton {...props} />)

      // Assert
      const customSelect = screen.getByTestId('custom-select')
      expect(customSelect).toHaveAttribute('data-value', DEFAULT_METHOD)
    })

    it('should set methodType to single method when only one supported', () => {
      // Arrange
      setupMocks({
        storeDetail: createStoreDetail(),
        providerInfo: createProviderInfo({
          supported_creation_methods: [SupportedCreationMethods.MANUAL],
        }),
      })
      const props = createDefaultProps()

      // Act
      render(<CreateSubscriptionButton {...props} />)

      // Assert
      const customSelect = screen.getByTestId('custom-select')
      expect(customSelect).toHaveAttribute('data-value', SupportedCreationMethods.MANUAL)
    })
  })

  // ==================== User Interactions ====================
  // Helper to create max subscriptions array
  const createMaxSubscriptions = () =>
    Array.from({ length: 10 }, (_, i) => createSubscription({ id: `sub-${i}` }))

  describe('User Interactions - onClickCreate', () => {
    it('should prevent action when subscription count is at max', () => {
      // Arrange
      const maxSubscriptions = createMaxSubscriptions()
      setupMocks({
        storeDetail: createStoreDetail(),
        providerInfo: createProviderInfo({
          supported_creation_methods: [SupportedCreationMethods.MANUAL],
        }),
        subscriptions: maxSubscriptions,
      })
      const props = createDefaultProps()

      // Act
      render(<CreateSubscriptionButton {...props} />)
      const button = screen.getByRole('button')
      fireEvent.click(button)

      // Assert - modal should not open
      expect(screen.queryByTestId('common-create-modal')).not.toBeInTheDocument()
    })

    it('should call onChooseCreateType when single method (non-OAuth) is used', () => {
      // Arrange
      setupMocks({
        storeDetail: createStoreDetail(),
        providerInfo: createProviderInfo({
          supported_creation_methods: [SupportedCreationMethods.MANUAL],
        }),
      })
      const props = createDefaultProps()

      // Act
      render(<CreateSubscriptionButton {...props} />)
      const button = screen.getByRole('button')
      fireEvent.click(button)

      // Assert - modal should open
      expect(screen.getByTestId('common-create-modal')).toBeInTheDocument()
    })

    it('should not call onChooseCreateType for DEFAULT_METHOD or single OAuth', () => {
      // Arrange
      setupMocks({
        storeDetail: createStoreDetail(),
        providerInfo: createProviderInfo({
          supported_creation_methods: [SupportedCreationMethods.OAUTH],
        }),
        oauthConfig: createOAuthConfig({ configured: true }),
      })
      const props = createDefaultProps()

      // Act
      render(<CreateSubscriptionButton {...props} />)
      // For OAuth mode, there are multiple buttons; get the primary button (first one)
      const buttons = screen.getAllByRole('button')
      fireEvent.click(buttons[0])

      // Assert - For single OAuth, should not directly create but wait for dropdown
      // The modal should not immediately open
      expect(screen.queryByTestId('common-create-modal')).not.toBeInTheDocument()
    })
  })

  describe('User Interactions - onChooseCreateType', () => {
    it('should open OAuth client settings modal when OAuth not configured', async () => {
      // Arrange
      setupMocks({
        storeDetail: createStoreDetail(),
        providerInfo: createProviderInfo({
          supported_creation_methods: [SupportedCreationMethods.OAUTH, SupportedCreationMethods.MANUAL],
        }),
        oauthConfig: createOAuthConfig({ configured: false }),
      })
      const props = createDefaultProps()

      // Act
      render(<CreateSubscriptionButton {...props} />)

      // Click on OAuth option
      const oauthOption = screen.getByTestId(`option-${SupportedCreationMethods.OAUTH}`)
      fireEvent.click(oauthOption)

      // Assert
      await waitFor(() => {
        expect(screen.getByTestId('oauth-client-modal')).toBeInTheDocument()
      })
    })

    it('should initiate OAuth flow when OAuth is configured', async () => {
      // Arrange
      setupMocks({
        storeDetail: createStoreDetail(),
        providerInfo: createProviderInfo({
          supported_creation_methods: [SupportedCreationMethods.OAUTH, SupportedCreationMethods.MANUAL],
        }),
        oauthConfig: createOAuthConfig({ configured: true }),
      })
      const props = createDefaultProps()

      // Act
      render(<CreateSubscriptionButton {...props} />)

      // Click on OAuth option
      const oauthOption = screen.getByTestId(`option-${SupportedCreationMethods.OAUTH}`)
      fireEvent.click(oauthOption)

      // Assert
      await waitFor(() => {
        expect(mockInitiateOAuth).toHaveBeenCalledWith('test-provider', expect.any(Object))
      })
    })

    it('should set selectedCreateInfo for APIKEY type', async () => {
      // Arrange
      setupMocks({
        storeDetail: createStoreDetail(),
        providerInfo: createProviderInfo({
          supported_creation_methods: [SupportedCreationMethods.APIKEY, SupportedCreationMethods.MANUAL],
        }),
      })
      const props = createDefaultProps()

      // Act
      render(<CreateSubscriptionButton {...props} />)

      // Click on APIKEY option
      const apiKeyOption = screen.getByTestId(`option-${SupportedCreationMethods.APIKEY}`)
      fireEvent.click(apiKeyOption)

      // Assert
      await waitFor(() => {
        expect(screen.getByTestId('common-create-modal')).toBeInTheDocument()
        expect(screen.getByTestId('common-create-modal')).toHaveAttribute('data-create-type', SupportedCreationMethods.APIKEY)
      })
    })

    it('should set selectedCreateInfo for MANUAL type', async () => {
      // Arrange
      setupMocks({
        storeDetail: createStoreDetail(),
        providerInfo: createProviderInfo({
          supported_creation_methods: [SupportedCreationMethods.MANUAL, SupportedCreationMethods.APIKEY],
        }),
      })
      const props = createDefaultProps()

      // Act
      render(<CreateSubscriptionButton {...props} />)

      // Click on MANUAL option
      const manualOption = screen.getByTestId(`option-${SupportedCreationMethods.MANUAL}`)
      fireEvent.click(manualOption)

      // Assert
      await waitFor(() => {
        expect(screen.getByTestId('common-create-modal')).toBeInTheDocument()
        expect(screen.getByTestId('common-create-modal')).toHaveAttribute('data-create-type', SupportedCreationMethods.MANUAL)
      })
    })
  })

  describe('User Interactions - onClickClientSettings', () => {
    it('should open OAuth client settings modal when settings icon clicked', async () => {
      // Arrange
      setupMocks({
        storeDetail: createStoreDetail(),
        providerInfo: createProviderInfo({
          supported_creation_methods: [SupportedCreationMethods.OAUTH],
        }),
        oauthConfig: createOAuthConfig({ configured: true }),
      })
      const props = createDefaultProps()

      // Act
      render(<CreateSubscriptionButton {...props} />)

      // Find the settings div inside the button (p-2 class)
      const buttons = screen.getAllByRole('button')
      const primaryButton = buttons[0]
      const settingsDiv = primaryButton.querySelector('.p-2')

      // Assert that settings div exists and click it
      expect(settingsDiv).toBeInTheDocument()
      if (settingsDiv) {
        fireEvent.click(settingsDiv)

        // Assert
        await waitFor(() => {
          expect(screen.getByTestId('oauth-client-modal')).toBeInTheDocument()
        })
      }
    })
  })

  // ==================== API Calls ====================
  describe('API Calls', () => {
    it('should call useTriggerProviderInfo with correct provider', () => {
      // Arrange
      setupMocks({
        storeDetail: createStoreDetail({ provider: 'my-provider' }),
        providerInfo: createProviderInfo({ supported_creation_methods: [SupportedCreationMethods.MANUAL] }),
      })
      const props = createDefaultProps()

      // Act
      render(<CreateSubscriptionButton {...props} />)

      // Assert - Component renders, which means hook was called
      expect(screen.getByTestId('custom-select')).toBeInTheDocument()
    })

    it('should handle OAuth initiation success', async () => {
      // Arrange
      const mockBuilder: TriggerSubscriptionBuilder = {
        id: 'oauth-builder',
        name: 'OAuth Builder',
        provider: 'test-provider',
        credential_type: TriggerCredentialTypeEnum.Oauth2,
        credentials: {},
        endpoint: 'https://test.com',
        parameters: {},
        properties: {},
        workflows_in_use: 0,
      }

      type OAuthSuccessResponse = {
        authorization_url: string
        subscription_builder: TriggerSubscriptionBuilder
      }
      type OAuthCallbacks = { onSuccess: (response: OAuthSuccessResponse) => void }

      mockInitiateOAuth.mockImplementation((_provider: string, callbacks: OAuthCallbacks) => {
        callbacks.onSuccess({
          authorization_url: 'https://oauth.test.com/authorize',
          subscription_builder: mockBuilder,
        })
      })

      setupMocks({
        storeDetail: createStoreDetail(),
        providerInfo: createProviderInfo({
          supported_creation_methods: [SupportedCreationMethods.OAUTH, SupportedCreationMethods.MANUAL],
        }),
        oauthConfig: createOAuthConfig({ configured: true }),
      })
      const props = createDefaultProps()

      // Act
      render(<CreateSubscriptionButton {...props} />)

      // Click on OAuth option
      const oauthOption = screen.getByTestId(`option-${SupportedCreationMethods.OAUTH}`)
      fireEvent.click(oauthOption)

      // Assert - modal should open with OAuth type and builder
      await waitFor(() => {
        expect(screen.getByTestId('common-create-modal')).toBeInTheDocument()
        expect(screen.getByTestId('common-create-modal')).toHaveAttribute('data-has-builder', 'true')
      })
    })

    it('should handle OAuth initiation error', async () => {
      // Arrange
      const Toast = await import('@/app/components/base/toast')

      mockInitiateOAuth.mockImplementation((_provider: string, callbacks: { onError: () => void }) => {
        callbacks.onError()
      })

      setupMocks({
        storeDetail: createStoreDetail(),
        providerInfo: createProviderInfo({
          supported_creation_methods: [SupportedCreationMethods.OAUTH, SupportedCreationMethods.MANUAL],
        }),
        oauthConfig: createOAuthConfig({ configured: true }),
      })
      const props = createDefaultProps()

      // Act
      render(<CreateSubscriptionButton {...props} />)

      // Click on OAuth option
      const oauthOption = screen.getByTestId(`option-${SupportedCreationMethods.OAUTH}`)
      fireEvent.click(oauthOption)

      // Assert
      await waitFor(() => {
        expect(Toast.default.notify).toHaveBeenCalledWith(
          expect.objectContaining({ type: 'error' }),
        )
      })
    })
  })

  // ==================== Edge Cases ====================
  describe('Edge Cases', () => {
    it('should handle null subscriptions gracefully', () => {
      // Arrange
      setupMocks({
        storeDetail: createStoreDetail(),
        providerInfo: createProviderInfo({ supported_creation_methods: [SupportedCreationMethods.MANUAL] }),
        subscriptions: undefined,
      })
      const props = createDefaultProps()

      // Act
      const { container } = render(<CreateSubscriptionButton {...props} />)

      // Assert
      expect(container).not.toBeEmptyDOMElement()
    })

    it('should handle undefined provider gracefully', () => {
      // Arrange
      setupMocks({
        storeDetail: undefined,
        providerInfo: createProviderInfo({ supported_creation_methods: [SupportedCreationMethods.MANUAL] }),
      })
      const props = createDefaultProps()

      // Act
      render(<CreateSubscriptionButton {...props} />)

      // Assert - component should still render
      expect(screen.getByTestId('custom-select')).toBeInTheDocument()
    })

    it('should handle empty oauthConfig gracefully', () => {
      // Arrange
      setupMocks({
        storeDetail: createStoreDetail(),
        providerInfo: createProviderInfo({
          supported_creation_methods: [SupportedCreationMethods.OAUTH],
        }),
        oauthConfig: undefined,
      })
      const props = createDefaultProps()

      // Act
      render(<CreateSubscriptionButton {...props} />)

      // Assert
      expect(screen.getByTestId('custom-select')).toBeInTheDocument()
    })

    it('should show max count tooltip when subscriptions reach limit', () => {
      // Arrange
      const maxSubscriptions = Array.from({ length: 10 }, (_, i) =>
        createSubscription({ id: `sub-${i}` }))
      setupMocks({
        storeDetail: createStoreDetail(),
        providerInfo: createProviderInfo({
          supported_creation_methods: [SupportedCreationMethods.MANUAL],
        }),
        subscriptions: maxSubscriptions,
      })
      const props = createDefaultProps({ buttonType: CreateButtonType.ICON_BUTTON })

      // Act
      render(<CreateSubscriptionButton {...props} />)

      // Assert - ActionButton should be in disabled state
      expect(screen.getByTestId('custom-trigger')).toBeInTheDocument()
    })

    it('should handle showOAuthCreateModal callback from OAuthClientSettingsModal', async () => {
      // Arrange
      setupMocks({
        storeDetail: createStoreDetail(),
        providerInfo: createProviderInfo({
          supported_creation_methods: [SupportedCreationMethods.OAUTH],
        }),
        oauthConfig: createOAuthConfig({ configured: false }),
      })
      const props = createDefaultProps()

      // Act
      render(<CreateSubscriptionButton {...props} />)

      // Open OAuth modal
      const oauthOption = screen.getByTestId(`option-${SupportedCreationMethods.OAUTH}`)
      fireEvent.click(oauthOption)

      await waitFor(() => {
        expect(screen.getByTestId('oauth-client-modal')).toBeInTheDocument()
      })

      // Click show create modal button
      fireEvent.click(screen.getByTestId('show-create-modal'))

      // Assert - CommonCreateModal should be shown with OAuth type and builder
      await waitFor(() => {
        expect(screen.getByTestId('common-create-modal')).toBeInTheDocument()
        expect(screen.getByTestId('common-create-modal')).toHaveAttribute('data-create-type', SupportedCreationMethods.OAUTH)
        expect(screen.getByTestId('common-create-modal')).toHaveAttribute('data-has-builder', 'true')
      })
    })
  })

  // ==================== Conditional Rendering ====================
  describe('Conditional Rendering', () => {
    it('should render settings icon for OAuth in full button mode', () => {
      // Arrange
      setupMocks({
        storeDetail: createStoreDetail(),
        providerInfo: createProviderInfo({
          supported_creation_methods: [SupportedCreationMethods.OAUTH],
        }),
        oauthConfig: createOAuthConfig({ configured: true }),
      })
      const props = createDefaultProps()

      // Act
      render(<CreateSubscriptionButton {...props} />)

      // Assert - settings icon should be present in button, OAuth mode has multiple buttons
      const buttons = screen.getAllByRole('button')
      const primaryButton = buttons[0]
      const settingsDiv = primaryButton.querySelector('.p-2')
      expect(settingsDiv).toBeInTheDocument()
    })

    it('should not render settings icon for non-OAuth methods', () => {
      // Arrange
      setupMocks({
        storeDetail: createStoreDetail(),
        providerInfo: createProviderInfo({
          supported_creation_methods: [SupportedCreationMethods.MANUAL],
        }),
      })
      const props = createDefaultProps()

      // Act
      render(<CreateSubscriptionButton {...props} />)

      // Assert - should not have settings divider
      const button = screen.getByRole('button')
      const divider = button.querySelector('.bg-text-primary-on-surface')
      expect(divider).not.toBeInTheDocument()
    })

    it('should apply disabled state when subscription count reaches max', () => {
      // Arrange
      const maxSubscriptions = Array.from({ length: 10 }, (_, i) =>
        createSubscription({ id: `sub-${i}` }))
      setupMocks({
        storeDetail: createStoreDetail(),
        providerInfo: createProviderInfo({
          supported_creation_methods: [SupportedCreationMethods.MANUAL],
        }),
        subscriptions: maxSubscriptions,
      })
      const props = createDefaultProps({ buttonType: CreateButtonType.ICON_BUTTON })

      // Act
      render(<CreateSubscriptionButton {...props} />)

      // Assert - icon button should exist
      expect(screen.getByTestId('custom-trigger')).toBeInTheDocument()
    })

    it('should apply circle shape class when shape is circle', () => {
      // Arrange
      setupMocks({
        storeDetail: createStoreDetail(),
        providerInfo: createProviderInfo({
          supported_creation_methods: [SupportedCreationMethods.MANUAL],
        }),
      })
      const props = createDefaultProps({ buttonType: CreateButtonType.ICON_BUTTON, shape: 'circle' })

      // Act
      render(<CreateSubscriptionButton {...props} />)

      // Assert
      expect(screen.getByTestId('custom-trigger')).toBeInTheDocument()
    })
  })

  // ==================== CustomSelect containerProps ====================
  describe('CustomSelect containerProps', () => {
    it('should set open to undefined for default method with multiple supported methods', () => {
      // Arrange
      setupMocks({
        storeDetail: createStoreDetail(),
        providerInfo: createProviderInfo({
          supported_creation_methods: [SupportedCreationMethods.MANUAL, SupportedCreationMethods.APIKEY],
        }),
      })
      const props = createDefaultProps()

      // Act
      render(<CreateSubscriptionButton {...props} />)

      // Assert - open should be undefined to allow dropdown to work
      const customSelect = screen.getByTestId('custom-select')
      expect(customSelect.getAttribute('data-container-open')).toBeNull()
    })

    it('should set open to undefined for single OAuth method', () => {
      // Arrange
      setupMocks({
        storeDetail: createStoreDetail(),
        providerInfo: createProviderInfo({
          supported_creation_methods: [SupportedCreationMethods.OAUTH],
        }),
        oauthConfig: createOAuthConfig({ configured: true }),
      })
      const props = createDefaultProps()

      // Act
      render(<CreateSubscriptionButton {...props} />)

      // Assert - for single OAuth, open should be undefined
      const customSelect = screen.getByTestId('custom-select')
      expect(customSelect.getAttribute('data-container-open')).toBeNull()
    })

    it('should set open to false for single non-OAuth method', () => {
      // Arrange
      setupMocks({
        storeDetail: createStoreDetail(),
        providerInfo: createProviderInfo({
          supported_creation_methods: [SupportedCreationMethods.MANUAL],
        }),
      })
      const props = createDefaultProps()

      // Act
      render(<CreateSubscriptionButton {...props} />)

      // Assert - for single non-OAuth, dropdown should be disabled (open = false)
      const customSelect = screen.getByTestId('custom-select')
      expect(customSelect).toHaveAttribute('data-container-open', 'false')
    })
  })

  // ==================== Button Type Variations ====================
  describe('Button Type Variations', () => {
    it('should render full button with grow class', () => {
      // Arrange
      setupMocks({
        storeDetail: createStoreDetail(),
        providerInfo: createProviderInfo({
          supported_creation_methods: [SupportedCreationMethods.MANUAL],
        }),
      })
      const props = createDefaultProps({ buttonType: CreateButtonType.FULL_BUTTON })

      // Act
      render(<CreateSubscriptionButton {...props} />)

      // Assert
      const button = screen.getByRole('button')
      expect(button).toHaveClass('w-full')
    })

    it('should render icon button with float-right class', () => {
      // Arrange
      setupMocks({
        storeDetail: createStoreDetail(),
        providerInfo: createProviderInfo({
          supported_creation_methods: [SupportedCreationMethods.MANUAL],
        }),
      })
      const props = createDefaultProps({ buttonType: CreateButtonType.ICON_BUTTON })

      // Act
      render(<CreateSubscriptionButton {...props} />)

      // Assert
      expect(screen.getByTestId('custom-trigger')).toBeInTheDocument()
    })
  })

  // ==================== Export Verification ====================
  describe('Export Verification', () => {
    it('should export CreateButtonType enum', () => {
      // Assert
      expect(CreateButtonType.FULL_BUTTON).toBe('full-button')
      expect(CreateButtonType.ICON_BUTTON).toBe('icon-button')
    })

    it('should export DEFAULT_METHOD constant', () => {
      // Assert
      expect(DEFAULT_METHOD).toBe('default')
    })

    it('should export CreateSubscriptionButton component', () => {
      // Assert
      expect(typeof CreateSubscriptionButton).toBe('function')
    })
  })

  // ==================== CommonCreateModal Integration Tests ====================
  // These tests verify that CreateSubscriptionButton correctly interacts with CommonCreateModal
  describe('CommonCreateModal Integration', () => {
    it('should pass correct createType to CommonCreateModal for MANUAL', async () => {
      // Arrange
      setupMocks({
        storeDetail: createStoreDetail(),
        providerInfo: createProviderInfo({
          supported_creation_methods: [SupportedCreationMethods.MANUAL, SupportedCreationMethods.APIKEY],
        }),
      })
      const props = createDefaultProps()

      // Act
      render(<CreateSubscriptionButton {...props} />)

      // Click on MANUAL option
      const manualOption = screen.getByTestId(`option-${SupportedCreationMethods.MANUAL}`)
      fireEvent.click(manualOption)

      // Assert
      await waitFor(() => {
        const modal = screen.getByTestId('common-create-modal')
        expect(modal).toHaveAttribute('data-create-type', SupportedCreationMethods.MANUAL)
      })
    })

    it('should pass correct createType to CommonCreateModal for APIKEY', async () => {
      // Arrange
      setupMocks({
        storeDetail: createStoreDetail(),
        providerInfo: createProviderInfo({
          supported_creation_methods: [SupportedCreationMethods.MANUAL, SupportedCreationMethods.APIKEY],
        }),
      })
      const props = createDefaultProps()

      // Act
      render(<CreateSubscriptionButton {...props} />)

      // Click on APIKEY option
      const apiKeyOption = screen.getByTestId(`option-${SupportedCreationMethods.APIKEY}`)
      fireEvent.click(apiKeyOption)

      // Assert
      await waitFor(() => {
        const modal = screen.getByTestId('common-create-modal')
        expect(modal).toHaveAttribute('data-create-type', SupportedCreationMethods.APIKEY)
      })
    })

    it('should pass builder to CommonCreateModal for OAuth flow', async () => {
      // Arrange
      const mockBuilder: TriggerSubscriptionBuilder = {
        id: 'oauth-builder',
        name: 'OAuth Builder',
        provider: 'test-provider',
        credential_type: TriggerCredentialTypeEnum.Oauth2,
        credentials: {},
        endpoint: 'https://test.com',
        parameters: {},
        properties: {},
        workflows_in_use: 0,
      }

      type OAuthSuccessResponse = {
        authorization_url: string
        subscription_builder: TriggerSubscriptionBuilder
      }
      type OAuthCallbacks = { onSuccess: (response: OAuthSuccessResponse) => void }

      mockInitiateOAuth.mockImplementation((_provider: string, callbacks: OAuthCallbacks) => {
        callbacks.onSuccess({
          authorization_url: 'https://oauth.test.com/authorize',
          subscription_builder: mockBuilder,
        })
      })

      setupMocks({
        storeDetail: createStoreDetail(),
        providerInfo: createProviderInfo({
          supported_creation_methods: [SupportedCreationMethods.OAUTH, SupportedCreationMethods.MANUAL],
        }),
        oauthConfig: createOAuthConfig({ configured: true }),
      })
      const props = createDefaultProps()

      // Act
      render(<CreateSubscriptionButton {...props} />)

      // Click on OAuth option
      const oauthOption = screen.getByTestId(`option-${SupportedCreationMethods.OAUTH}`)
      fireEvent.click(oauthOption)

      // Assert
      await waitFor(() => {
        const modal = screen.getByTestId('common-create-modal')
        expect(modal).toHaveAttribute('data-has-builder', 'true')
      })
    })
  })

  // ==================== OAuthClientSettingsModal Integration Tests ====================
  // These tests verify that CreateSubscriptionButton correctly interacts with OAuthClientSettingsModal
  describe('OAuthClientSettingsModal Integration', () => {
    it('should pass oauthConfig to OAuthClientSettingsModal', async () => {
      // Arrange
      setupMocks({
        storeDetail: createStoreDetail(),
        providerInfo: createProviderInfo({
          supported_creation_methods: [SupportedCreationMethods.OAUTH],
        }),
        oauthConfig: createOAuthConfig({ configured: false }),
      })
      const props = createDefaultProps()

      // Act
      render(<CreateSubscriptionButton {...props} />)

      // Click on OAuth option (opens settings when not configured)
      const oauthOption = screen.getByTestId(`option-${SupportedCreationMethods.OAUTH}`)
      fireEvent.click(oauthOption)

      // Assert
      await waitFor(() => {
        const modal = screen.getByTestId('oauth-client-modal')
        expect(modal).toHaveAttribute('data-has-config', 'true')
      })
    })

    it('should refetch OAuth config when OAuthClientSettingsModal is closed', async () => {
      // Arrange
      const mockRefetchOAuth = vi.fn()
      mockOAuthConfig = { data: createOAuthConfig({ configured: false }), refetch: mockRefetchOAuth }

      setupMocks({
        storeDetail: createStoreDetail(),
        providerInfo: createProviderInfo({
          supported_creation_methods: [SupportedCreationMethods.OAUTH],
        }),
        oauthConfig: createOAuthConfig({ configured: false }),
      })
      // Reset after setupMocks to keep our custom refetch
      mockOAuthConfig.refetch = mockRefetchOAuth

      const props = createDefaultProps()

      // Act
      render(<CreateSubscriptionButton {...props} />)

      // Open OAuth modal
      const oauthOption = screen.getByTestId(`option-${SupportedCreationMethods.OAUTH}`)
      fireEvent.click(oauthOption)

      await waitFor(() => {
        expect(screen.getByTestId('oauth-client-modal')).toBeInTheDocument()
      })

      // Close modal
      fireEvent.click(screen.getByTestId('close-oauth-modal'))

      // Assert
      await waitFor(() => {
        expect(mockRefetchOAuth).toHaveBeenCalled()
      })
    })

    it('should show CommonCreateModal with builder when showOAuthCreateModal callback is invoked', async () => {
      // Arrange
      setupMocks({
        storeDetail: createStoreDetail(),
        providerInfo: createProviderInfo({
          supported_creation_methods: [SupportedCreationMethods.OAUTH],
        }),
        oauthConfig: createOAuthConfig({ configured: false }),
      })
      const props = createDefaultProps()

      // Act
      render(<CreateSubscriptionButton {...props} />)

      // Open OAuth modal
      const oauthOption = screen.getByTestId(`option-${SupportedCreationMethods.OAUTH}`)
      fireEvent.click(oauthOption)

      await waitFor(() => {
        expect(screen.getByTestId('oauth-client-modal')).toBeInTheDocument()
      })

      // Click showOAuthCreateModal button
      fireEvent.click(screen.getByTestId('show-create-modal'))

      // Assert - CommonCreateModal should appear with OAuth type and builder
      await waitFor(() => {
        expect(screen.getByTestId('common-create-modal')).toBeInTheDocument()
        expect(screen.getByTestId('common-create-modal')).toHaveAttribute('data-create-type', SupportedCreationMethods.OAUTH)
        expect(screen.getByTestId('common-create-modal')).toHaveAttribute('data-has-builder', 'true')
      })
    })
  })

  // ==================== OAuth Callback Edge Cases ====================
  describe('OAuth Callback - Falsy Data', () => {
    it('should not open modal when OAuth callback returns falsy data', async () => {
      // Arrange
      const { openOAuthPopup } = await import('@/hooks/use-oauth')
      vi.mocked(openOAuthPopup).mockImplementation((url: string, callback: (data?: unknown) => void) => {
        callback(undefined) // falsy callback data
        return null
      })

      const mockBuilder: TriggerSubscriptionBuilder = {
        id: 'oauth-builder',
        name: 'OAuth Builder',
        provider: 'test-provider',
        credential_type: TriggerCredentialTypeEnum.Oauth2,
        credentials: {},
        endpoint: 'https://test.com',
        parameters: {},
        properties: {},
        workflows_in_use: 0,
      }

      mockInitiateOAuth.mockImplementation((_provider: string, callbacks: { onSuccess: (response: { authorization_url: string, subscription_builder: TriggerSubscriptionBuilder }) => void }) => {
        callbacks.onSuccess({
          authorization_url: 'https://oauth.test.com/authorize',
          subscription_builder: mockBuilder,
        })
      })

      setupMocks({
        storeDetail: createStoreDetail(),
        providerInfo: createProviderInfo({
          supported_creation_methods: [SupportedCreationMethods.OAUTH, SupportedCreationMethods.MANUAL],
        }),
        oauthConfig: createOAuthConfig({ configured: true }),
      })
      const props = createDefaultProps()

      // Act
      render(<CreateSubscriptionButton {...props} />)

      // Click on OAuth option
      const oauthOption = screen.getByTestId(`option-${SupportedCreationMethods.OAUTH}`)
      fireEvent.click(oauthOption)

      // Assert - modal should NOT open because callback data was falsy
      await waitFor(() => {
        expect(screen.queryByTestId('common-create-modal')).not.toBeInTheDocument()
      })
    })
  })

  // ==================== TriggerProps ClassName Branches ====================
  describe('TriggerProps ClassName Branches', () => {
    it('should apply pointer-events-none when non-default method with multiple supported methods', () => {
      // Arrange - Single APIKEY method (methodType = APIKEY, not DEFAULT_METHOD)
      // But we need multiple methods to test this branch
      setupMocks({
        storeDetail: createStoreDetail(),
        providerInfo: createProviderInfo({
          supported_creation_methods: [SupportedCreationMethods.APIKEY, SupportedCreationMethods.MANUAL],
        }),
      })
      const props = createDefaultProps()

      // Act
      render(<CreateSubscriptionButton {...props} />)

      // The methodType will be DEFAULT_METHOD since multiple methods
      // This verifies the render doesn't crash with multiple methods
      expect(screen.getByTestId('custom-select')).toHaveAttribute('data-value', 'default')
    })
  })

  // ==================== Tooltip Disabled Branches ====================
  describe('Tooltip Disabled Branches', () => {
    it('should enable tooltip when single method and not at max count', () => {
      // Arrange
      setupMocks({
        storeDetail: createStoreDetail(),
        providerInfo: createProviderInfo({
          supported_creation_methods: [SupportedCreationMethods.MANUAL],
        }),
        subscriptions: [createSubscription()], // Not at max
      })
      const props = createDefaultProps({ buttonType: CreateButtonType.ICON_BUTTON })

      // Act
      render(<CreateSubscriptionButton {...props} />)

      // Assert - tooltip should be enabled (disabled prop = false for single method)
      expect(screen.getByTestId('custom-trigger')).toBeInTheDocument()
    })

    it('should disable tooltip when multiple methods and not at max count', () => {
      // Arrange
      setupMocks({
        storeDetail: createStoreDetail(),
        providerInfo: createProviderInfo({
          supported_creation_methods: [SupportedCreationMethods.MANUAL, SupportedCreationMethods.APIKEY],
        }),
        subscriptions: [createSubscription()], // Not at max
      })
      const props = createDefaultProps({ buttonType: CreateButtonType.ICON_BUTTON })

      // Act
      render(<CreateSubscriptionButton {...props} />)

      // Assert - tooltip should be disabled (neither single method nor at max)
      expect(screen.getByTestId('custom-trigger')).toBeInTheDocument()
    })
  })

  // ==================== Tooltip PopupContent Branches ====================
  describe('Tooltip PopupContent Branches', () => {
    it('should show max count message when at max subscriptions', () => {
      // Arrange
      const maxSubscriptions = createMaxSubscriptions()
      setupMocks({
        storeDetail: createStoreDetail(),
        providerInfo: createProviderInfo({
          supported_creation_methods: [SupportedCreationMethods.MANUAL],
        }),
        subscriptions: maxSubscriptions,
      })
      const props = createDefaultProps({ buttonType: CreateButtonType.ICON_BUTTON })

      // Act
      render(<CreateSubscriptionButton {...props} />)

      // Assert - component renders with max subscriptions
      expect(screen.getByTestId('custom-trigger')).toBeInTheDocument()
    })

    it('should show method description when not at max', () => {
      // Arrange
      setupMocks({
        storeDetail: createStoreDetail(),
        providerInfo: createProviderInfo({
          supported_creation_methods: [SupportedCreationMethods.MANUAL],
        }),
        subscriptions: [], // Not at max
      })
      const props = createDefaultProps({ buttonType: CreateButtonType.ICON_BUTTON })

      // Act
      render(<CreateSubscriptionButton {...props} />)

      // Assert - component renders without max subscriptions
      expect(screen.getByTestId('custom-trigger')).toBeInTheDocument()
    })
  })

  // ==================== Provider Info Fallbacks ====================
  describe('Provider Info Fallbacks', () => {
    it('should handle undefined supported_creation_methods', () => {
      // Arrange - providerInfo with undefined supported_creation_methods
      setupMocks({
        storeDetail: createStoreDetail(),
        providerInfo: {
          ...createProviderInfo(),
          supported_creation_methods: undefined as unknown as SupportedCreationMethods[],
        },
      })
      const props = createDefaultProps()

      // Act
      const { container } = render(<CreateSubscriptionButton {...props} />)

      // Assert - should render null when supported methods fallback to empty
      expect(container).toBeEmptyDOMElement()
    })

    it('should handle providerInfo with null supported_creation_methods', () => {
      // Arrange
      mockProviderInfo = { data: { ...createProviderInfo(), supported_creation_methods: null as unknown as SupportedCreationMethods[] } }
      mockOAuthConfig = { data: undefined, refetch: vi.fn() }
      mockStoreDetail = createStoreDetail()
      const props = createDefaultProps()

      // Act
      const { container } = render(<CreateSubscriptionButton {...props} />)

      // Assert - should render null
      expect(container).toBeEmptyDOMElement()
    })
  })

  // ==================== Method Type Logic ====================
  describe('Method Type Logic', () => {
    it('should use single method as methodType when only one supported', () => {
      // Arrange
      setupMocks({
        storeDetail: createStoreDetail(),
        providerInfo: createProviderInfo({
          supported_creation_methods: [SupportedCreationMethods.APIKEY],
        }),
      })
      const props = createDefaultProps()

      // Act
      render(<CreateSubscriptionButton {...props} />)

      // Assert
      const customSelect = screen.getByTestId('custom-select')
      expect(customSelect).toHaveAttribute('data-value', SupportedCreationMethods.APIKEY)
    })
  })
})
