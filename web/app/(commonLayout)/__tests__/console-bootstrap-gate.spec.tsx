import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ConsoleBootstrapGate } from '../console-bootstrap-gate'

const profileQueryKey = ['console', 'account', 'profile', 'get']
const systemFeaturesQueryKey = ['console', 'system-features', 'get']

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
}

const createDeferred = <T,>(): Deferred<T> => {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })

  return { promise, resolve, reject }
}

const mocks = vi.hoisted(() => ({
  profileQuery: undefined as Deferred<{ id: string }> | undefined,
  systemFeaturesQuery: undefined as Deferred<{ branding: { enabled: boolean } }> | undefined,
}))

vi.mock('@/features/account-profile/client', () => ({
  userProfileQueryOptions: () => ({
    queryKey: profileQueryKey,
    queryFn: () => mocks.profileQuery!.promise,
  }),
}))

vi.mock('@/features/system-features/client', () => ({
  systemFeaturesQueryOptions: () => ({
    queryKey: systemFeaturesQueryKey,
    queryFn: () => mocks.systemFeaturesQuery!.promise,
  }),
}))

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  })
}

function renderGate(children: ReactNode, queryClient = createQueryClient()) {
  render(
    <QueryClientProvider client={queryClient}>
      <ConsoleBootstrapGate>{children}</ConsoleBootstrapGate>
    </QueryClientProvider>,
  )

  return queryClient
}

describe('ConsoleBootstrapGate', () => {
  beforeEach(() => {
    mocks.profileQuery = createDeferred()
    mocks.systemFeaturesQuery = createDeferred()
  })

  it('waits for profile and system features before mounting atom consumers', async () => {
    renderGate(<div>Console shell</div>)

    expect(screen.queryByText('Console shell')).not.toBeInTheDocument()

    await act(async () => {
      mocks.profileQuery!.resolve({ id: 'user-1' })
    })
    expect(screen.queryByText('Console shell')).not.toBeInTheDocument()

    await act(async () => {
      mocks.systemFeaturesQuery!.resolve({ branding: { enabled: false } })
    })

    expect(await screen.findByText('Console shell')).toBeInTheDocument()
  })

  it('keeps atom consumers mounted when a cached profile background refetch fails', async () => {
    const queryClient = createQueryClient()
    queryClient.setQueryData(profileQueryKey, { id: 'user-1' }, { updatedAt: 1 })
    queryClient.setQueryData(
      systemFeaturesQueryKey,
      { branding: { enabled: false } },
      { updatedAt: 1 },
    )

    renderGate(<div>Console shell</div>, queryClient)

    expect(screen.getByText('Console shell')).toBeInTheDocument()
    await waitFor(() => {
      expect(queryClient.getQueryState(profileQueryKey)?.fetchStatus).toBe('fetching')
    })

    await act(async () => {
      mocks.profileQuery!.reject(new Error('profile refetch failed'))
      mocks.systemFeaturesQuery!.resolve({ branding: { enabled: false } })
    })

    await waitFor(() => {
      expect(queryClient.getQueryState(profileQueryKey)?.status).toBe('error')
    })
    expect(screen.getByText('Console shell')).toBeInTheDocument()
  })
})
