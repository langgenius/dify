import type { TriggerSubscription } from '@/app/components/workflow/block-selector/types'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Toast from '@/app/components/base/toast'
import { TriggerCredentialTypeEnum } from '@/app/components/workflow/block-selector/types'
import { SubscriptionSelectorView } from '../selector-view'

let mockSubscriptions: TriggerSubscription[] = []
const mockRefetch = vi.fn()
const mockDelete = vi.fn((_: string, options?: { onSuccess?: () => void }) => {
  options?.onSuccess?.()
})

vi.mock('../use-subscription-list', () => ({
  useSubscriptionList: () => ({ subscriptions: mockSubscriptions, refetch: mockRefetch }),
}))

vi.mock('../../../store', () => ({
  usePluginStore: () => ({ detail: undefined }),
}))

vi.mock('@/service/use-triggers', () => ({
  useTriggerProviderInfo: () => ({ data: { supported_creation_methods: [] } }),
  useTriggerOAuthConfig: () => ({ data: undefined, refetch: vi.fn() }),
  useInitiateTriggerOAuth: () => ({ mutate: vi.fn() }),
  useDeleteTriggerSubscription: () => ({ mutate: mockDelete, isPending: false }),
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
  vi.spyOn(Toast, 'notify').mockImplementation(() => ({ clear: vi.fn() }))
})

describe('SubscriptionSelectorView', () => {
  it('should render subscription list when data exists', () => {
    render(<SubscriptionSelectorView />)

    expect(screen.getByText(/pluginTrigger\.subscription\.listNum/)).toBeInTheDocument()
    expect(screen.getByText('Subscription One')).toBeInTheDocument()
  })

  it('should call onSelect when a subscription is clicked', () => {
    const onSelect = vi.fn()

    render(<SubscriptionSelectorView onSelect={onSelect} />)

    fireEvent.click(screen.getByRole('button', { name: 'Subscription One' }))

    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'sub-1', name: 'Subscription One' }))
  })

  it('should handle missing onSelect without crashing', () => {
    render(<SubscriptionSelectorView />)

    expect(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Subscription One' }))
    }).not.toThrow()
  })

  it('should distinguish selected vs unselected subscription row', () => {
    const { rerender } = render(<SubscriptionSelectorView selectedId="sub-1" />)

    const getRowClassName = () =>
      screen.getByRole('button', { name: 'Subscription One' }).closest('div')?.className ?? ''

    const selectedClassName = getRowClassName()

    rerender(<SubscriptionSelectorView selectedId="other-id" />)

    const unselectedClassName = getRowClassName()

    expect(selectedClassName).not.toBe(unselectedClassName)
  })

  it('should omit header when there are no subscriptions', () => {
    mockSubscriptions = []

    render(<SubscriptionSelectorView />)

    expect(screen.queryByText(/pluginTrigger\.subscription\.listNum/)).not.toBeInTheDocument()
  })

  it('should show delete confirm when delete action is clicked', () => {
    const { container } = render(<SubscriptionSelectorView />)

    const deleteButton = container.querySelector('.subscription-delete-btn') as HTMLElement
    expect(deleteButton).toBeTruthy()
    fireEvent.click(deleteButton)

    expect(screen.getByText(/pluginTrigger\.subscription\.list\.item\.actions\.deleteConfirm\.title/)).toBeInTheDocument()
  })

  it('should request selection reset after confirming delete', () => {
    const onSelect = vi.fn()
    const { container } = render(<SubscriptionSelectorView onSelect={onSelect} />)

    const deleteButton = container.querySelector('.subscription-delete-btn') as HTMLElement
    fireEvent.click(deleteButton)

    fireEvent.click(screen.getByRole('button', { name: /pluginTrigger\.subscription\.list\.item\.actions\.deleteConfirm\.confirm/ }))

    expect(mockDelete).toHaveBeenCalledWith('sub-1', expect.any(Object))
    expect(onSelect).toHaveBeenCalledWith({ id: '', name: '' })
  })

  it('should close delete confirm without selection reset on cancel', () => {
    const onSelect = vi.fn()
    const { container } = render(<SubscriptionSelectorView onSelect={onSelect} />)

    const deleteButton = container.querySelector('.subscription-delete-btn') as HTMLElement
    fireEvent.click(deleteButton)

    fireEvent.click(screen.getByRole('button', { name: /common\.operation\.cancel/ }))

    expect(onSelect).not.toHaveBeenCalled()
    expect(screen.queryByText(/pluginTrigger\.subscription\.list\.item\.actions\.deleteConfirm\.title/)).not.toBeInTheDocument()
  })
})
