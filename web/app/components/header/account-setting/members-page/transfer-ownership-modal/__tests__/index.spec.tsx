import type { ConsoleStateFixture } from '@/test/console/state-fixture'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vite-plus/test'
import { consoleClient, consoleQuery } from '@/service/console'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { render } from '@/test/console/render'
import TransferOwnershipModal from '../index'

const toastMocks = vi.hoisted(() => ({
  mockNotify: vi.fn(),
}))
const mockConsoleState = vi.hoisted(() => ({
  current: {} as Partial<ConsoleStateFixture>,
}))

vi.mock('@/context/workspace-state', async () => {
  const { createWorkspaceStateModuleMock } = await import('@/test/console/state-fixture')
  return createWorkspaceStateModuleMock(() => mockConsoleState.current)
})

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, {
      'workspaces.current.members.byMemberId.ownerTransfer.post': vi.fn(),
      'workspaces.current.members.ownerTransferCheck.post': vi.fn(),
      'workspaces.current.members.sendOwnerTransferConfirmEmail.post': vi.fn(),
    }),
  }
})
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

describe('TransferOwnershipModal', () => {
  const mockOnClose = vi.fn()
  const { mockNotify } = toastMocks

  beforeEach(() => {
    vi.resetAllMocks()

    const consoleState = {
      currentWorkspace: { name: 'Test Workspace' },
      userProfile: { email: 'owner@example.com', avatar_url: null, id: 'owner-id' },
    } as unknown as ConsoleStateFixture
    mockConsoleState.current = consoleState
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

  const renderModal = () => {
    const { queryClient, wrapper } = createConsoleQueryWrapper({
      accountProfile: mockConsoleState.current.userProfile,
    })
    queryClient.setQueryData(consoleQuery.workspaces.current.members.get.queryKey({ input: {} }), {
      accounts: [
        {
          id: 'owner-id',
          name: 'Current Owner',
          email: 'owner@example.com',
          role: 'owner',
          status: 'active',
          avatar_url: null,
        },
        {
          id: 'new-owner-id',
          name: 'New Owner',
          email: 'new@example.com',
          role: 'admin',
          status: 'active',
          avatar_url: null,
        },
      ],
    })
    return render(<TransferOwnershipModal show onClose={mockOnClose} />, { wrapper })
  }

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
    const transfer = screen.getByRole('button', { name: /members\.transferModal\.transfer$/i })
    expect(transfer).toBeDisabled()
    await user.click(
      screen.getByRole('button', { name: /members\.transferModal\.transferPlaceholder/i }),
    )
    expect(screen.queryByRole('button', { name: /Current Owner/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /New Owner/ }))
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
    expect(
      consoleClient.workspaces.current.members.sendOwnerTransferConfirmEmail.post,
    ).toHaveBeenCalledWith({ body: {} })
    expect(consoleClient.workspaces.current.members.ownerTransferCheck.post).toHaveBeenCalledWith({
      body: { code: '123456', token: 'step-token' },
    })
    expect(await screen.findByText(/members\.transferModal\.transferLabel/i)).toBeInTheDocument()
    await selectNewOwnerAndSubmit(user)

    await waitFor(() => {
      expect(
        consoleClient.workspaces.current.members.byMemberId.ownerTransfer.post,
      ).toHaveBeenCalledWith({
        params: { member_id: 'new-owner-id' },
        body: { token: 'final-token' },
      })
      expect(window.location.reload).toHaveBeenCalled()
    })
  })

  it('should handle timer countdown and resend', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const user = userEvent.setup()
    vi.mocked(
      consoleClient.workspaces.current.members.sendOwnerTransferConfirmEmail.post,
    ).mockResolvedValue({
      data: 'token',
      result: 'success',
    })

    renderModal()
    // Trigger the email send (which starts the timer)
    await user.click(
      screen.getByRole('button', { name: /members\.transferModal\.sendVerifyCode/i }),
    )

    // Step Verify shows up
    expect(screen.getByText(/members\.transferModal\.verifyEmail/i)).toBeInTheDocument()
    expect(screen.getByText(/members\.transferModal\.resendCount/i)).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(screen.getByText(/59/)).toBeInTheDocument()

    // Fast forward to finish and trigger clearInterval
    await act(async () => vi.advanceTimersByTimeAsync(59000))
    expect(screen.queryByText(/members\.transferModal\.resendCount/i)).not.toBeInTheDocument()

    const resendBtn = screen.getByRole('button', { name: /members\.transferModal\.resend/i })
    await user.click(resendBtn)
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
