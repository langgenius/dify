import type { InitValidateStatusResponse, SetupStatusResponse } from '@/models/common'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import useDocumentTitle from '@/hooks/use-document-title'
import {
  fetchInitValidateStatus,
  fetchSetupStatus,
  sendForgotPasswordEmail,
} from '@/service/common'
import ForgotPasswordForm from './ForgotPasswordForm'

vi.mock('@/service/common', () => ({
  fetchSetupStatus: vi.fn(),
  fetchInitValidateStatus: vi.fn(),
  sendForgotPasswordEmail: vi.fn(),
}))

vi.mock('@/hooks/use-document-title', () => ({
  __esModule: true,
  default: vi.fn(),
}))

const mockFetchSetupStatus = vi.mocked(fetchSetupStatus)
const mockFetchInitValidateStatus = vi.mocked(fetchInitValidateStatus)
const mockSendForgotPasswordEmail = vi.mocked(sendForgotPasswordEmail)
const mockUseDocumentTitle = vi.mocked(useDocumentTitle)

const prepareLoadedState = () => {
  mockFetchSetupStatus.mockResolvedValue({ step: 'not_started' } as SetupStatusResponse)
  mockFetchInitValidateStatus.mockResolvedValue({
    status: 'finished',
  } as InitValidateStatusResponse)
}

describe('ForgotPasswordForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prepareLoadedState()
  })

  it('should render form after loading', async () => {
    render(<ForgotPasswordForm />)

    expect(mockUseDocumentTitle).toHaveBeenLastCalledWith('common.loading')
    expect(await screen.findByLabelText('login.email')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('login.forgotPassword')
    expect(mockUseDocumentTitle).toHaveBeenLastCalledWith('login.forgotPassword')
  })

  it('should show validation error when email is empty', async () => {
    const user = userEvent.setup()
    render(<ForgotPasswordForm />)

    const emailInput = await screen.findByLabelText('login.email')

    await user.click(screen.getByRole('button', { name: /login\.sendResetLink/ }))

    const error = await screen.findByText('login.error.emailInValid')
    expect(error).toHaveTextContent('login.error.emailInValid')
    expect(emailInput).toHaveAttribute('aria-invalid', 'true')
    expect(emailInput).toHaveAccessibleDescription('login.error.emailInValid')
    expect(emailInput).toHaveFocus()
    expect(mockSendForgotPasswordEmail).not.toHaveBeenCalled()
  })

  it('should reject an email that only passes native validation', async () => {
    const user = userEvent.setup()
    render(<ForgotPasswordForm />)

    const emailInput = await screen.findByLabelText('login.email')
    await user.type(emailInput, 'test@example')
    await user.click(screen.getByRole('button', { name: /login\.sendResetLink/ }))

    await screen.findByText('login.error.emailInValid')
    expect(emailInput).toHaveAttribute('aria-invalid', 'true')
    expect(emailInput).toHaveFocus()
    expect(mockSendForgotPasswordEmail).not.toHaveBeenCalled()
  })

  it('should send the reset email and show a sign-in link after confirmation', async () => {
    const user = userEvent.setup()
    mockSendForgotPasswordEmail.mockResolvedValue({ result: 'success', data: 'ok' } as any)

    render(<ForgotPasswordForm />)

    const emailInput = await screen.findByLabelText('login.email')
    await user.type(emailInput, 'test@example.com')

    await user.click(screen.getByRole('button', { name: /login\.sendResetLink/ }))

    await waitFor(() => {
      expect(mockSendForgotPasswordEmail).toHaveBeenCalledWith({
        url: '/forgot-password',
        body: { email: 'test@example.com' },
      })
    })

    await waitFor(() => {
      expect(screen.getByRole('link', { name: /login\.backToSignIn/ })).toHaveAttribute(
        'href',
        '/signin',
      )
    })
    expect(mockUseDocumentTitle).toHaveBeenLastCalledWith('login.resetLinkSent')
  })

  it('should submit when form is submitted', async () => {
    const user = userEvent.setup()
    mockSendForgotPasswordEmail.mockResolvedValue({ result: 'success', data: 'ok' } as any)

    render(<ForgotPasswordForm />)

    await user.type(await screen.findByLabelText('login.email'), 'test@example.com')
    await user.keyboard('{Enter}')

    await waitFor(() => {
      expect(mockSendForgotPasswordEmail).toHaveBeenCalledWith({
        url: '/forgot-password',
        body: { email: 'test@example.com' },
      })
    })
  })

  it('should disable submit while request is in flight', async () => {
    const user = userEvent.setup()
    let resolveRequest: ((value: any) => void) | undefined
    const requestPromise = new Promise((resolve) => {
      resolveRequest = resolve
    })
    mockSendForgotPasswordEmail.mockReturnValue(requestPromise as any)

    render(<ForgotPasswordForm />)

    await user.type(await screen.findByLabelText('login.email'), 'test@example.com')

    const button = screen.getByRole('button', { name: /login\.sendResetLink/ })
    await user.click(button)

    await waitFor(() => {
      expect(button).toHaveAttribute('aria-disabled', 'true')
    })

    await user.click(button)
    expect(mockSendForgotPasswordEmail).toHaveBeenCalledTimes(1)

    resolveRequest?.({ result: 'success', data: 'ok' })

    await waitFor(() => {
      expect(screen.getByRole('link', { name: /login\.backToSignIn/ })).toBeInTheDocument()
    })
  })

  it('should keep form state when request fails', async () => {
    const user = userEvent.setup()
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockSendForgotPasswordEmail.mockResolvedValue({ result: 'fail', data: 'error' } as any)

    render(<ForgotPasswordForm />)

    await user.type(await screen.findByLabelText('login.email'), 'test@example.com')
    await user.click(screen.getByRole('button', { name: /login\.sendResetLink/ }))

    await waitFor(() => {
      expect(mockSendForgotPasswordEmail).toHaveBeenCalledTimes(1)
    })

    expect(screen.getByRole('button', { name: /login\.sendResetLink/ })).toBeInTheDocument()

    consoleSpy.mockRestore()
  })

  it('should redirect to init when status is not started', async () => {
    const originalLocation = window.location
    Object.defineProperty(window, 'location', {
      value: { href: '' },
      writable: true,
    })
    mockFetchInitValidateStatus.mockResolvedValue({
      status: 'not_started',
    } as InitValidateStatusResponse)

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
