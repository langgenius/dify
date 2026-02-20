import type { AppContextValue } from '@/context/app-context'
import type { ICurrentWorkspace } from '@/models/common'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { ToastContext } from '@/app/components/base/toast'
import { useAppContext } from '@/context/app-context'
import { ownershipTransfer, sendOwnerEmail, verifyOwnerEmail } from '@/service/common'
import TransferOwnershipModal from './index'

vi.mock('@/context/app-context')
vi.mock('@/service/common')

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
    vi.spyOn(globalThis, 'setInterval').mockImplementation(() => 0 as unknown as ReturnType<typeof setInterval>)
    vi.spyOn(globalThis, 'clearInterval').mockImplementation(() => {})

    vi.mocked(useAppContext).mockReturnValue({
      currentWorkspace: { name: 'Test Workspace' } as ICurrentWorkspace,
      userProfile: { email: 'owner@example.com', id: 'owner-id' },
    } as unknown as AppContextValue)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
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
    } as Awaited<ReturnType<typeof sendOwnerEmail>>)
    vi.mocked(verifyOwnerEmail).mockResolvedValue({
      is_valid: isValid,
      token,
      result: 'success',
    } as Awaited<ReturnType<typeof verifyOwnerEmail>>)
  }

  const goToTransferStep = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole('button', { name: /members\.transferModal\.sendVerifyCode/i }))
    await user.type(screen.getByPlaceholderText(/members\.transferModal\.codePlaceholder/i), '123456')
    await user.click(screen.getByRole('button', { name: /members\.transferModal\.continue/i }))
  }

  const selectNewOwnerAndSubmit = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole('button', { name: /select member/i }))
    await user.click(screen.getByRole('button', { name: /members\.transferModal\.transfer$/i }))
  }

  it('should complete ownership transfer flow through all steps', async () => {
    const user = userEvent.setup()

    mockEmailVerification()
    vi.mocked(ownershipTransfer).mockResolvedValue({
      result: 'success',
    } as Awaited<ReturnType<typeof ownershipTransfer>>)

    const mockReload = vi.fn()
    vi.stubGlobal('location', { ...window.location, reload: mockReload })

    renderModal()

    await goToTransferStep(user)

    expect(await screen.findByText(/members\.transferModal\.transferLabel/i)).toBeInTheDocument()

    await selectNewOwnerAndSubmit(user)

    await waitFor(() => {
      expect(ownershipTransfer).toHaveBeenCalledWith('new-owner-id', { token: 'final-token' })
      expect(mockReload).toHaveBeenCalled()
    })
  }, 15000)

  it('should show error when email verification returns invalid code', async () => {
    const user = userEvent.setup()

    mockEmailVerification({ isValid: false, token: 'step-token' })

    renderModal()

    await goToTransferStep(user)

    await waitFor(() => {
      expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({
        type: 'error',
      }))
    })
  })

  it('should show error when sending verification email fails', async () => {
    const user = userEvent.setup()

    vi.mocked(sendOwnerEmail).mockRejectedValue(new Error('network error'))

    renderModal()

    await user.click(screen.getByRole('button', { name: /members\.transferModal\.sendVerifyCode/i }))

    await waitFor(() => {
      expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({
        type: 'error',
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
      }))
    })
  })
})
