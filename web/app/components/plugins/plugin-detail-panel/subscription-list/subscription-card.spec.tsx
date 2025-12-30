import type { TriggerSubscription } from '@/app/components/workflow/block-selector/types'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TriggerCredentialTypeEnum } from '@/app/components/workflow/block-selector/types'
import SubscriptionCard from './subscription-card'

const mockRefetch = vi.fn()

vi.mock('./use-subscription-list', () => ({
  useSubscriptionList: () => ({ refetch: mockRefetch }),
}))

vi.mock('../../store', () => ({
  usePluginStore: () => ({
    detail: {
      id: 'detail-1',
      plugin_id: 'plugin-1',
      name: 'Plugin',
      plugin_unique_identifier: 'plugin-uid',
      provider: 'provider-1',
      declaration: { trigger: { subscription_constructor: { parameters: [], credentials_schema: [] } } },
    },
  }),
}))

vi.mock('@/service/use-triggers', () => ({
  useUpdateTriggerSubscription: () => ({ mutate: vi.fn(), isPending: false }),
  useVerifyTriggerSubscription: () => ({ mutate: vi.fn(), isPending: false }),
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
})

describe('SubscriptionCard', () => {
  it('should render subscription name and endpoint', () => {
    render(<SubscriptionCard data={createSubscription()} />)

    expect(screen.getByText('Subscription One')).toBeInTheDocument()
    expect(screen.getByText('https://example.com')).toBeInTheDocument()
  })

  it('should render used-by text when workflows are present', () => {
    render(<SubscriptionCard data={createSubscription({ workflows_in_use: 2 })} />)

    expect(screen.getByText(/pluginTrigger\.subscription\.list\.item\.usedByNum/)).toBeInTheDocument()
  })

  it('should open delete confirmation when delete action is clicked', () => {
    const { container } = render(<SubscriptionCard data={createSubscription()} />)

    const deleteButton = container.querySelector('.subscription-delete-btn')
    expect(deleteButton).toBeTruthy()

    if (deleteButton)
      fireEvent.click(deleteButton)

    expect(screen.getByText(/pluginTrigger\.subscription\.list\.item\.actions\.deleteConfirm\.title/)).toBeInTheDocument()
  })

  it('should open edit modal when edit action is clicked', () => {
    const { container } = render(<SubscriptionCard data={createSubscription()} />)

    const actionButtons = container.querySelectorAll('button')
    const editButton = actionButtons[0]

    fireEvent.click(editButton)

    expect(screen.getByText(/pluginTrigger\.subscription\.list\.item\.actions\.edit\.title/)).toBeInTheDocument()
  })
})
