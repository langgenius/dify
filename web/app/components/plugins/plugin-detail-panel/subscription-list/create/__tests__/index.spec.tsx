import type { ReactElement } from 'react'
import type { TriggerSubscription } from '@/app/components/workflow/block-selector/types'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SupportedCreationMethods } from '@/app/components/plugins/types'
import { consoleQuery } from '@/service/console'
import { createHttpError } from '@/service/http-error'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import {
  createTriggerOAuthConfigResponseFixture,
  createTriggerProviderResponseFixture,
} from '@/test/console/trigger-plugins'
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

let mockProviderInfo: ReturnType<typeof createTriggerProviderResponseFixture> | undefined
let mockOAuthConfig: ReturnType<typeof createTriggerOAuthConfigResponseFixture> | undefined
const { mockInitiateOAuth, mockCreateBuilder, mockBuildSubscription, mockGetOAuthConfig } =
  vi.hoisted(() => ({
    mockGetOAuthConfig: vi.fn(),
    mockInitiateOAuth: vi.fn(),
    mockCreateBuilder: vi.fn(),
    mockBuildSubscription: vi.fn(),
  }))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses, withConsoleResponses } =
    await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.triggerProvider.byProvider.oauth.client.get': async () => {
        mockGetOAuthConfig()
        return mockOAuthConfig
      },
      'workspaces.current.triggerProvider.byProvider.subscriptions.builder.logs.bySubscriptionBuilderId.get':
        async () => ({ logs: [] }),
    }),
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'workspaces.current.triggerProvider.byProvider.subscriptions.oauth.authorize.get':
        mockInitiateOAuth,
      'workspaces.current.triggerProvider.byProvider.subscriptions.builder.create.post':
        mockCreateBuilder,
      'workspaces.current.triggerProvider.byProvider.subscriptions.builder.build.bySubscriptionBuilderId.post':
        mockBuildSubscription,
    }),
  }
})

const mockOpenOAuthPopup = vi.fn()
vi.mock('@/hooks/use-oauth', () => ({
  openOAuthPopup: (...args: unknown[]) => mockOpenOAuthPopup(...args),
}))

const providerInfo = (supported_creation_methods: SupportedCreationMethods[]) =>
  createTriggerProviderResponseFixture({
    name: 'test-provider',
    supported_creation_methods,
  })

const oauthConfig = (configured: boolean) => createTriggerOAuthConfigResponseFixture({ configured })

const render = (ui: ReactElement) => {
  const queryClient = createConsoleQueryClient()
  const input = { params: { provider: 'test-provider' } }
  if (mockProviderInfo) {
    queryClient.setQueryData(
      consoleQuery.workspaces.current.triggerProvider.byProvider.info.get.queryKey({ input }),
      mockProviderInfo,
    )
  }
  if (mockOAuthConfig) {
    queryClient.setQueryData(
      consoleQuery.workspaces.current.triggerProvider.byProvider.oauth.client.get.queryKey({
        input,
      }),
      mockOAuthConfig,
    )
  }
  return renderWithConsoleQuery(ui, { queryClient })
}

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

    await waitFor(() => expect(mockGetOAuthConfig).toHaveBeenCalledTimes(1))
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

  it.each([
    [
      'the translated reason',
      createHttpError(new Response(null, { status: 400 }), {
        code: 'paid_plan_required',
        message: 'Server says why',
      }),
      'requestErrors.code.paid_plan_required',
    ],
    [
      'the localized fallback',
      new TypeError('Failed to fetch'),
      'pluginTrigger.modal.oauth.authorization.authFailed',
    ],
  ])('reports %s when OAuth cannot start', async (_case, error, message) => {
    const user = userEvent.setup()
    mockProviderInfo = providerInfo([SupportedCreationMethods.OAUTH])
    mockOAuthConfig = oauthConfig(true)
    mockInitiateOAuth.mockRejectedValueOnce(error)
    render(<CreateSubscriptionButton />)

    await user.click(screen.getByRole('button', { name: /subscription\.createButton\.oauth/ }))
    await user.click(
      within(await screen.findByRole('listbox')).getByRole('option', {
        name: /subscription\.addType\.options\.oauth\.title/,
      }),
    )

    await waitFor(() => expect(toastMocks.error).toHaveBeenCalledExactlyOnceWith(message))
    expect(mockOpenOAuthPopup).not.toHaveBeenCalled()
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
