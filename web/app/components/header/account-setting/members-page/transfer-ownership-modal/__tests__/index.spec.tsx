import type { ConsoleStateFixture } from '@/test/console/state-fixture'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vite-plus/test'
import { consoleClient } from '@/service/console'
import { createAccountProfileQueryWrapper } from '@/test/console/account-profile'
import { render } from '@/test/console/render'
import TransferOwnershipModal from '../index'

const { mockMembersHook } = vi.hoisted(() => ({
  mockMembersHook: vi.fn(),
}))

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const { mockConsoleOperationHooks } = await import('@/test/console/operation-hooks')
  return mockConsoleOperationHooks(await importOriginal(), {
    'workspaces.current.members.get': () => mockMembersHook(),
  })
})

const toastMocks = vi.hoisted(() => ({
  mockNotify: vi.fn(),
}))
const mockConsoleState = vi.hoisted(() => ({
  current: {} as Partial<ConsoleStateFixture>,
}))
const mockConsoleStateReader = vi.hoisted(() => vi.fn())

vi.mock('@/context/workspace-state', async () => {
  const { createWorkspaceStateModuleMock } = await import('@/test/console/state-fixture')
  return createWorkspaceStateModuleMock(() => mockConsoleState.current)
})

vi.mock('@/service/console', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/console')>()),
  consoleClient: {
    workspaces: {
      current: {
        members: {
          byMemberId: {
            ownerTransfer: {
              post: vi.fn(),
            },
          },
          ownerTransferCheck: {
            post: vi.fn(),
          },
          sendOwnerTransferConfirmEmail: {
            post: vi.fn(),
          },
        },
      },
    },
  },
}))
vi.mock('@/app/notifications', () => ({
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

    const consoleState = {
      currentWorkspace: { name: 'Test Workspace' },
      userProfile: { email: 'owner@example.com', id: 'owner-id' },
    } as ConsoleStateFixture
    mockConsoleState.current = consoleState
    mockConsoleStateReader.mockReturnValue(consoleState)

    vi.mocked(mockMembersHook).mockReturnValue({
      data: { accounts: [] },
    })

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

  const renderModal = () =>
    render(
      <>
        <TransferOwnershipModal show onClose={mockOnClose} />
      </>,
      {
        wrapper: createAccountProfileQueryWrapper(mockConsoleState.current.userProfile ?? {}),
      },
    )

  const mockEmailVerification = ({
    isValid = true,
    token = 'final-token',
  }: {
    isValid?: boolean
    token?: string
  } = {}) => {
    vi.mocked(
      consoleClient.workspaces.current.members.sendOwnerTransferConfirmEmail.post,
    ).mockResolvedValue({
      data: 'step-token',
      result: 'success',
    })
    vi.mocked(consoleClient.workspaces.current.members.ownerTransferCheck.post).mockResolvedValue({
      email: 'owner@example.com',
      is_valid: isValid,
      token,
    })
  }

  const goToTransferStep = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(
      screen.getByRole('button', { name: /members\.transferModal\.sendVerifyCode/i }),
    )
    const input = await screen.findByPlaceholderText(/members\.transferModal\.codePlaceholder/i)
    await user.type(input, '123456')
    await user.click(screen.getByRole('button', { name: /members\.transferModal\.continue/i }))
  }

  const selectNewOwnerAndSubmit = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole('button', { name: /select member/i }))
    await user.click(screen.getByRole('button', { name: /members\.transferModal\.transfer$/i }))
  }

  it('should complete ownership transfer flow through all steps', async () => {
    const user = userEvent.setup()
    mockEmailVerification()
    vi.mocked(
      consoleClient.workspaces.current.members.byMemberId.ownerTransfer.post,
    ).mockResolvedValue({
      result: 'success',
    })

    renderModal()
    await goToTransferStep(user)
    expect(await screen.findByText(/members\.transferModal\.transferLabel/i)).toBeInTheDocument()
    await selectNewOwnerAndSubmit(user)

    await waitFor(
      () => {
        expect(
          consoleClient.workspaces.current.members.byMemberId.ownerTransfer.post,
        ).toHaveBeenCalledWith({
          params: { member_id: 'new-owner-id' },
          body: { token: 'final-token' },
        })
        expect(window.location.reload).toHaveBeenCalled()
      },
      { timeout: 10000 },
    )
  }, 15000)

  it('should handle timer countdown and resend', async () => {
    vi.useFakeTimers()
    vi.mocked(
      consoleClient.workspaces.current.members.sendOwnerTransferConfirmEmail.post,
    ).mockResolvedValue({
      data: 'token',
      result: 'success',
    })

    renderModal()
    // Trigger the email send (which starts the timer)
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: /members\.transferModal\.sendVerifyCode/i }),
      )
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
    expect(
      consoleClient.workspaces.current.members.sendOwnerTransferConfirmEmail.post,
    ).toHaveBeenCalledTimes(2)

    vi.useRealTimers()
  })

  it('should show error when email verification returns invalid code', async () => {
    const user = userEvent.setup()
    mockEmailVerification({ isValid: false, token: 'step-token' })
    renderModal()
    await goToTransferStep(user)

    await waitFor(() => {
      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'error',
          message: 'Verifying email failed',
        }),
      )
    })
  })

  it('should show error when verifying email throws an error', async () => {
    const user = userEvent.setup()
    mockEmailVerification()
    vi.mocked(consoleClient.workspaces.current.members.ownerTransferCheck.post).mockRejectedValue(
      new Error('verification crash'),
    )

    renderModal()
    await goToTransferStep(user)

    await waitFor(() => {
      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'error',
          message: expect.stringContaining('verification crash'),
        }),
      )
    })
  })

  it('should not show a modal-level toast and should stay on start step when sending verification email fails', async () => {
    const user = userEvent.setup()
    vi.mocked(
      consoleClient.workspaces.current.members.sendOwnerTransferConfirmEmail.post,
    ).mockRejectedValue(new Error('network error'))
    renderModal()
    await user.click(
      screen.getByRole('button', { name: /members\.transferModal\.sendVerifyCode/i }),
    )

    // The base service layer surfaces the real backend error. The modal itself
    // must NOT show an additional toast (e.g. "Error sending verification code: undefined").
    await waitFor(() => {
      expect(
        consoleClient.workspaces.current.members.sendOwnerTransferConfirmEmail.post,
      ).toHaveBeenCalled()
    })
    expect(mockNotify).not.toHaveBeenCalled()
    // Should remain on the start step instead of advancing to the verify step.
    expect(
      screen.getByRole('button', { name: /members\.transferModal\.sendVerifyCode/i }),
    ).toBeInTheDocument()
  })

  it('should show error when ownership transfer fails', async () => {
    const user = userEvent.setup()
    mockEmailVerification()
    vi.mocked(
      consoleClient.workspaces.current.members.byMemberId.ownerTransfer.post,
    ).mockRejectedValue(new Error('transfer failed'))
    renderModal()
    await goToTransferStep(user)
    await selectNewOwnerAndSubmit(user)

    await waitFor(() => {
      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'error',
          message: expect.stringContaining('transfer failed'),
        }),
      )
    })
  })

  it('should handle sendOwnerEmail returning an empty step token', async () => {
    const user = userEvent.setup()
    vi.mocked(
      consoleClient.workspaces.current.members.sendOwnerTransferConfirmEmail.post,
    ).mockResolvedValue({
      data: '',
      result: 'success',
    })

    renderModal()
    await user.click(
      screen.getByRole('button', { name: /members\.transferModal\.sendVerifyCode/i }),
    )

    // Should advance to verify step even without a step token
    await waitFor(() => {
      expect(screen.getByText(/members\.transferModal\.verifyEmail/i)).toBeInTheDocument()
    })
  })

  it('should swallow null rejection from sendOwnerEmail without showing a modal-level toast', async () => {
    const user = userEvent.setup()
    vi.mocked(
      consoleClient.workspaces.current.members.sendOwnerTransferConfirmEmail.post,
    ).mockRejectedValue(null)

    renderModal()
    await user.click(
      screen.getByRole('button', { name: /members\.transferModal\.sendVerifyCode/i }),
    )

    await waitFor(() => {
      expect(
        consoleClient.workspaces.current.members.sendOwnerTransferConfirmEmail.post,
      ).toHaveBeenCalled()
    })
    expect(mockNotify).not.toHaveBeenCalled()
    expect(
      screen.getByRole('button', { name: /members\.transferModal\.sendVerifyCode/i }),
    ).toBeInTheDocument()
  })

  it('should show fallback error prefix when verifyOwnerEmail throws null', async () => {
    const user = userEvent.setup()
    mockEmailVerification()
    vi.mocked(consoleClient.workspaces.current.members.ownerTransferCheck.post).mockRejectedValue(
      null,
    )

    renderModal()
    await goToTransferStep(user)

    await waitFor(() => {
      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'error',
          message: expect.stringContaining('Error verifying email:'),
        }),
      )
    })
  })

  it('should show fallback error prefix when ownershipTransfer throws null', async () => {
    const user = userEvent.setup()
    mockEmailVerification()
    vi.mocked(
      consoleClient.workspaces.current.members.byMemberId.ownerTransfer.post,
    ).mockRejectedValue(null)

    renderModal()
    await goToTransferStep(user)
    await selectNewOwnerAndSubmit(user)

    await waitFor(() => {
      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'error',
          message: expect.stringContaining('Error ownership transfer:'),
        }),
      )
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
    await user.click(screen.getByRole('button', { name: /operation\.cancel/i }))
    expect(mockOnClose).toHaveBeenCalled()
  })
})
