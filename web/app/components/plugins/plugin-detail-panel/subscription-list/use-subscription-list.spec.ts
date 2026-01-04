import type { SimpleDetail } from '../store'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSubscriptionList } from './use-subscription-list'

let mockDetail: SimpleDetail | undefined
const mockRefetch = vi.fn()

const mockTriggerSubscriptions = vi.fn()

vi.mock('@/service/use-triggers', () => ({
  useTriggerSubscriptions: (...args: unknown[]) => mockTriggerSubscriptions(...args),
}))

vi.mock('../store', () => ({
  usePluginStore: (selector: (state: { detail: SimpleDetail | undefined }) => SimpleDetail | undefined) =>
    selector({ detail: mockDetail }),
}))

beforeEach(() => {
  vi.clearAllMocks()
  mockDetail = undefined
  mockTriggerSubscriptions.mockReturnValue({
    data: [],
    isLoading: false,
    refetch: mockRefetch,
  })
})

describe('useSubscriptionList', () => {
  it('should request subscriptions with provider from store', () => {
    mockDetail = {
      id: 'detail-1',
      plugin_id: 'plugin-1',
      name: 'Plugin',
      plugin_unique_identifier: 'plugin-uid',
      provider: 'test-provider',
      declaration: {},
    }

    const { result } = renderHook(() => useSubscriptionList())

    expect(mockTriggerSubscriptions).toHaveBeenCalledWith('test-provider')
    expect(result.current.detail).toEqual(mockDetail)
  })

  it('should request subscriptions with empty provider when detail is missing', () => {
    const { result } = renderHook(() => useSubscriptionList())

    expect(mockTriggerSubscriptions).toHaveBeenCalledWith('')
    expect(result.current.detail).toBeUndefined()
  })

  it('should return data from trigger subscription hook', () => {
    mockTriggerSubscriptions.mockReturnValue({
      data: [{ id: 'sub-1' }],
      isLoading: true,
      refetch: mockRefetch,
    })

    const { result } = renderHook(() => useSubscriptionList())

    expect(result.current.subscriptions).toEqual([{ id: 'sub-1' }])
    expect(result.current.isLoading).toBe(true)
    expect(result.current.refetch).toBe(mockRefetch)
  })
})
