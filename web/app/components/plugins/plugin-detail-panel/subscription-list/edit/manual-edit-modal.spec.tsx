import type { TriggerSubscription } from '@/app/components/workflow/block-selector/types'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TriggerCredentialTypeEnum } from '@/app/components/workflow/block-selector/types'
import { ManualEditModal } from './manual-edit-modal'

const mockRefetch = vi.fn()
const mockUpdate = vi.fn()
const mockToast = vi.fn()

vi.mock('../../store', () => ({
  usePluginStore: () => ({
    detail: {
      id: 'detail-1',
      plugin_id: 'plugin-1',
      name: 'Plugin',
      plugin_unique_identifier: 'plugin-uid',
      provider: 'provider-1',
      declaration: { trigger: { subscription_schema: [] } },
    },
  }),
}))

vi.mock('../use-subscription-list', () => ({
  useSubscriptionList: () => ({ refetch: mockRefetch }),
}))

vi.mock('@/service/use-triggers', () => ({
  useUpdateTriggerSubscription: () => ({ mutate: mockUpdate, isPending: false }),
  useTriggerPluginDynamicOptions: () => ({ data: [], isLoading: false }),
}))

vi.mock('@/app/components/base/toast', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/components/base/toast')>()
  return {
    ...actual,
    default: {
      notify: (args: { type: string, message: string }) => mockToast(args),
    },
    useToastContext: () => ({
      notify: (args: { type: string, message: string }) => mockToast(args),
      close: vi.fn(),
    }),
  }
})

const createSubscription = (overrides: Partial<TriggerSubscription> = {}): TriggerSubscription => ({
  id: 'sub-1',
  name: 'Subscription One',
  provider: 'provider-1',
  credential_type: TriggerCredentialTypeEnum.Unauthorized,
  credentials: {},
  endpoint: 'https://example.com',
  parameters: {},
  properties: {},
  workflows_in_use: 0,
  ...overrides,
})

beforeEach(() => {
  vi.clearAllMocks()
  mockUpdate.mockImplementation((_payload: unknown, options?: { onSuccess?: () => void }) => {
    options?.onSuccess?.()
  })
})

describe('ManualEditModal', () => {
  it('should render title and allow cancel', () => {
    const onClose = vi.fn()

    render(<ManualEditModal subscription={createSubscription()} onClose={onClose} />)

    expect(screen.getByText(/pluginTrigger\.subscription\.list\.item\.actions\.edit\.title/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'common.operation.cancel' }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('should submit update with default values', () => {
    const onClose = vi.fn()

    render(<ManualEditModal subscription={createSubscription()} onClose={onClose} />)

    fireEvent.click(screen.getByRole('button', { name: 'common.operation.save' }))

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        subscriptionId: 'sub-1',
        name: 'Subscription One',
        properties: undefined,
      }),
      expect.any(Object),
    )
    expect(mockRefetch).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
