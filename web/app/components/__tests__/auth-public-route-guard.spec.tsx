import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { usePathname, useRouter, useSearchParams } from '@/next/navigation'
import { get } from '@/service/base'
import { AuthPublicRouteGuard } from '../auth-public-route-guard'

vi.mock('@/next/navigation', () => ({
  usePathname: vi.fn(),
  useRouter: vi.fn(),
  useSearchParams: vi.fn(),
}))

vi.mock('@/service/base', () => ({
  get: vi.fn(),
}))

vi.mock('@/app/loading', () => ({
  default: () => <div>loading</div>,
}))

const mockUsePathname = vi.mocked(usePathname)
const mockUseRouter = vi.mocked(useRouter)
const mockUseSearchParams = vi.mocked(useSearchParams)
const mockGet = vi.mocked(get)
const mockReplace = vi.fn()

const renderGuard = (children: ReactNode = <div>auth page</div>) => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <AuthPublicRouteGuard>
        {children}
      </AuthPublicRouteGuard>
    </QueryClientProvider>,
  )
}

const createProfileResponse = () => new Response(JSON.stringify({ id: 'user-1' }), {
  headers: {
    'x-version': '1.0.0',
    'x-env': 'test',
  },
})

describe('AuthPublicRouteGuard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUsePathname.mockReturnValue('/signin')
    mockUseRouter.mockReturnValue({ replace: mockReplace } as unknown as ReturnType<typeof useRouter>)
    mockUseSearchParams.mockReturnValue(new URLSearchParams() as unknown as ReturnType<typeof useSearchParams>)
  })

  it('redirects authenticated users to apps', async () => {
    mockGet.mockResolvedValue(createProfileResponse())

    renderGuard()

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/apps'))
    expect(screen.queryByText('auth page')).not.toBeInTheDocument()
  })

  it('uses a safe post-login redirect for authenticated users', async () => {
    mockGet.mockResolvedValue(createProfileResponse())
    mockUseSearchParams.mockReturnValue(
      new URLSearchParams(`redirect_url=${encodeURIComponent('/explore/apps?category=agent')}`) as unknown as ReturnType<typeof useSearchParams>,
    )

    renderGuard()

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/explore/apps?category=agent'))
  })

  it('renders children for unauthenticated users without retrying 401 probes', async () => {
    mockGet.mockRejectedValue(new Response(JSON.stringify({ code: 'unauthorized' }), { status: 401 }))

    renderGuard()

    await waitFor(() => expect(screen.getByText('auth page')).toBeInTheDocument())
    expect(mockReplace).not.toHaveBeenCalled()
    expect(mockGet).toHaveBeenCalledTimes(1)
  })

  it('allows authenticated invite settings continuation route', async () => {
    mockGet.mockResolvedValue(createProfileResponse())
    mockUsePathname.mockReturnValue('/signin/invite-settings')

    renderGuard()

    await waitFor(() => expect(screen.getByText('auth page')).toBeInTheDocument())
    expect(mockReplace).not.toHaveBeenCalled()
  })
})
