import type { SimpleDetail } from '../../store'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { useSubscriptionList } from '../use-subscription-list'

let mockDetail: SimpleDetail | undefined

const mocks = vi.hoisted(() => ({
  listSubscriptions: vi.fn(),
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.triggerProvider.byProvider.subscriptions.list.get': async (input) => {
        mocks.listSubscriptions(input)
        return []
      },
    }),
  }
})

vi.mock('../../store', () => ({
  usePluginStore: (
    selector: (state: { detail: SimpleDetail | undefined }) => SimpleDetail | undefined,
  ) => selector({ detail: mockDetail }),
}))

beforeEach(() => {
  vi.clearAllMocks()
  mockDetail = undefined
})

describe('useSubscriptionList', () => {
  it('should request subscriptions with provider from store', async () => {
    mockDetail = {
      id: 'detail-1',
      plugin_id: 'plugin-1',
      name: 'Plugin',
      plugin_unique_identifier: 'plugin-uid',
      provider: 'test-provider',
      declaration: {},
    }

    const { result } = renderHook(() => useSubscriptionList(), {
      wrapper: createConsoleQueryWrapper().wrapper,
    })

    await waitFor(() => expect(result.current.subscriptions).toEqual([]))
    expect(mocks.listSubscriptions).toHaveBeenCalledWith({
      params: { provider: 'test-provider' },
    })
    expect(result.current.detail).toEqual(mockDetail)
  })

  it('should not request subscriptions when detail is missing', () => {
    const { result } = renderHook(() => useSubscriptionList(), {
      wrapper: createConsoleQueryWrapper().wrapper,
    })

    expect(mocks.listSubscriptions).not.toHaveBeenCalled()
    expect(result.current.subscriptions).toBeUndefined()
    expect(result.current.detail).toBeUndefined()
  })
})
