import type { MockedFunction } from 'vite-plus/test'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { useRouter, useSearchParams } from '@/next/navigation'
import OneMoreStep from '../one-more-step'

vi.mock('@/next/navigation', () => ({
  useRouter: vi.fn(),
  useSearchParams: vi.fn(),
}))

const mockReplace = vi.fn()
const mockSubmitOneMoreStep = vi.fn()

const mockUseRouter = useRouter as MockedFunction<typeof useRouter>
const mockUseSearchParams = useSearchParams as MockedFunction<typeof useSearchParams>

describe('OneMoreStep', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseRouter.mockReturnValue({ replace: mockReplace } as unknown as ReturnType<
      typeof useRouter
    >)
    mockUseSearchParams.mockReturnValue(
      new URLSearchParams(
        'invitation_code=invite-code&redirect_url=%2Fapps%3Ftag%3Dworkflow',
      ) as ReturnType<typeof useSearchParams>,
    )
    mockSubmitOneMoreStep.mockResolvedValue({ result: 'success' })
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

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'account.init.post': (input) => mockSubmitOneMoreStep(input),
    }),
  }
})
