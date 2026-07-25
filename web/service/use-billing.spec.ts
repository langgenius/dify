import { useQuery } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { consoleClient, consoleQuery } from '@/service/client'
import { useCurrentPlanVectorSpace } from './use-billing'

vi.mock('@tanstack/react-query', () => ({
  useMutation: vi.fn(),
  useQuery: vi.fn(),
}))

vi.mock('@/service/client', () => ({
  consoleClient: {
    features: {
      vectorSpace: {
        get: vi.fn(),
      },
    },
  },
  consoleQuery: {
    features: {
      vectorSpace: {
        get: {
          queryKey: vi.fn(() => ['features', 'vector-space']),
        },
      },
    },
  },
}))

const mockUseQuery = vi.mocked(useQuery)
const mockGetVectorSpace = vi.mocked(consoleClient.features.vectorSpace.get)
const mockVectorSpaceQueryKey = vi.mocked(consoleQuery.features.vectorSpace.get.queryKey)

type QueryOptions = Parameters<typeof useQuery>[0]

describe('billing hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseQuery.mockReturnValue({} as ReturnType<typeof useQuery>)
  })

  it('uses the generated feature contract for current plan vector space', async () => {
    mockGetVectorSpace.mockResolvedValue({ size: 256, limit: 1024 })

    useCurrentPlanVectorSpace(false)

    const options = mockUseQuery.mock.calls[0]?.[0] as QueryOptions
    await expect((options.queryFn as () => Promise<unknown>)()).resolves.toEqual({
      size: 256,
      limit: 1024,
    })
    expect(mockVectorSpaceQueryKey).toHaveBeenCalledOnce()
    expect(options.queryKey).toEqual(['features', 'vector-space'])
    expect(options.enabled).toBe(false)
    expect(mockGetVectorSpace).toHaveBeenCalledOnce()
  })
})
