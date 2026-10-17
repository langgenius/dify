import type {
  TriggerOAuthConfig,
  TriggerProviderApiEntity,
  TriggerSubscription,
} from '@/app/components/workflow/block-selector/types'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SupportedCreationMethods } from '@/app/components/plugins/types'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { CreateSubscriptionButton } from '../index'
import { CreateButtonType } from '../types'

const toastMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}))

vi.mock('@/app/notifications', () => ({
  toast: toastMocks,
}))

vi.mock('../../../store', () => {
  const detail = {
    provider: 'test-provider',
    plugin_id: 'test/plugin',
    name: 'Test plugin',
    declaration: {
      trigger: {
        subscription_schema: [],
        subscription_constructor: { credentials_schema: [], parameters: [] },
      },
    },
  }
  return {
    usePluginStore: (selector: (state: { detail: typeof detail }) => unknown) =>
      selector({ detail }),
  }
})

const mockSubscriptions: TriggerSubscription[] = []
vi.mock('../../use-subscription-list', () => ({
  useSubscriptionList: () => ({ subscriptions: mockSubscriptions, refetch: vi.fn() }),
}))

let mockProviderInfo: TriggerProviderApiEntity | undefined
let mockOAuthConfig: TriggerOAuthConfig | undefined
const mockRefetchOAuthConfig = vi.fn()
const { mockInitiateOAuth, mockCreateBuilder, mockBuildSubscription } = vi.hoisted(() => ({
  mockInitiateOAuth: vi.fn(),
  mockCreateBuilder: vi.fn(),
  mockBuildSubscription: vi.fn(),
}))

vi.mock('@/service/use-triggers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/use-triggers')>()),
  useTriggerProviderInfo: () => ({ data: mockProviderInfo }),
  useTriggerOAuthConfig: () => ({ data: mockOAuthConfig, refetch: mockRefetchOAuthConfig }),
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'workspaces.current.triggerProvider.byProvider.subscriptions.oauth.authorize.get':
        mockInitiateOAuth,
      'workspaces.current.triggerProvider.byProvider.subscriptions.builder.create.post':
        mockCreateBuilder,
      'workspaces.current.triggerProvider.byProvider.subscriptions.builder.build.bySubscriptionBuilderId.post':
        mockBuildSubscription,
      'workspaces.current.triggerProvider.byProvider.subscriptions.builder.logs.bySubscriptionBuilderId.get':
        async () => ({ logs: [] }),
    }),
  }
})

const mockOpenOAuthPopup = vi.fn()
vi.mock('@/hooks/use-oauth', () => ({
  openOAuthPopup: (...args: unknown[]) => mockOpenOAuthPopup(...args),
}))

const providerInfo = (
  supported_creation_methods: SupportedCreationMethods[],
): TriggerProviderApiEntity =>
  ({
    name: 'test-provider',
    supported_creation_methods,
  }) as TriggerProviderApiEntity

const oauthConfig = (configured: boolean): TriggerOAuthConfig =>
  ({ configured, custom_configured: false, custom_enabled: false }) as TriggerOAuthConfig

describe('CreateSubscriptionButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSubscriptions.splice(0)
    mockProviderInfo = providerInfo([SupportedCreationMethods.MANUAL])
    mockOAuthConfig = undefined
    mockCreateBuilder.mockResolvedValue({
      subscription_builder: {
        id: 'new-builder',
        provider: 'test-provider',
        name: '',
        credentials: {},
        parameters: {},
        properties: {},
        endpoint: 'https://example.com/callback',
        workflows_in_use: 0,
      },
    })
    mockBuildSubscription.mockResolvedValue({})
  })

  it('does not render without a supported creation method', () => {
    mockProviderInfo = providerInfo([])

    const { container } = render(<CreateSubscriptionButton />)

    expect(container).toBeEmptyDOMElement()
  })

  it('opens the create modal directly for a single manual method', async () => {
    const user = userEvent.setup()
    render(<CreateSubscriptionButton />)

    await user.click(screen.getByRole('button', { name: /subscription\.createButton\.manual/ }))

    const dialog = await screen.findByRole('dialog', { name: 'pluginTrigger.modal.manual.title' })
    await waitFor(() =>
      expect(mockCreateBuilder).toHaveBeenCalledWith({
        params: { provider: 'test-provider' },
        body: { credential_type: 'unauthorized' },
      }),
    )
    expect(
      within(dialog).getByRole('textbox', { name: /subscriptionName.label/ }),
    ).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('uses the real select to choose among multiple methods', async () => {
    const user = userEvent.setup()
    mockProviderInfo = providerInfo([
      SupportedCreationMethods.MANUAL,
      SupportedCreationMethods.APIKEY,
    ])
    render(<CreateSubscriptionButton />)

    await user.click(screen.getByRole('button', { name: /subscription\.empty\.button/ }))
    const listbox = await screen.findByRole('listbox')
    await user.click(
      within(listbox).getByRole('option', {
        name: /subscription\.addType\.options\.apikey\.title/,
      }),
    )

    const dialog = await screen.findByRole('dialog', { name: 'pluginTrigger.modal.apiKey.title' })
    expect(
      within(dialog).getByRole('button', { name: 'pluginTrigger.modal.common.verify' }),
    ).toBeInTheDocument()
    await waitFor(() =>
      expect(mockCreateBuilder).toHaveBeenCalledWith({
        params: { provider: 'test-provider' },
        body: { credential_type: 'api-key' },
      }),
    )
  })

  it('opens OAuth settings when OAuth is not configured', async () => {
    const user = userEvent.setup()
    mockProviderInfo = providerInfo([SupportedCreationMethods.OAUTH])
    mockOAuthConfig = oauthConfig(false)
    render(<CreateSubscriptionButton />)

    await user.click(screen.getByRole('button', { name: /subscription\.createButton\.oauth/ }))
    const listbox = await screen.findByRole('listbox')
    await user.click(
      within(listbox).getByRole('option', {
        name: /subscription\.addType\.options\.oauth\.title/,
      }),
    )

    expect(
      await screen.findByRole('dialog', { name: 'pluginTrigger.modal.oauth.title' }),
    ).toBeInTheDocument()
  })

  it('refetches OAuth configuration when settings close', async () => {
    const user = userEvent.setup()
    mockProviderInfo = providerInfo([SupportedCreationMethods.OAUTH])
    mockOAuthConfig = oauthConfig(false)
    render(<CreateSubscriptionButton />)

    await user.click(screen.getByRole('button', { name: /subscription\.createButton\.oauth/ }))
    await user.click(
      screen.getByLabelText('pluginTrigger.subscription.addType.options.oauth.clientSettings'),
    )
    const settings = await screen.findByRole('dialog', { name: 'pluginTrigger.modal.oauth.title' })
    await user.click(within(settings).getByRole('button', { name: 'common.operation.cancel' }))

    expect(mockRefetchOAuthConfig).toHaveBeenCalledTimes(1)
  })

  it('continues configured OAuth into the create modal', async () => {
    const user = userEvent.setup()
    mockProviderInfo = providerInfo([SupportedCreationMethods.OAUTH])
    mockOAuthConfig = oauthConfig(true)
    mockInitiateOAuth.mockResolvedValueOnce({
      authorization_url: 'https://example.com/oauth',
      subscription_builder: {
        id: 'builder-1',
        provider: 'test-provider',
        name: '',
        credential_type: 'oauth2',
        credentials: {},
        endpoint: 'https://example.com/callback',
        parameters: {},
        properties: {},
      },
    })
    mockOpenOAuthPopup.mockImplementationOnce((_url: string, callback: (data: unknown) => void) =>
      callback({ success: true }),
    )
    render(<CreateSubscriptionButton />)

    await user.click(screen.getByRole('button', { name: /subscription\.createButton\.oauth/ }))
    await user.click(
      within(await screen.findByRole('listbox')).getByRole('option', {
        name: /subscription\.addType\.options\.oauth\.title/,
      }),
    )

    const dialog = await screen.findByRole('dialog', { name: 'pluginTrigger.modal.oauth.title' })
    await user.type(
      within(dialog).getByRole('textbox', { name: /subscriptionName.label/ }),
      'OAuth updates',
    )
    await user.click(
      within(dialog).getByRole('button', { name: 'pluginTrigger.modal.common.create' }),
    )
    await waitFor(() =>
      expect(mockBuildSubscription).toHaveBeenCalledWith({
        params: { provider: 'test-provider', subscription_builder_id: 'builder-1' },
        body: { name: 'OAuth updates' },
      }),
    )
    expect(toastMocks.success).toHaveBeenCalledTimes(1)
  })

  it('does not create more than ten subscriptions', async () => {
    const user = userEvent.setup()

    mockSubscriptions.push(
      ...Array.from({ length: 10 }, (_, index) => ({ id: `${index}` }) as TriggerSubscription),
    )
    render(<CreateSubscriptionButton buttonType={CreateButtonType.ICON_BUTTON} />)

    const createButton = screen.getByLabelText(/subscription\.createButton\.manual/)
    await user.click(createButton)
    createButton.focus()

    expect(createButton).toHaveAttribute('aria-disabled', 'true')
    expect(createButton).toHaveFocus()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
