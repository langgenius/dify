import type { TriggerSubscription } from '@/app/components/workflow/block-selector/types'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { TriggerCredentialType } from '@/app/components/workflow/block-selector/types'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { SubscriptionSelectorView } from '../selector-view'

let mockSubscriptions: TriggerSubscription[] = []
const mockRefetch = vi.fn()
const { mockDelete } = vi.hoisted(() => ({ mockDelete: vi.fn().mockResolvedValue({}) }))

vi.mock('../use-subscription-list', () => ({
  useSubscriptionList: () => ({ subscriptions: mockSubscriptions, refetch: mockRefetch }),
}))

vi.mock('@/service/use-triggers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/use-triggers')>()),
  useTriggerProviderInfo: () => ({ data: { supported_creation_methods: [] } }),
  useTriggerOAuthConfig: () => ({ data: undefined, refetch: vi.fn() }),
  useInitiateTriggerOAuth: () => ({ mutate: vi.fn() }),
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'workspaces.current.triggerProvider.bySubscriptionId.subscriptions.delete.post': mockDelete,
    }),
  }
})

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

describe('SubscriptionSelectorView', () => {
  it('should call onSelect when a subscription is clicked', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()

    render(<SubscriptionSelectorView onSelect={onSelect} />)

    expect(screen.getByText(/pluginTrigger\.subscription\.listNum/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Subscription One' }))

    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'sub-1', name: 'Subscription One' }),
    )
  })

  it('should omit header when there are no subscriptions', () => {
    mockSubscriptions = []

    render(<SubscriptionSelectorView />)

    expect(screen.queryByText(/pluginTrigger\.subscription\.listNum/)).not.toBeInTheDocument()
  })

  it('should request selection reset after confirming delete', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<SubscriptionSelectorView onSelect={onSelect} />)

    await user.click(screen.getByRole('button', { name: 'common.operation.delete' }))
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument()
    expect(onSelect).not.toHaveBeenCalled()

    await user.click(
      screen.getByRole('button', {
        name: /pluginTrigger\.subscription\.list\.item\.actions\.deleteConfirm\.confirm/,
      }),
    )

    await waitFor(() => expect(onSelect).toHaveBeenCalledWith({ id: '', name: '' }))
    expect(mockDelete).toHaveBeenCalledWith({ params: { subscription_id: 'sub-1' } })
  })

  it('should close delete confirm without selection reset on cancel', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<SubscriptionSelectorView onSelect={onSelect} />)

    await user.click(screen.getByRole('button', { name: 'common.operation.delete' }))
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument()
    expect(onSelect).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: /common\.operation\.cancel/ }))

    expect(onSelect).not.toHaveBeenCalled()
    expect(
      screen.queryByText(/pluginTrigger\.subscription\.list\.item\.actions\.deleteConfirm\.title/),
    ).not.toBeInTheDocument()
  })
})
