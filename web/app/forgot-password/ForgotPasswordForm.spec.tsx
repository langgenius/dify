import type { InitValidateStatusResponse, SetupStatusResponse } from '@/models/common'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { fetchInitValidateStatus, fetchSetupStatus, sendForgotPasswordEmail } from '@/service/common'
import ForgotPasswordForm from './ForgotPasswordForm'

const mockPush = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

vi.mock('@/service/common', () => ({
  fetchSetupStatus: vi.fn(),
  fetchInitValidateStatus: vi.fn(),
  sendForgotPasswordEmail: vi.fn(),
}))

const mockFetchSetupStatus = vi.mocked(fetchSetupStatus)
const mockFetchInitValidateStatus = vi.mocked(fetchInitValidateStatus)
const mockSendForgotPasswordEmail = vi.mocked(sendForgotPasswordEmail)

const prepareLoadedState = () => {
  mockFetchSetupStatus.mockResolvedValue({ step: 'not_started' } as SetupStatusResponse)
  mockFetchInitValidateStatus.mockResolvedValue({ status: 'finished' } as InitValidateStatusResponse)
}

describe('ForgotPasswordForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prepareLoadedState()
  })

  it('should render form after loading', async () => {
    render(<ForgotPasswordForm />)

    expect(await screen.findByLabelText('login.email')).toBeInTheDocument()
  })

  it('should show validation error when email is empty', async () => {
    render(<ForgotPasswordForm />)

    await screen.findByLabelText('login.email')

    fireEvent.click(screen.getByRole('button', { name: /login\.sendResetLink/ }))

    await waitFor(() => {
      expect(screen.getByText('login.error.emailInValid')).toBeInTheDocument()
    })
    expect(mockSendForgotPasswordEmail).not.toHaveBeenCalled()
  })

  it('should send reset email and navigate after confirmation', async () => {
    mockSendForgotPasswordEmail.mockResolvedValue({ result: 'success', data: 'ok' } as any)

    render(<ForgotPasswordForm />)

    const emailInput = await screen.findByLabelText('login.email')
    fireEvent.change(emailInput, { target: { value: 'test@example.com' } })

    fireEvent.click(screen.getByRole('button', { name: /login\.sendResetLink/ }))

    await waitFor(() => {
      expect(mockSendForgotPasswordEmail).toHaveBeenCalledWith({
        url: '/forgot-password',
        body: { email: 'test@example.com' },
      })
    })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /login\.backToSignIn/ })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /login\.backToSignIn/ }))
    expect(mockPush).toHaveBeenCalledWith('/signin')
  })

  it('should submit when form is submitted', async () => {
    mockSendForgotPasswordEmail.mockResolvedValue({ result: 'success', data: 'ok' } as any)

    render(<ForgotPasswordForm />)

    fireEvent.change(await screen.findByLabelText('login.email'), { target: { value: 'test@example.com' } })

    const form = screen.getByRole('button', { name: /login\.sendResetLink/ }).closest('form')
    expect(form).not.toBeNull()

    fireEvent.submit(form as HTMLFormElement)

    await waitFor(() => {
      expect(mockSendForgotPasswordEmail).toHaveBeenCalledWith({
        url: '/forgot-password',
        body: { email: 'test@example.com' },
      })
    })
  })

  it('should disable submit while request is in flight', async () => {
    let resolveRequest: ((value: any) => void) | undefined
    const requestPromise = new Promise((resolve) => {
      resolveRequest = resolve
    })
    mockSendForgotPasswordEmail.mockReturnValue(requestPromise as any)

    render(<ForgotPasswordForm />)

    fireEvent.change(await screen.findByLabelText('login.email'), { target: { value: 'test@example.com' } })

    const button = screen.getByRole('button', { name: /login\.sendResetLink/ })
    fireEvent.click(button)

    await waitFor(() => {
      expect(button).toBeDisabled()
    })

    fireEvent.click(button)
    expect(mockSendForgotPasswordEmail).toHaveBeenCalledTimes(1)

    resolveRequest?.({ result: 'success', data: 'ok' })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /login\.backToSignIn/ })).toBeInTheDocument()
    })
  })

  it('should keep form state when request fails', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockSendForgotPasswordEmail.mockResolvedValue({ result: 'fail', data: 'error' } as any)

    render(<ForgotPasswordForm />)

    fireEvent.change(await screen.findByLabelText('login.email'), { target: { value: 'test@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: /login\.sendResetLink/ }))

    await waitFor(() => {
      expect(mockSendForgotPasswordEmail).toHaveBeenCalledTimes(1)
    })

    expect(screen.getByRole('button', { name: /login\.sendResetLink/ })).toBeInTheDocument()
    expect(mockPush).not.toHaveBeenCalled()

    consoleSpy.mockRestore()
  })

  it('should redirect to init when status is not started', async () => {
    const originalLocation = window.location
    Object.defineProperty(window, 'location', {
      value: { href: '' },
      writable: true,
    })
    mockFetchInitValidateStatus.mockResolvedValue({ status: 'not_started' } as InitValidateStatusResponse)

    render(<ForgotPasswordForm />)

    await waitFor(() => {
      expect(window.location.href).toBe('/init')
    })

    Object.defineProperty(window, 'location', {
      value: originalLocation,
      writable: true,
    })
  })
})
