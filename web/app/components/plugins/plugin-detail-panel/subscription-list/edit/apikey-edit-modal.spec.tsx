import type { TriggerSubscription } from '@/app/components/workflow/block-selector/types'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TriggerCredentialTypeEnum } from '@/app/components/workflow/block-selector/types'
import { ApiKeyEditModal } from './apikey-edit-modal'

const mockRefetch = vi.fn()
const mockUpdate = vi.fn()
const mockVerify = vi.fn()
const mockToast = vi.fn()

vi.mock('../../store', () => ({
  usePluginStore: () => ({
    detail: {
      id: 'detail-1',
      plugin_id: 'plugin-1',
      name: 'Plugin',
      plugin_unique_identifier: 'plugin-uid',
      provider: 'provider-1',
      declaration: {
        trigger: {
          subscription_constructor: {
            parameters: [],
            credentials_schema: [
              {
                name: 'api_key',
                type: 'secret',
                label: 'API Key',
                required: false,
                default: 'token',
              },
            ],
          },
        },
      },
    },
  }),
}))

vi.mock('../use-subscription-list', () => ({
  useSubscriptionList: () => ({ refetch: mockRefetch }),
}))

vi.mock('@/service/use-triggers', () => ({
  useUpdateTriggerSubscription: () => ({ mutate: mockUpdate, isPending: false }),
  useVerifyTriggerSubscription: () => ({ mutate: mockVerify, isPending: false }),
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
  mockVerify.mockImplementation((_payload: unknown, options?: { onSuccess?: () => void }) => {
    options?.onSuccess?.()
  })
  mockUpdate.mockImplementation((_payload: unknown, options?: { onSuccess?: () => void }) => {
    options?.onSuccess?.()
  })
})

describe('ApiKeyEditModal', () => {
  it('should render verify step with encrypted hint and allow cancel', () => {
    const onClose = vi.fn()

    render(<ApiKeyEditModal subscription={createSubscription()} onClose={onClose} />)

    expect(screen.getByRole('button', { name: 'pluginTrigger.modal.common.verify' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'pluginTrigger.modal.common.back' })).not.toBeInTheDocument()
    expect(screen.getByText(content => content.includes('common.provider.encrypted.front'))).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'common.operation.cancel' }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
