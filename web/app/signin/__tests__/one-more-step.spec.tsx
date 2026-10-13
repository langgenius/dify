import type { MockedFunction } from 'vite-plus/test'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { toast } from '@/app/notifications'
import { useRouter, useSearchParams } from '@/next/navigation'
import OneMoreStep from '../one-more-step'

vi.mock('@/app/notifications', () => ({ toast: { error: vi.fn() } }))

vi.mock('@/next/navigation', () => ({
  useRouter: vi.fn(),
  useSearchParams: vi.fn(),
}))

const mockReplace = vi.fn()
const mockFetch = vi.fn<typeof fetch>()

const mockUseRouter = useRouter as unknown as MockedFunction<typeof useRouter>
const mockUseSearchParams = useSearchParams as unknown as MockedFunction<typeof useSearchParams>

afterEach(() => vi.unstubAllGlobals())

describe('OneMoreStep', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseRouter.mockReturnValue({ replace: mockReplace } as unknown as ReturnType<
      typeof useRouter
    >)
    mockUseSearchParams.mockReturnValue(
      new URLSearchParams(
        'invitation_code=invite-code&redirect_url=%2Fapps%3Ftag%3Dworkflow',
      ) as unknown as ReturnType<typeof useSearchParams>,
    )
    mockFetch.mockImplementation(async () => Response.json({ result: 'success' }))
    vi.stubGlobal('fetch', mockFetch)
  })

  it('exposes the page title as the main heading', () => {
    const queryClient = new QueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <OneMoreStep />
      </QueryClientProvider>,
    )

    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()
  })

  it.each([
    [400, 'Invalid invitation code', 'login.invalidInvitationCode'],
    [503, 'Please try again later', 'Please try again later'],
  ])('keeps the account form open and reports HTTP %s once', async (status, message, expected) => {
    mockFetch.mockImplementation(async () => Response.json({ message }, { status }))
    const user = userEvent.setup()
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    render(
      <QueryClientProvider client={queryClient}>
        <OneMoreStep />
      </QueryClientProvider>,
    )

    const invitationCode = screen.getByRole('textbox', { name: 'login.invitationCode' })
    await user.click(invitationCode)
    await user.keyboard('{Enter}')

    await waitFor(() => expect(toast.error).toHaveBeenCalledExactlyOnceWith(expected))
    expect(invitationCode).toHaveValue('invite-code')
    expect(mockReplace).not.toHaveBeenCalled()
    queryClient.clear()
  })

  // Successful account initialization returns users to their original console destination.
  describe('Post-registration redirect', () => {
    it('should return to the requested console page when account initialization succeeds', async () => {
      const user = userEvent.setup()
      const queryClient = new QueryClient()
      render(
        <QueryClientProvider client={queryClient}>
          <OneMoreStep />
        </QueryClientProvider>,
      )

      await user.click(screen.getByRole('textbox', { name: 'login.invitationCode' }))
      await user.keyboard('{Enter}')

      await waitFor(() => {
        expect(mockReplace).toHaveBeenCalledWith('/apps?tag=workflow')
      })
    })
  })
})
