import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { consoleClient } from '@/service/console'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import ForgotPasswordForm from './ForgotPasswordForm'

vi.mock('@/service/console', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/console')>()),
  consoleClient: {
    setup: {
      get: vi.fn(),
    },
    init: {
      get: vi.fn(),
    },
    forgotPassword: {
      post: vi.fn(),
    },
  },
}))

const mockFetchSetupStatus = vi.mocked(consoleClient.setup.get)
const mockFetchInitValidateStatus = vi.mocked(consoleClient.init.get)
const mockSendForgotPasswordEmail = vi.mocked(consoleClient.forgotPassword.post)

const prepareLoadedState = () => {
  mockFetchSetupStatus.mockResolvedValue({ step: 'not_started' })
  mockFetchInitValidateStatus.mockResolvedValue({
    status: 'finished',
  })
}

describe('ForgotPasswordForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prepareLoadedState()
  })

  it('should render form after loading', async () => {
    render(<ForgotPasswordForm />)

    expect(document.title).toBe('common.loading - Dify')
    expect(await screen.findByLabelText('login.email')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('login.forgotPassword')
    expect(document.title).toBe('login.forgotPassword - Dify')
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
    mockSendForgotPasswordEmail.mockResolvedValue({ result: 'success', data: 'ok' })

    render(<ForgotPasswordForm />)

    const emailInput = await screen.findByLabelText('login.email')
    await user.type(emailInput, 'test@example.com')

    await user.keyboard('{Enter}')

    await waitFor(() => {
      expect(mockSendForgotPasswordEmail).toHaveBeenCalledWith({
        body: { email: 'test@example.com' },
      })
    })

    await waitFor(() => {
      expect(screen.getByRole('link', { name: /login\.backToSignIn/ })).toHaveAttribute(
        'href',
        '/signin',
      )
    })
    expect(document.title).toBe('login.resetLinkSent - Dify')
  })

  it('should disable submit while request is in flight', async () => {
    const user = userEvent.setup()
    let resolveRequest:
      | ((value: Awaited<ReturnType<typeof consoleClient.forgotPassword.post>>) => void)
      | undefined
    const requestPromise = new Promise<
      Awaited<ReturnType<typeof consoleClient.forgotPassword.post>>
    >((resolve) => {
      resolveRequest = resolve
    })
    mockSendForgotPasswordEmail.mockReturnValue(requestPromise)

    render(<ForgotPasswordForm />)

    await user.type(await screen.findByLabelText('login.email'), 'test@example.com')

    const button = screen.getByRole('button', { name: /login\.sendResetLink/ })
    await user.click(button)

    await waitFor(() => {
      expect(button).toHaveAttribute('aria-disabled', 'true')
    })

    await user.click(button)
    expect(mockSendForgotPasswordEmail).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveRequest?.({ result: 'success', data: 'ok' })
    })

    await waitFor(() => {
      expect(screen.getByRole('link', { name: /login\.backToSignIn/ })).toBeInTheDocument()
    })
  })

  it('should keep form state when request fails', async () => {
    const user = userEvent.setup()
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockSendForgotPasswordEmail.mockResolvedValue({ result: 'fail', data: 'error' })

    render(<ForgotPasswordForm />)

    await user.type(await screen.findByLabelText('login.email'), 'test@example.com')
    await user.click(screen.getByRole('button', { name: /login\.sendResetLink/ }))

    await waitFor(() => {
      expect(mockSendForgotPasswordEmail).toHaveBeenCalledTimes(1)
    })

    expect(screen.getByLabelText('login.email')).toHaveValue('test@example.com')
    expect(screen.getByRole('button', { name: /login\.sendResetLink/ })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    )

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
    })

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
