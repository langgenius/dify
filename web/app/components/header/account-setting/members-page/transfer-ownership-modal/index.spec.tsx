import type { AppContextValue } from '@/context/app-context'
import type { ICurrentWorkspace } from '@/models/common'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { ToastContext } from '@/app/components/base/toast'
import { useAppContext } from '@/context/app-context'
import { ownershipTransfer, sendOwnerEmail, verifyOwnerEmail } from '@/service/common'
import { useMembers } from '@/service/use-common'
import TransferOwnershipModal from './index'

vi.mock('@/context/app-context')
vi.mock('@/service/common')
vi.mock('@/service/use-common')

// Mock Modal directly to avoid transition/portal issues in tests
vi.mock('@/app/components/base/modal', () => ({
  default: ({ children, isShow }: { children: React.ReactNode, isShow: boolean }) => isShow ? <div data-testid="mock-modal">{children}</div> : null,
}))

vi.mock('./member-selector', () => ({
  default: ({ onSelect }: { onSelect: (id: string) => void }) => (
    <button onClick={() => onSelect('new-owner-id')}>Select member</button>
  ),
}))

describe('TransferOwnershipModal', () => {
  const mockOnClose = vi.fn()
  const mockNotify = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()

    vi.mocked(useAppContext).mockReturnValue({
      currentWorkspace: { name: 'Test Workspace' } as ICurrentWorkspace,
      userProfile: { email: 'owner@example.com', id: 'owner-id' },
    } as unknown as AppContextValue)

    vi.mocked(useMembers).mockReturnValue({
      data: { accounts: [] },
    } as unknown as ReturnType<typeof useMembers>)

    // Fix Location stubbing for reload
    const mockReload = vi.fn()
    vi.stubGlobal('location', {
      ...window.location,
      reload: mockReload,
    } as unknown as Location)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  const renderModal = () => render(
    <ToastContext.Provider value={{ notify: mockNotify, close: vi.fn() }}>
      <TransferOwnershipModal show onClose={mockOnClose} />
    </ToastContext.Provider>,
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
    await user.click(screen.getByTestId('transfer-modal-send-code'))
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
    })
  })

  it('should handle timer countdown and resend', async () => {
    vi.useFakeTimers()
    vi.mocked(sendOwnerEmail).mockResolvedValue({ data: 'token', result: 'success' } as unknown as Awaited<ReturnType<typeof sendOwnerEmail>>)

    renderModal()
    // Trigger the email send (which starts the timer)
    await act(async () => {
      fireEvent.click(screen.getByTestId('transfer-modal-send-code'))
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

    const resendBtn = screen.getByTestId('transfer-modal-resend')
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

  it('should show error when sending verification email fails', async () => {
    const user = userEvent.setup()
    vi.mocked(sendOwnerEmail).mockRejectedValue(new Error('network error'))
    renderModal()
    await user.click(screen.getByTestId('transfer-modal-send-code'))

    await waitFor(() => {
      expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({
        type: 'error',
        message: expect.stringContaining('network error'),
      }))
    })
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

  it('should close when close button is clicked', async () => {
    const user = userEvent.setup()
    renderModal()
    await user.click(screen.getByTestId('transfer-modal-close'))
    expect(mockOnClose).toHaveBeenCalled()
  })

  it('should close when cancel button is clicked', async () => {
    const user = userEvent.setup()
    renderModal()
    await user.click(screen.getByTestId('transfer-modal-cancel'))
    expect(mockOnClose).toHaveBeenCalled()
  })
})
