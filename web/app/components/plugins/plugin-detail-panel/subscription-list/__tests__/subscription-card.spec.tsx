import type { TriggerSubscription } from '@/app/components/workflow/block-selector/types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { TriggerCredentialType } from '@/app/components/workflow/block-selector/types'
import SubscriptionCard from '../subscription-card'

const mockRefetch = vi.fn()

vi.mock('../use-subscription-list', () => ({
  useSubscriptionList: () => ({ refetch: mockRefetch }),
}))

vi.mock('@/service/use-triggers', () => ({
  useUpdateTriggerSubscription: () => ({ mutate: vi.fn(), isPending: false }),
  useVerifyTriggerSubscription: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteTriggerSubscription: () => ({ mutate: vi.fn(), isPending: false }),
}))

vi.mock('@/app/notifications', () => ({
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
})

describe('SubscriptionCard', () => {
  it('should render subscription name and endpoint', () => {
    render(<SubscriptionCard data={createSubscription()} />)

    expect(screen.getByText('Subscription One'))!.toBeInTheDocument()
    expect(screen.getByText('https://example.com'))!.toBeInTheDocument()
  })

  it('should render used-by text when workflows are present', () => {
    render(<SubscriptionCard data={createSubscription({ workflows_in_use: 2 })} />)

    expect(
      screen.getByText(/pluginTrigger\.subscription\.list\.item\.usedByNum/),
    )!.toBeInTheDocument()
  })

  it('should open delete confirmation when delete action is clicked', async () => {
    const user = userEvent.setup()
    render(<SubscriptionCard data={createSubscription()} />)

    await user.click(screen.getByRole('button', { name: 'common.operation.delete' }))

    expect(
      screen.getByText(/pluginTrigger\.subscription\.list\.item\.actions\.deleteConfirm\.title/),
    )!.toBeInTheDocument()
  })

  it('should open edit modal when edit action is clicked', async () => {
    const user = userEvent.setup()
    render(<SubscriptionCard data={createSubscription()} />)

    await user.click(screen.getByRole('button', { name: 'common.operation.edit' }))

    expect(
      screen.getByText(/pluginTrigger\.subscription\.list\.item\.actions\.edit\.title/),
    )!.toBeInTheDocument()
  })
})
