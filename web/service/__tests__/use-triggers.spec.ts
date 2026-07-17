import type { TriggerProviderApiEntity as GeneratedTriggerProvider } from '@dify/contracts/api/console/workspaces/types.gen'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import { createElement } from 'react'
import { describe, expect, it } from 'vitest'
import {
  convertToTriggerWithProvider,
  normalizeTriggerProvider,
  useVerifyAndUpdateTriggerSubscriptionBuilder,
} from '../use-triggers'

const mocks = vi.hoisted(() => ({
  mutationKey: vi.fn(() => ['trigger-builder-verify']),
  verifyAndUpdate: vi.fn().mockResolvedValue({ verified: false }),
}))

vi.mock('@/service/client', () => ({
  consoleClient: {
    workspaces: {
      current: {
        triggerProvider: {
          byProvider: {
            subscriptions: {
              builder: {
                verifyAndUpdate: {
                  bySubscriptionBuilderId: {
                    post: mocks.verifyAndUpdate,
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  consoleQuery: {
    workspaces: {
      current: {
        triggerProvider: {
          byProvider: {
            subscriptions: {
              builder: {
                verifyAndUpdate: {
                  bySubscriptionBuilderId: {
                    post: {
                      mutationKey: mocks.mutationKey,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
}))

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
    },
  })

  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children)
}

const createGeneratedTriggerProvider = (): GeneratedTriggerProvider => ({
  author: 'Dify',
  name: 'github',
  label: { en_US: 'GitHub' },
  description: { en_US: 'GitHub trigger provider' },
  tags: ['source-control'],
  events: [
    {
      name: 'issue_created',
      identity: {
        author: 'Dify',
        name: 'issue_created',
        label: { en_US: 'Issue created' },
        provider: 'github',
      },
      description: { en_US: 'Issue created event' },
      parameters: [
        {
          name: 'retry_count',
          label: { en_US: 'Retry count' },
          type: 'number',
          default: 0,
          required: false,
          multiple: false,
        },
      ],
      output_schema: {},
    },
  ],
})

describe('trigger provider normalization', () => {
  it('should preserve falsy event parameter defaults', () => {
    const normalizedProvider = normalizeTriggerProvider(createGeneratedTriggerProvider())
    const triggerWithProvider = convertToTriggerWithProvider(normalizedProvider)

    expect(normalizedProvider.events[0]?.parameters[0]?.default).toBe(0)
    expect(triggerWithProvider.events[0]?.parameters[0]?.default).toBe(0)
  })
})

describe('trigger subscription builder verification', () => {
  it('should omit credentials while polling OAuth authorization', async () => {
    const { result } = renderHook(() => useVerifyAndUpdateTriggerSubscriptionBuilder(), {
      wrapper: createWrapper(),
    })

    await act(async () => {
      await result.current.mutateAsync({
        provider: 'langgenius/gmail_trigger/gmail_trigger',
        subscriptionBuilderId: 'builder-1',
      })
    })

    expect(mocks.verifyAndUpdate).toHaveBeenCalledWith(
      {
        params: {
          provider: 'langgenius/gmail_trigger/gmail_trigger',
          subscription_builder_id: 'builder-1',
        },
        body: {},
      },
      {
        context: { silent: true },
      },
    )
  })
})
