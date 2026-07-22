import type { MockedFunction } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useRouter, useSearchParams } from '@/next/navigation'
import { useOneMoreStep } from '@/service/use-common'
import OneMoreStep from '../one-more-step'

vi.mock('@/next/navigation', () => ({
  useRouter: vi.fn(),
  useSearchParams: vi.fn(),
}))

vi.mock('@/service/use-common', () => ({
  useOneMoreStep: vi.fn(),
}))

const mockReplace = vi.fn()
const mockSubmitOneMoreStep = vi.fn()

const mockUseRouter = useRouter as unknown as MockedFunction<typeof useRouter>
const mockUseSearchParams = useSearchParams as unknown as MockedFunction<typeof useSearchParams>
const mockUseOneMoreStep = useOneMoreStep as unknown as MockedFunction<typeof useOneMoreStep>

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
    mockUseOneMoreStep.mockReturnValue({
      mutateAsync: mockSubmitOneMoreStep,
      isPending: false,
    } as unknown as ReturnType<typeof useOneMoreStep>)
    mockSubmitOneMoreStep.mockResolvedValue({ result: 'success' })
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

      await user.click(screen.getByRole('button', { name: 'login.go' }))

      await waitFor(() => {
        expect(mockReplace).toHaveBeenCalledWith('/apps?tag=workflow')
      })
    })
  })
})
