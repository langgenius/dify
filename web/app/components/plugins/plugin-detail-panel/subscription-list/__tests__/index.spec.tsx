import type { TriggerSubscription } from '@/app/components/workflow/block-selector/types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { TriggerCredentialType } from '@/app/components/workflow/block-selector/types'
import { createReactI18nextMock } from '@/test/i18n-mock'
import { SubscriptionList } from '../index'
import { SubscriptionListMode } from '../types'

vi.mock('react-i18next', () =>
  createReactI18nextMock({
    'errorBoundary.title': 'Something went wrong',
    'errorBoundary.message': 'An unexpected error occurred while rendering this component.',
    'errorBoundary.tryAgain': 'Try Again',
    'errorBoundary.reloadPage': 'Reload Page',
  }),
)

const mockRefetch = vi.fn()
let mockSubscriptionListError: Error | null = null
let mockSubscriptionListState: {
  isLoading: boolean
  refetch: () => void
  subscriptions?: TriggerSubscription[]
}

vi.mock('../use-subscription-list', () => ({
  useSubscriptionList: () => {
    if (mockSubscriptionListError) throw mockSubscriptionListError
    return mockSubscriptionListState
  },
}))

const mockInitiateOAuth = vi.fn()
const mockDeleteSubscription = vi.fn()

vi.mock('@/service/use-triggers', () => ({
  useTriggerProviderInfo: () => ({ data: { supported_creation_methods: [] } }),
  useTriggerOAuthConfig: () => ({ data: undefined, refetch: vi.fn() }),
  useInitiateTriggerOAuth: () => ({ mutate: mockInitiateOAuth }),
  useDeleteTriggerSubscription: () => ({ mutate: mockDeleteSubscription, isPending: false }),
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
  mockRefetch.mockReset()
  mockSubscriptionListError = null
  mockSubscriptionListState = {
    isLoading: false,
    refetch: mockRefetch,
    subscriptions: [createSubscription()],
  }
})

describe('SubscriptionList', () => {
  describe('Rendering', () => {
    it('should render list view by default', () => {
      render(<SubscriptionList />)

      expect(screen.getByText(/pluginTrigger\.subscription\.listNum/))!.toBeInTheDocument()
      expect(screen.getByText('Subscription One'))!.toBeInTheDocument()
    })

    it('should render loading state when subscriptions are loading', () => {
      mockSubscriptionListState = {
        ...mockSubscriptionListState,
        isLoading: true,
      }

      render(<SubscriptionList />)

      expect(screen.getByRole('progressbar'))!.toBeInTheDocument()
      expect(screen.queryByText('Subscription One')).not.toBeInTheDocument()
    })

    it('should render without list entries when subscriptions are empty', () => {
      mockSubscriptionListState = {
        ...mockSubscriptionListState,
        subscriptions: [],
      }

      render(<SubscriptionList />)

      expect(screen.queryByText(/pluginTrigger\.subscription\.listNum/)).not.toBeInTheDocument()
      expect(screen.queryByText('Subscription One')).not.toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should call onSelect with refetch callback when selecting a subscription', async () => {
      const user = userEvent.setup()
      const onSelect =
        vi.fn<NonNullable<React.ComponentProps<typeof SubscriptionList>['onSelect']>>()

      render(<SubscriptionList mode={SubscriptionListMode.SELECTOR} onSelect={onSelect} />)

      await user.click(screen.getByRole('button', { name: 'Subscription One' }))

      expect(onSelect).toHaveBeenCalledTimes(1)
      const [selectedSubscription, callback] = onSelect.mock.calls[0]!
      expect(selectedSubscription).toMatchObject({ id: 'sub-1', name: 'Subscription One' })
      expect(typeof callback).toBe('function')

      callback?.()
      expect(mockRefetch).toHaveBeenCalledTimes(1)
    })
  })

  describe('Edge Cases', () => {
    it('should render error boundary fallback when an error occurs', async () => {
      mockSubscriptionListError = new Error('boom')

      render(<SubscriptionList />)

      expect(await screen.findByText('Something went wrong'))!.toBeInTheDocument()
    })
  })
})
