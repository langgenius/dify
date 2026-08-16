import type {
  TriggerOAuthConfig,
  TriggerProviderApiEntity,
  TriggerSubscription,
} from '@/app/components/workflow/block-selector/types'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SupportedCreationMethods } from '@/app/components/plugins/types'
import { CreateSubscriptionButton } from '../index'
import { CreateButtonType } from '../types'

const toastMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}))

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: toastMocks,
}))

vi.mock('../../../store', () => ({
  usePluginStore: (selector: (state: { detail: { provider: string } }) => unknown) =>
    selector({ detail: { provider: 'test-provider' } }),
}))

const mockSubscriptions: TriggerSubscription[] = []
vi.mock('../../use-subscription-list', () => ({
  useSubscriptionList: () => ({ subscriptions: mockSubscriptions }),
}))

let mockProviderInfo: TriggerProviderApiEntity | undefined
let mockOAuthConfig: TriggerOAuthConfig | undefined
const mockRefetchOAuthConfig = vi.fn()
const mockInitiateOAuth = vi.fn()

vi.mock('@/service/use-triggers', () => ({
  useTriggerProviderInfo: () => ({ data: mockProviderInfo }),
  useTriggerOAuthConfig: () => ({ data: mockOAuthConfig, refetch: mockRefetchOAuthConfig }),
  useInitiateTriggerOAuth: () => ({ mutate: mockInitiateOAuth }),
}))

const mockOpenOAuthPopup = vi.fn()
vi.mock('@/hooks/use-oauth', () => ({
  openOAuthPopup: (...args: unknown[]) => mockOpenOAuthPopup(...args),
}))

vi.mock('../common-modal', () => ({
  CommonCreateModal: ({
    open,
    createType,
    builder,
    onClose,
  }: {
    open: boolean
    createType: SupportedCreationMethods
    builder?: { id: string }
    onClose: () => void
  }) =>
    open ? (
      <div role="dialog" data-create-type={createType} data-builder-id={builder?.id}>
        <button onClick={onClose}>Close create modal</button>
      </div>
    ) : null,
}))

vi.mock('../oauth-client', () => ({
  OAuthClientSettingsModal: ({
    open,
    onOpenChange,
  }: {
    open: boolean
    onOpenChange: (open: boolean) => void
  }) =>
    open ? (
      <div role="dialog" aria-label="OAuth client settings">
        <button onClick={() => onOpenChange(false)}>Close OAuth settings</button>
      </div>
    ) : null,
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

    expect(await screen.findByRole('dialog')).toHaveAttribute(
      'data-create-type',
      SupportedCreationMethods.MANUAL,
    )
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

    expect(await screen.findByRole('dialog')).toHaveAttribute(
      'data-create-type',
      SupportedCreationMethods.APIKEY,
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

    expect(await screen.findByRole('dialog', { name: 'OAuth client settings' })).toBeInTheDocument()
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
    await user.click(await screen.findByRole('button', { name: 'Close OAuth settings' }))

    expect(mockRefetchOAuthConfig).toHaveBeenCalledTimes(1)
  })

  it('continues configured OAuth into the create modal', async () => {
    const user = userEvent.setup()
    mockProviderInfo = providerInfo([SupportedCreationMethods.OAUTH])
    mockOAuthConfig = oauthConfig(true)
    mockInitiateOAuth.mockImplementationOnce(
      (_provider: string, { onSuccess }: { onSuccess: (response: unknown) => void }) =>
        onSuccess({
          authorization_url: 'https://example.com/oauth',
          subscription_builder: { id: 'builder-1' },
        }),
    )
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

    expect(await screen.findByRole('dialog')).toHaveAttribute('data-builder-id', 'builder-1')
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
