import type { PluginDeclaration, PluginDetail } from '@/app/components/plugins/types'
import type { TriggerSubscription } from '@/app/components/workflow/block-selector/types'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TriggerCredentialTypeEnum } from '@/app/components/workflow/block-selector/types'
import { SubscriptionList } from './index'
import { SubscriptionListMode } from './types'

const mockRefetch = vi.fn()
let mockSubscriptionListError: Error | null = null
let mockSubscriptionListState: {
  isLoading: boolean
  refetch: () => void
  subscriptions?: TriggerSubscription[]
}

let mockPluginDetail: PluginDetail | undefined

vi.mock('./use-subscription-list', () => ({
  useSubscriptionList: () => {
    if (mockSubscriptionListError)
      throw mockSubscriptionListError
    return mockSubscriptionListState
  },
}))

vi.mock('../../store', () => ({
  usePluginStore: (selector: (state: { detail: PluginDetail | undefined }) => PluginDetail | undefined) =>
    selector({ detail: mockPluginDetail }),
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
  credential_type: TriggerCredentialTypeEnum.ApiKey,
  credentials: {},
  endpoint: 'https://example.com',
  parameters: {},
  properties: {},
  workflows_in_use: 0,
  ...overrides,
})

const createPluginDetail = (overrides: Partial<PluginDetail> = {}): PluginDetail => ({
  id: 'plugin-detail-1',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-02T00:00:00Z',
  name: 'Test Plugin',
  plugin_id: 'plugin-id',
  plugin_unique_identifier: 'plugin-uid',
  declaration: {} as PluginDeclaration,
  installation_id: 'install-1',
  tenant_id: 'tenant-1',
  endpoints_setups: 0,
  endpoints_active: 0,
  version: '1.0.0',
  latest_version: '1.0.0',
  latest_unique_identifier: 'plugin-uid',
  source: 'marketplace' as PluginDetail['source'],
  meta: undefined,
  status: 'active',
  deprecated_reason: '',
  alternative_plugin_id: '',
  ...overrides,
})

beforeEach(() => {
  vi.clearAllMocks()
  mockRefetch.mockReset()
  mockSubscriptionListError = null
  mockPluginDetail = undefined
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

      expect(screen.getByText(/pluginTrigger\.subscription\.listNum/)).toBeInTheDocument()
      expect(screen.getByText('Subscription One')).toBeInTheDocument()
    })

    it('should render loading state when subscriptions are loading', () => {
      mockSubscriptionListState = {
        ...mockSubscriptionListState,
        isLoading: true,
      }

      render(<SubscriptionList />)

      expect(screen.getByRole('status')).toBeInTheDocument()
      expect(screen.queryByText('Subscription One')).not.toBeInTheDocument()
    })

    it('should render list view with plugin detail provided', () => {
      const pluginDetail = createPluginDetail()

      render(<SubscriptionList pluginDetail={pluginDetail} />)

      expect(screen.getByText('Subscription One')).toBeInTheDocument()
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

  describe('Props', () => {
    it('should render selector view when mode is selector', () => {
      render(<SubscriptionList mode={SubscriptionListMode.SELECTOR} />)

      expect(screen.getByText('Subscription One')).toBeInTheDocument()
    })

    it('should highlight the selected subscription when selectedId is provided', () => {
      render(
        <SubscriptionList
          mode={SubscriptionListMode.SELECTOR}
          selectedId="sub-1"
        />,
      )

      const selectedButton = screen.getByRole('button', { name: 'Subscription One' })
      const selectedRow = selectedButton.closest('div')

      expect(selectedRow).toHaveClass('bg-state-base-hover')
    })
  })

  describe('User Interactions', () => {
    it('should call onSelect with refetch callback when selecting a subscription', () => {
      const onSelect = vi.fn()

      render(
        <SubscriptionList
          mode={SubscriptionListMode.SELECTOR}
          onSelect={onSelect}
        />,
      )

      fireEvent.click(screen.getByRole('button', { name: 'Subscription One' }))

      expect(onSelect).toHaveBeenCalledTimes(1)
      const [selectedSubscription, callback] = onSelect.mock.calls[0]
      expect(selectedSubscription).toMatchObject({ id: 'sub-1', name: 'Subscription One' })
      expect(typeof callback).toBe('function')

      callback?.()
      expect(mockRefetch).toHaveBeenCalledTimes(1)
    })

    it('should not throw when onSelect is undefined', () => {
      render(<SubscriptionList mode={SubscriptionListMode.SELECTOR} />)

      expect(() => {
        fireEvent.click(screen.getByRole('button', { name: 'Subscription One' }))
      }).not.toThrow()
    })

    it('should open delete confirm without triggering selection', () => {
      const onSelect = vi.fn()
      const { container } = render(
        <SubscriptionList
          mode={SubscriptionListMode.SELECTOR}
          onSelect={onSelect}
        />,
      )

      const deleteButton = container.querySelector('.subscription-delete-btn')
      expect(deleteButton).toBeTruthy()

      if (deleteButton)
        fireEvent.click(deleteButton)

      expect(onSelect).not.toHaveBeenCalled()
      expect(screen.getByText(/pluginTrigger\.subscription\.list\.item\.actions\.deleteConfirm\.title/)).toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should render error boundary fallback when an error occurs', () => {
      mockSubscriptionListError = new Error('boom')

      render(<SubscriptionList />)

      expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    })
  })
})
