import type { AppContextValue } from '@/context/app-context'
import type { ICurrentWorkspace } from '@/models/common'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { useAppContext } from '@/context/app-context'
import { ownershipTransfer, sendOwnerEmail, verifyOwnerEmail } from '@/service/common'
import { useMembers } from '@/service/use-common'
import TransferOwnershipModal from '../index'

const toastMocks = vi.hoisted(() => ({
  mockNotify: vi.fn(),
}))

vi.mock('@/context/app-context')
vi.mock('@/service/common')
vi.mock('@/service/use-common')
vi.mock('@langgenius/dify-ui/toast', () => ({
  default: {
    notify: (args: unknown) => toastMocks.mockNotify(args),
  },
  toast: {
    success: (message: string) => toastMocks.mockNotify({ type: 'success', message }),
    error: (message: string) => toastMocks.mockNotify({ type: 'error', message }),
    warning: (message: string) => toastMocks.mockNotify({ type: 'warning', message }),
    info: (message: string) => toastMocks.mockNotify({ type: 'info', message }),
  },
}))

vi.mock('../member-selector', () => ({
  default: ({ onSelect }: { onSelect: (id: string) => void }) => (
    <button onClick={() => onSelect('new-owner-id')}>Select member</button>
  ),
}))

describe('TransferOwnershipModal', () => {
  const mockOnClose = vi.fn()
  const { mockNotify } = toastMocks

  beforeEach(() => {
    vi.clearAllMocks()

    vi.mocked(useAppContext).mockReturnValue({
      currentWorkspace: { name: 'Test Workspace' } as ICurrentWorkspace,
      userProfile: { email: 'owner@example.com', id: 'owner-id' },
    } as unknown as AppContextValue)

    vi.mocked(useMembers).mockReturnValue({
      data: { accounts: [] },
    } as unknown as ReturnType<typeof useMembers>)

    // Stub globalThis.location.reload (component calls globalThis.location.reload())
    const mockReload = vi.fn()
    vi.stubGlobal('location', {
      reload: mockReload,
      href: '',
      assign: vi.fn(),
      replace: vi.fn(),
    } as unknown as Location)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  const renderModal = () => render(
    <>
      <TransferOwnershipModal show onClose={mockOnClose} />
    </>,
  )

  const mockEmailVerification = ({
    isValid = true,
    token = 'final-token',
  }: {
    isValid?: boolean
    token?: string
  } = {}) => {
    vi.mocked(sendOwnerEmail).mockResolvedValue({
      data: 'step-token',
      result: 'success',
    } as unknown as Awaited<ReturnType<typeof sendOwnerEmail>>)
    vi.mocked(verifyOwnerEmail).mockResolvedValue({
      is_valid: isValid,
      token,
      result: 'success',
    } as unknown as Awaited<ReturnType<typeof verifyOwnerEmail>>)
  }

  const goToTransferStep = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole('button', { name: /members\.transferModal\.sendVerifyCode/i }))
    const input = await screen.findByTestId('transfer-modal-code-input')
    await user.type(input, '123456')
    await user.click(screen.getByTestId('transfer-modal-continue'))
  }

  const selectNewOwnerAndSubmit = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole('button', { name: /select member/i }))
    await user.click(screen.getByTestId('transfer-modal-submit'))
  }

  it('should complete ownership transfer flow through all steps', async () => {
    const user = userEvent.setup()
    mockEmailVerification()
    vi.mocked(ownershipTransfer).mockResolvedValue({
      result: 'success',
    } as unknown as Awaited<ReturnType<typeof ownershipTransfer>>)

    renderModal()
    await goToTransferStep(user)
    expect(await screen.findByText(/members\.transferModal\.transferLabel/i)).toBeInTheDocument()
    await selectNewOwnerAndSubmit(user)

    await waitFor(() => {
      expect(ownershipTransfer).toHaveBeenCalledWith('new-owner-id', { token: 'final-token' })
      expect(window.location.reload).toHaveBeenCalled()
    }, { timeout: 10000 })
  }, 15000)

  it('should handle timer countdown and resend', async () => {
    vi.useFakeTimers()
    vi.mocked(sendOwnerEmail).mockResolvedValue({ data: 'token', result: 'success' } as unknown as Awaited<ReturnType<typeof sendOwnerEmail>>)

    renderModal()
    // Trigger the email send (which starts the timer)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /members\.transferModal\.sendVerifyCode/i }))
    })

    // Step Verify shows up
    expect(screen.getByText(/members\.transferModal\.verifyEmail/i)).toBeInTheDocument()
    expect(screen.getByText(/members\.transferModal\.resendCount/i)).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(screen.getByText(/59/)).toBeInTheDocument()

    // Fast forward to finish and trigger clearInterval
    act(() => {
      vi.advanceTimersByTime(60000)
    })
    expect(screen.queryByText(/members\.transferModal\.resendCount/i)).not.toBeInTheDocument()

    const resendBtn = screen.getByRole('button', { name: /members\.transferModal\.resend/i })
    await act(async () => {
      fireEvent.click(resendBtn)
    })
    expect(sendOwnerEmail).toHaveBeenCalledTimes(2)

    vi.useRealTimers()
  })

  it('should show error when email verification returns invalid code', async () => {
    const user = userEvent.setup()
    mockEmailVerification({ isValid: false, token: 'step-token' })
    renderModal()
    await goToTransferStep(user)

    await waitFor(() => {
      expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({
        type: 'error',
        message: 'Verifying email failed',
      }))
    })
  })

  it('should show error when verifying email throws an error', async () => {
    const user = userEvent.setup()
    mockEmailVerification()
    vi.mocked(verifyOwnerEmail).mockRejectedValue(new Error('verification crash'))

    renderModal()
    await goToTransferStep(user)

    await waitFor(() => {
      expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({
        type: 'error',
        message: expect.stringContaining('verification crash'),
      }))
    })
  })

  it('should not show a modal-level toast and should stay on start step when sending verification email fails', async () => {
    const user = userEvent.setup()
    vi.mocked(sendOwnerEmail).mockRejectedValue(new Error('network error'))
    renderModal()
    await user.click(screen.getByRole('button', { name: /members\.transferModal\.sendVerifyCode/i }))

    // The base service layer surfaces the real backend error. The modal itself
    // must NOT show an additional toast (e.g. "Error sending verification code: undefined").
    await waitFor(() => {
      expect(sendOwnerEmail).toHaveBeenCalled()
    })
    expect(mockNotify).not.toHaveBeenCalled()
    // Should remain on the start step instead of advancing to the verify step.
    expect(screen.getByRole('button', { name: /members\.transferModal\.sendVerifyCode/i })).toBeInTheDocument()
  })

  it('should show error when ownership transfer fails', async () => {
    const user = userEvent.setup()
    mockEmailVerification()
    vi.mocked(ownershipTransfer).mockRejectedValue(new Error('transfer failed'))
    renderModal()
    await goToTransferStep(user)
    await selectNewOwnerAndSubmit(user)

    await waitFor(() => {
      expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({
        type: 'error',
        message: expect.stringContaining('transfer failed'),
      }))
    })
  })

  it('should handle sendOwnerEmail returning null data', async () => {
    const user = userEvent.setup()
    vi.mocked(sendOwnerEmail).mockResolvedValue({
      data: null,
      result: 'success',
    } as unknown as Awaited<ReturnType<typeof sendOwnerEmail>>)

    renderModal()
    await user.click(screen.getByRole('button', { name: /members\.transferModal\.sendVerifyCode/i }))

    // Should advance to verify step even with null data
    await waitFor(() => {
      expect(screen.getByText(/members\.transferModal\.verifyEmail/i)).toBeInTheDocument()
    })
  })

  it('should swallow null rejection from sendOwnerEmail without showing a modal-level toast', async () => {
    const user = userEvent.setup()
    vi.mocked(sendOwnerEmail).mockRejectedValue(null)

    renderModal()
    await user.click(screen.getByRole('button', { name: /members\.transferModal\.sendVerifyCode/i }))

    await waitFor(() => {
      expect(sendOwnerEmail).toHaveBeenCalled()
    })
    expect(mockNotify).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /members\.transferModal\.sendVerifyCode/i })).toBeInTheDocument()
  })

  it('should show fallback error prefix when verifyOwnerEmail throws null', async () => {
    const user = userEvent.setup()
    mockEmailVerification()
    vi.mocked(verifyOwnerEmail).mockRejectedValue(null)

    renderModal()
    await goToTransferStep(user)

    await waitFor(() => {
      expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({
        type: 'error',
        message: expect.stringContaining('Error verifying email:'),
      }))
    })
  })

  it('should show fallback error prefix when ownershipTransfer throws null', async () => {
    const user = userEvent.setup()
    mockEmailVerification()
    vi.mocked(ownershipTransfer).mockRejectedValue(null)

    renderModal()
    await goToTransferStep(user)
    await selectNewOwnerAndSubmit(user)

    await waitFor(() => {
      expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({
        type: 'error',
        message: expect.stringContaining('Error ownership transfer:'),
      }))
    })
  })

  it('should close when close button is clicked', async () => {
    const user = userEvent.setup()
    renderModal()
    await user.click(screen.getByRole('button', { name: /operation\.close$/ }))
    expect(mockOnClose).toHaveBeenCalled()
  })

  it('should close when cancel button is clicked', async () => {
    const user = userEvent.setup()
    renderModal()
    await user.click(screen.getByTestId('transfer-modal-cancel'))
    expect(mockOnClose).toHaveBeenCalled()
  })
})
