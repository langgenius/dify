import type { TriggerSubscription } from '@/app/components/workflow/block-selector/types'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TriggerCredentialTypeEnum } from '@/app/components/workflow/block-selector/types'
import { SubscriptionListView } from './list-view'

let mockSubscriptions: TriggerSubscription[] = []

vi.mock('./use-subscription-list', () => ({
  useSubscriptionList: () => ({ subscriptions: mockSubscriptions }),
}))

vi.mock('../../store', () => ({
  usePluginStore: () => ({ detail: undefined }),
}))

vi.mock('@/service/use-triggers', () => ({
  useTriggerProviderInfo: () => ({ data: { supported_creation_methods: [] } }),
  useTriggerOAuthConfig: () => ({ data: undefined, refetch: vi.fn() }),
  useInitiateTriggerOAuth: () => ({ mutate: vi.fn() }),
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
  mockSubscriptions = []
})

describe('SubscriptionListView', () => {
  it('should render subscription count and list when data exists', () => {
    mockSubscriptions = [createSubscription()]

    render(<SubscriptionListView />)

    expect(screen.getByText(/pluginTrigger\.subscription\.listNum/)).toBeInTheDocument()
    expect(screen.getByText('Subscription One')).toBeInTheDocument()
  })

  it('should omit count and list when subscriptions are empty', () => {
    render(<SubscriptionListView />)

    expect(screen.queryByText(/pluginTrigger\.subscription\.listNum/)).not.toBeInTheDocument()
    expect(screen.queryByText('Subscription One')).not.toBeInTheDocument()
  })

  it('should apply top border when showTopBorder is true', () => {
    const { container } = render(<SubscriptionListView showTopBorder />)

    const wrapper = container.firstChild as HTMLElement
    expect(wrapper).toHaveClass('border-t')
  })
})
