import { ORPCError } from '@orpc/client'
import { dehydrate } from '@tanstack/react-query'
import { getQueryClient } from '../get-query-client'

vi.mock('@/app/notifications', () => ({
  toast: {
    error: vi.fn(),
  },
}))

const { toast } = await import('@/app/notifications')

const requestError = (message: string, status = 400) =>
  new ORPCError('request_failed', { status, message })

describe('getQueryClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('includes pending queries in dehydrated state', async () => {
    const queryClient = getQueryClient()
    const queryKey = ['pending-dehydration']
    let resolveQuery!: (value: string) => void
    const queryPromise = new Promise<string>((resolve) => {
      resolveQuery = resolve
    })
    const queryExecution = queryClient.query({
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
    await queryExecution
    queryClient.removeQueries({ queryKey })
  })

  describe('query failures', () => {
    it('should leave a failed first load to the component', async () => {
      const queryClient = getQueryClient()
      const queryKey = ['first-load-failure']

      await expect(
        queryClient.query({
          queryKey,
          queryFn: () => Promise.reject(requestError('Server message')),
          retry: false,
        }),
      ).rejects.toThrow('Server message')

      expect(toast.error).not.toHaveBeenCalled()
      queryClient.removeQueries({ queryKey })
    })

    it('should toast a failed first load that declares an error message', async () => {
      const queryClient = getQueryClient()
      const queryKey = ['first-load-failure-with-message']

      await expect(
        queryClient.query({
          queryKey,
          queryFn: () => Promise.reject(requestError('Server message')),
          retry: false,
          meta: { errorMessage: 'Failed to load the list' },
        }),
      ).rejects.toThrow('Server message')

      expect(toast.error).toHaveBeenCalledExactlyOnceWith('Failed to load the list', {
        id: 'request-error:Failed to load the list:Server message',
        description: 'Server message',
      })
      queryClient.removeQueries({ queryKey })
    })

    it('should toast a failed background refetch while keeping the stale data', async () => {
      const queryClient = getQueryClient()
      const queryKey = ['background-refetch-failure']
      queryClient.setQueryData(queryKey, 'stale')

      await expect(
        queryClient.fetchQuery({
          queryKey,
          queryFn: () => Promise.reject(requestError('Refresh failed')),
          retry: false,
          staleTime: 0,
        }),
      ).rejects.toThrow('Refresh failed')

      expect(toast.error).toHaveBeenCalledExactlyOnceWith('Refresh failed', {
        id: 'request-error:Refresh failed',
      })
      expect(queryClient.getQueryData(queryKey)).toBe('stale')
      queryClient.removeQueries({ queryKey })
    })
  })

  describe('mutation failures', () => {
    it('should toast the server message when the mutation does not handle failures', async () => {
      const queryClient = getQueryClient()
      const mutation = queryClient.getMutationCache().build(queryClient, {
        mutationFn: () => Promise.reject(requestError('Name already exists')),
      })

      await expect(mutation.execute(undefined)).rejects.toThrow('Name already exists')

      expect(toast.error).toHaveBeenCalledExactlyOnceWith('Name already exists', {
        id: 'request-error:Name already exists',
      })
    })

    it('should title the toast with the declared error message', async () => {
      const queryClient = getQueryClient()
      const mutation = queryClient.getMutationCache().build(queryClient, {
        mutationFn: () => Promise.reject(requestError('Name already exists')),
        meta: { errorMessage: 'Failed to save' },
      })

      await expect(mutation.execute(undefined)).rejects.toThrow('Name already exists')

      expect(toast.error).toHaveBeenCalledExactlyOnceWith('Failed to save', {
        id: 'request-error:Failed to save:Name already exists',
        description: 'Name already exists',
      })
    })

    it('should leave failures to a mutation that declares onError', async () => {
      const queryClient = getQueryClient()
      const onError = vi.fn()
      const mutation = queryClient.getMutationCache().build(queryClient, {
        mutationFn: () => Promise.reject(requestError('Name already exists')),
        onError,
      })

      await expect(mutation.execute(undefined)).rejects.toThrow('Name already exists')

      expect(onError).toHaveBeenCalledOnce()
      expect(toast.error).not.toHaveBeenCalled()
    })

    it('should not toast unauthorized failures', async () => {
      const queryClient = getQueryClient()
      const mutation = queryClient.getMutationCache().build(queryClient, {
        mutationFn: () => Promise.reject(requestError('Unauthorized', 401)),
      })

      await expect(mutation.execute(undefined)).rejects.toThrow('Unauthorized')

      expect(toast.error).not.toHaveBeenCalled()
    })
  })
})
