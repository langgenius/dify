import type { MockedFunction } from 'vite-plus/test'
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { toast } from '@/app/notifications'
import { useRouter, useSearchParams } from '@/next/navigation'
import { createHttpError } from '@/service/http-error'
import { createTestQueryClient } from '@/test/query-client'
import OneMoreStep from '../one-more-step'

const mockSubmitOneMoreStep = vi.hoisted(() => vi.fn())

vi.mock('@/next/navigation', () => ({
  useRouter: vi.fn(),
  useSearchParams: vi.fn(),
}))

vi.mock('@/service/base', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/base')>()),
  post: (...args: unknown[]) => mockSubmitOneMoreStep(...args),
}))

const mockReplace = vi.fn()

const mockUseRouter = useRouter as unknown as MockedFunction<typeof useRouter>
const mockUseSearchParams = useSearchParams as unknown as MockedFunction<typeof useSearchParams>

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
    mockSubmitOneMoreStep.mockResolvedValue({ result: 'success' })
  })

  it('exposes the page title as the main heading', () => {
    const queryClient = createTestQueryClient()
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
      const queryClient = createTestQueryClient()
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
  it.each([400, 500])(
    'reports a %i failure once and keeps the invitation input',
    async (status) => {
      const errorToast = vi.spyOn(toast, 'error')
      mockSubmitOneMoreStep.mockRejectedValueOnce(
        createHttpError(new Response(null, { status }), { message: 'Initialization failed' }),
      )
      render(
        <QueryClientProvider client={createTestQueryClient()}>
          <OneMoreStep />
        </QueryClientProvider>,
      )
      const user = userEvent.setup()
      const invitation = screen.getByRole('textbox', { name: 'login.invitationCode' })
      await user.click(invitation)
      await user.keyboard('{Enter}')
      await waitFor(() => expect(errorToast).toHaveBeenCalledTimes(1))
      expect(errorToast).toHaveBeenCalledWith(
        status === 400 ? 'login.invalidInvitationCode' : 'Initialization failed',
      )
      expect(invitation).toHaveValue('invite-code')
      expect(mockReplace).not.toHaveBeenCalled()
      errorToast.mockRestore()
    },
  )
})
