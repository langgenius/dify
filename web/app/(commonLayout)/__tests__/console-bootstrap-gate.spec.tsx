import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ConsoleBootstrapGate } from '../console-bootstrap-gate'

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
  isLegacyBase401: vi.fn((error: unknown) => error instanceof Response && error.status === 401),
}))

vi.mock('@/features/account-profile/client', () => ({
  isLegacyBase401: mocks.isLegacyBase401,
  userProfileQueryOptions: () => ({
    queryKey: ['console', 'account', 'profile', 'get'],
    queryFn: () => mocks.profileQuery!.promise,
  }),
}))

vi.mock('@/features/system-features/client', () => ({
  systemFeaturesQueryOptions: () => ({
    queryKey: ['console', 'system-features', 'get'],
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

function renderGate(children: ReactNode) {
  const queryClient = createQueryClient()

  return render(
    <QueryClientProvider client={queryClient}>
      <ConsoleBootstrapGate>{children}</ConsoleBootstrapGate>
    </QueryClientProvider>,
  )
}

describe('ConsoleBootstrapGate', () => {
  beforeEach(() => {
    mocks.profileQuery = createDeferred()
    mocks.systemFeaturesQuery = createDeferred()
    mocks.isLegacyBase401.mockClear()
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

  it('keeps atom consumers unmounted after a profile 401', async () => {
    renderGate(<div>Console shell</div>)

    await act(async () => {
      mocks.profileQuery!.reject(new Response(null, { status: 401 }))
      mocks.systemFeaturesQuery!.resolve({ branding: { enabled: false } })
    })

    await waitFor(() => {
      expect(mocks.isLegacyBase401).toHaveBeenCalledWith(expect.objectContaining({ status: 401 }))
    })
    expect(screen.queryByText('Console shell')).not.toBeInTheDocument()
  })
})
