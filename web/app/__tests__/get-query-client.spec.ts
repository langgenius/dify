import { dehydrate } from '@tanstack/react-query'
import { getQueryClient } from '../get-query-client'

const mocks = vi.hoisted(() => ({
  isServer: false,
}))

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>()
  return {
    ...actual,
    cache: <T extends (...args: never[]) => unknown>(fn: T) => {
      let cached: ReturnType<T> | undefined
      return ((...args: Parameters<T>) => {
        if (cached === undefined) cached = fn(...args) as ReturnType<T>
        return cached
      }) as T
    },
  }
})

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>()
  return {
    ...actual,
    environmentManager: {
      ...actual.environmentManager,
      isServer: () => mocks.isServer,
    },
  }
})

describe('getQueryClient', () => {
  beforeEach(() => {
    mocks.isServer = false
  })

  it('reuses the same query client during SSR within a request', () => {
    mocks.isServer = true

    const first = getQueryClient()
    const second = getQueryClient()

    expect(second).toBe(first)
  })

  it('includes pending queries in dehydrated state', async () => {
    const queryClient = getQueryClient()
    const queryKey = ['pending-dehydration']
    let resolveQuery!: (value: string) => void
    const queryPromise = new Promise<string>((resolve) => {
      resolveQuery = resolve
    })
    const prefetchPromise = queryClient.prefetchQuery({
      queryKey,
      queryFn: () => queryPromise,
    })

    expect(dehydrate(queryClient).queries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          queryKey,
          state: expect.objectContaining({ status: 'pending' }),
        }),
      ]),
    )

    resolveQuery('ready')
    await prefetchPromise
    queryClient.removeQueries({ queryKey })
  })
})
