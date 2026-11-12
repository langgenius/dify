import type { MockedFunction } from 'vite-plus/test'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vite-plus/test'
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

  // Successful account initialization returns users to their original console destination.
  describe('Post-registration redirect', () => {
    it('should return to the requested console page when account initialization succeeds', async () => {
      const user = userEvent.setup()
      const queryClient = new QueryClient()
      onTestFinished(() => queryClient.clear())
      render(
        <QueryClientProvider client={queryClient}>
          <OneMoreStep />
        </QueryClientProvider>,
      )

      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()
      const invitation = screen.getByRole('textbox', { name: 'login.invitationCode' })
      expect(invitation).toHaveValue('invite-code')
      await user.clear(invitation)
      await user.type(invitation, ' updated-invite {Enter}')

      await waitFor(() => {
        expect(mockReplace).toHaveBeenCalledWith('/apps?tag=workflow')
      })
      expect(mockSubmitOneMoreStep).toHaveBeenCalledWith({
        body: {
          invitation_code: 'updated-invite',
          interface_language: 'en-US',
          timezone: 'Asia/Shanghai',
        },
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
