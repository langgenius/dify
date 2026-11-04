import type { TriggerSubscription } from '@/app/components/workflow/block-selector/types'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { TriggerCredentialType } from '@/app/components/workflow/block-selector/types'
import { SubscriptionSelectorEntry } from '../selector-entry'

let mockSubscriptions: TriggerSubscription[] = []
const mockRefetch = vi.fn()

vi.mock('../use-subscription-list', () => ({
  useSubscriptionList: () => ({
    subscriptions: mockSubscriptions,
    isLoading: false,
    refetch: mockRefetch,
  }),
}))

vi.mock('@/service/use-triggers', () => ({
  useTriggerProviderInfo: () => ({ data: { supported_creation_methods: [] } }),
  useTriggerOAuthConfig: () => ({ data: undefined, refetch: vi.fn() }),
  useInitiateTriggerOAuth: () => ({ mutate: vi.fn() }),
  useDeleteTriggerSubscription: () => ({ mutate: vi.fn(), isPending: false }),
}))

vi.mock('@/app/notifications', async (importOriginal) => ({
  ...(await importOriginal()),
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    dismiss: vi.fn(),
    update: vi.fn(),
    promise: vi.fn(),
  }),
}))

const createSubscription = (overrides: Partial<TriggerSubscription> = {}): TriggerSubscription => ({
  id: 'sub-1',
  name: 'Subscription One',
  provider: 'provider-1',
  credential_type: TriggerCredentialType.ApiKey,
  credentials: {},
  endpoint: 'https://example.com',
  parameters: {},
  properties: {},
  workflows_in_use: 0,
  ...overrides,
})

beforeEach(() => {
  vi.clearAllMocks()
  mockSubscriptions = [createSubscription()]
})

describe('SubscriptionSelectorEntry', () => {
  it('should show selected subscription name when id matches', () => {
    render(<SubscriptionSelectorEntry selectedId="sub-1" onSelect={vi.fn()} />)

    expect(screen.getByText('Subscription One')).toBeInTheDocument()
  })

  it('should show removed label when selected subscription is missing', () => {
    render(<SubscriptionSelectorEntry selectedId="missing" onSelect={vi.fn()} />)

    expect(screen.getByText('pluginTrigger.subscription.subscriptionRemoved')).toBeInTheDocument()
  })

  it('should call onSelect and close the list after selection', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()

    render(<SubscriptionSelectorEntry selectedId={undefined} onSelect={onSelect} />)

    await user.click(
      screen.getByRole('button', { name: 'pluginTrigger.subscription.noSubscriptionSelected' }),
    )
    expect(
      await screen.findByText('pluginTrigger.subscription.selectPlaceholder'),
    ).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Subscription One' }))

    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'sub-1', name: 'Subscription One' }),
      expect.any(Function),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})
