import type { TriggerSubscription } from '@/app/components/workflow/block-selector/types'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TriggerCredentialTypeEnum } from '@/app/components/workflow/block-selector/types'
import { SubscriptionSelectorEntry } from './selector-entry'

let mockSubscriptions: TriggerSubscription[] = []
const mockRefetch = vi.fn()

vi.mock('./use-subscription-list', () => ({
  useSubscriptionList: () => ({
    subscriptions: mockSubscriptions,
    isLoading: false,
    refetch: mockRefetch,
  }),
}))

vi.mock('../../store', () => ({
  usePluginStore: () => ({ detail: undefined }),
}))

vi.mock('@/service/use-triggers', () => ({
  useTriggerProviderInfo: () => ({ data: { supported_creation_methods: [] } }),
  useTriggerOAuthConfig: () => ({ data: undefined, refetch: vi.fn() }),
  useInitiateTriggerOAuth: () => ({ mutate: vi.fn() }),
  useDeleteTriggerSubscription: () => ({ mutate: vi.fn(), isPending: false }),
}))

vi.mock('@/app/components/base/toast', () => ({
  default: {
    notify: vi.fn(),
  },
}))

const createSubscription = (overrides: Partial<TriggerSubscription> = {}): TriggerSubscription => ({
  id: 'sub-1',
  name: 'Subscription One',
  provider: 'provider-1',
  credential_type: TriggerCredentialTypeEnum.ApiKey,
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
  it('should render empty state label when no selection and closed', () => {
    render(<SubscriptionSelectorEntry selectedId={undefined} onSelect={vi.fn()} />)

    expect(screen.getByText('pluginTrigger.subscription.noSubscriptionSelected')).toBeInTheDocument()
  })

  it('should render placeholder when open without selection', () => {
    render(<SubscriptionSelectorEntry selectedId={undefined} onSelect={vi.fn()} />)

    fireEvent.click(screen.getByRole('button'))

    expect(screen.getByText('pluginTrigger.subscription.selectPlaceholder')).toBeInTheDocument()
  })

  it('should show selected subscription name when id matches', () => {
    render(<SubscriptionSelectorEntry selectedId="sub-1" onSelect={vi.fn()} />)

    expect(screen.getByText('Subscription One')).toBeInTheDocument()
  })

  it('should show removed label when selected subscription is missing', () => {
    render(<SubscriptionSelectorEntry selectedId="missing" onSelect={vi.fn()} />)

    expect(screen.getByText('pluginTrigger.subscription.subscriptionRemoved')).toBeInTheDocument()
  })

  it('should call onSelect and close the list after selection', () => {
    const onSelect = vi.fn()

    render(<SubscriptionSelectorEntry selectedId={undefined} onSelect={onSelect} />)

    fireEvent.click(screen.getByRole('button'))
    fireEvent.click(screen.getByRole('button', { name: 'Subscription One' }))

    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'sub-1', name: 'Subscription One' }), expect.any(Function))
    expect(screen.queryByText('Subscription One')).not.toBeInTheDocument()
  })
})
