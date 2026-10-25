import type { ReactElement } from 'react'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ErrorBoundary from '@/app/components/base/error-boundary'
import { consoleClient, consoleQuery } from '@/service/console'
import { expectLoadingButton } from '@/test/button'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { encryptPassword } from '@/utils/encryption'
import InstallForm from './installForm'

const render = (ui: ReactElement) => renderWithConsoleQuery(ui)

const mockPush = vi.fn()
const mockReplace = vi.fn()

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleClientResponses, withConsoleResponses } =
    await import('@/test/console/service-responses')
  const responses = {
    'setup.get': vi.fn(),
    'setup.post': vi.fn(),
    'init.get': vi.fn(),
    'login.post': vi.fn(),
  }
  return {
    ...actual,
    consoleClient: withConsoleClientResponses(actual.consoleClient, responses),
    consoleQuery: withConsoleResponses(actual.consoleQuery, responses),
  }
})

const mockFetchSetupStatus = vi.mocked(consoleClient.setup.get)
const mockFetchInitValidateStatus = vi.mocked(consoleClient.init.get)
const mockSetup = vi.mocked(consoleClient.setup.post)
const mockLogin = vi.mocked(consoleClient.login.post)

const createDeferredResponse = <T,>() => {
  let resolve: (value: T) => void
  const promise = new Promise<T>((onResolve) => {
    resolve = onResolve
  })
  return { promise, resolve: (value: T) => resolve(value) }
}

const prepareLoadedState = () => {
  mockFetchSetupStatus.mockResolvedValue({ step: 'not_started' })
  mockFetchInitValidateStatus.mockResolvedValue({
    status: 'finished',
  })
}

describe('InstallForm', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    prepareLoadedState()
  })

  it('should render form after loading', async () => {
    render(<InstallForm />)

    const emailInput = await screen.findByLabelText('login.email')
    const nameInput = screen.getByLabelText('login.name')
    const passwordInput = screen.getByLabelText('login.password')

    expect(emailInput).toHaveAttribute('type', 'email')
    expect(emailInput).toHaveAttribute('autocomplete', 'email')
    expect(nameInput).toHaveAttribute('autocomplete', 'name')
    expect(nameInput).toHaveAttribute('maxlength', '30')
    expect(passwordInput).toHaveAttribute('autocomplete', 'new-password')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('login.setAdminAccount')
    expect(screen.getByRole('button', { name: /login\.installBtn/ })).toBeInTheDocument()
  })

  it('waits for both bootstrap checks before showing the account form', async () => {
    const setupStatus =
      createDeferredResponse<Awaited<ReturnType<typeof consoleClient.setup.get>>>()
    const initStatus = createDeferredResponse<Awaited<ReturnType<typeof consoleClient.init.get>>>()
    mockFetchSetupStatus.mockReturnValue(setupStatus.promise)
    mockFetchInitValidateStatus.mockReturnValue(initStatus.promise)

    render(<InstallForm />)

    expect(screen.queryByLabelText('login.email')).not.toBeInTheDocument()
    expect(mockFetchInitValidateStatus).not.toHaveBeenCalled()

    await act(async () => setupStatus.resolve({ step: 'not_started' }))
    await waitFor(() => expect(mockFetchInitValidateStatus).toHaveBeenCalledTimes(1))
    expect(screen.queryByLabelText('login.email')).not.toBeInTheDocument()

    await act(async () => initStatus.resolve({ status: 'finished' }))
    expect(await screen.findByLabelText('login.email')).toBeInTheDocument()
  })

  it('redirects to initialization without showing the account form', async () => {
    mockFetchInitValidateStatus.mockResolvedValue({ status: 'not_started' })

    render(<InstallForm />)

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/init'))
    expect(screen.queryByLabelText('login.email')).not.toBeInTheDocument()
    expect(mockReplace).not.toHaveBeenCalled()
  })

  it('revalidates cached bootstrap state before displaying or redirecting', async () => {
    const queryClient = createConsoleQueryClient()
    queryClient.setQueryData(consoleQuery.setup.get.queryKey(), { step: 'finished' })
    queryClient.setQueryData(consoleQuery.init.get.queryKey(), { status: 'not_started' })
    const setupStatus =
      createDeferredResponse<Awaited<ReturnType<typeof consoleClient.setup.get>>>()
    const initStatus = createDeferredResponse<Awaited<ReturnType<typeof consoleClient.init.get>>>()
    mockFetchSetupStatus.mockReturnValue(setupStatus.promise)
    mockFetchInitValidateStatus.mockReturnValue(initStatus.promise)

    renderWithConsoleQuery(<InstallForm />, { queryClient })

    expect(mockPush).not.toHaveBeenCalled()
    expect(mockFetchInitValidateStatus).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('login.email')).not.toBeInTheDocument()

    await act(async () => setupStatus.resolve({ step: 'not_started' }))
    await waitFor(() => expect(mockFetchInitValidateStatus).toHaveBeenCalledTimes(1))
    expect(mockPush).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('login.email')).not.toBeInTheDocument()

    await act(async () => initStatus.resolve({ status: 'finished' }))
    expect(await screen.findByLabelText('login.email')).toBeInTheDocument()
    expect(mockPush).not.toHaveBeenCalled()
    expect(queryClient.getQueryData(consoleQuery.setup.get.queryKey())).toEqual({
      step: 'not_started',
    })
    expect(queryClient.getQueryData(consoleQuery.init.get.queryKey())).toEqual({
      status: 'finished',
    })
  })

  it.each(['setup', 'init'] as const)(
    'passes a failed %s check to the error boundary',
    async (stage) => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
      const failedCheck = stage === 'setup' ? mockFetchSetupStatus : mockFetchInitValidateStatus
      failedCheck.mockRejectedValue(new Error('Bootstrap unavailable'))

      try {
        render(
          <ErrorBoundary fallback={<div role="alert">Bootstrap unavailable</div>}>
            <InstallForm />
          </ErrorBoundary>,
        )

        expect(await screen.findByRole('alert')).toHaveTextContent('Bootstrap unavailable')
        expect(screen.queryByLabelText('login.email')).not.toBeInTheDocument()
        expect(mockPush).not.toHaveBeenCalled()
        expect(failedCheck).toHaveBeenCalledTimes(1)
        if (stage === 'setup') expect(mockFetchInitValidateStatus).not.toHaveBeenCalled()
      } finally {
        consoleError.mockRestore()
      }
    },
  )

  it('should reveal and hide the password with an accessible action', async () => {
    const user = userEvent.setup()
    render(<InstallForm />)

    const passwordInput = await screen.findByLabelText('login.password')

    await user.click(screen.getByRole('button', { name: 'login.showPassword' }))
    expect(passwordInput).toHaveAttribute('type', 'text')

    await user.click(screen.getByRole('button', { name: 'login.hidePassword' }))
    expect(passwordInput).toHaveAttribute('type', 'password')
  })

  it('should identify required fields only after submission', async () => {
    const user = userEvent.setup()
    render(<InstallForm />)

    const emailInput = await screen.findByLabelText('login.email')
    const nameInput = screen.getByLabelText('login.name')
    const passwordInput = screen.getByLabelText('login.password')

    expect(screen.queryByText('login.error.emailInValid')).not.toBeInTheDocument()
    expect(screen.queryByText('login.error.nameEmpty')).not.toBeInTheDocument()
    expect(screen.getAllByText('login.error.passwordInvalid')).toHaveLength(1)
    expect(passwordInput).toHaveAccessibleDescription('login.error.passwordInvalid')

    await user.click(screen.getByRole('button', { name: /login\.installBtn/ }))

    await waitFor(() => {
      expect(screen.getByText('login.error.emailInValid')).toBeInTheDocument()
      expect(screen.getByText('login.error.nameEmpty')).toBeInTheDocument()
      expect(screen.getAllByText('login.error.passwordInvalid')).toHaveLength(1)
    })
    expect(emailInput).toHaveAttribute('aria-invalid', 'true')
    expect(nameInput).toHaveAttribute('aria-invalid', 'true')
    expect(passwordInput).toHaveAttribute('aria-invalid', 'true')
    expect(passwordInput).toHaveAccessibleDescription('login.error.passwordInvalid')
    expect(mockSetup).not.toHaveBeenCalled()
  })

  it('should identify an invalid email and focus the field', async () => {
    const user = userEvent.setup()
    render(<InstallForm />)

    const emailInput = await screen.findByLabelText('login.email')
    await user.type(emailInput, 'invalid-email')
    await user.click(screen.getByRole('button', { name: /login\.installBtn/ }))

    expect(await screen.findByText('login.error.emailInValid')).toBeInTheDocument()
    expect(emailInput).toHaveAttribute('aria-invalid', 'true')
    expect(emailInput).toHaveFocus()
    expect(mockSetup).not.toHaveBeenCalled()
  })

  it('should enforce the password requirements before submission', async () => {
    const user = userEvent.setup()
    render(<InstallForm />)

    await user.type(await screen.findByLabelText('login.email'), 'admin@example.com')
    await user.type(screen.getByLabelText('login.name'), 'Admin')
    const passwordInput = screen.getByLabelText('login.password')
    await user.type(passwordInput, 'abcdefgh')
    await user.click(screen.getByRole('button', { name: /login\.installBtn/ }))

    expect(passwordInput).toHaveAttribute('aria-invalid', 'true')
    expect(passwordInput).toHaveFocus()
    expect(mockSetup).not.toHaveBeenCalled()
  })

  it('should submit and redirect to the console root on successful login', async () => {
    mockSetup.mockResolvedValue({ result: 'success' })
    mockLogin.mockResolvedValue({ result: 'success', data: 'token' })

    render(<InstallForm />)

    fireEvent.change(await screen.findByLabelText('login.email'), {
      target: { value: 'admin@example.com' },
    })
    fireEvent.change(screen.getByLabelText('login.name'), { target: { value: 'Admin' } })
    fireEvent.change(screen.getByLabelText('login.password'), { target: { value: 'Password123' } })

    const form = screen.getByRole('button', { name: /login\.installBtn/ }).closest('form')
    expect(form).not.toBeNull()

    fireEvent.submit(form as HTMLFormElement)

    await waitFor(() => {
      expect(mockSetup).toHaveBeenCalledWith({
        body: {
          email: 'admin@example.com',
          name: 'Admin',
          password: 'Password123',
          language: 'en-US',
        },
      })
    })

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith({
        body: {
          email: 'admin@example.com',
          password: encryptPassword('Password123'),
        },
      })
    })

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/')
    })
  })

  it('should redirect to sign in when login fails', async () => {
    mockSetup.mockResolvedValue({ result: 'success' })
    mockLogin.mockResolvedValue({
      result: 'fail',
      data: 'error',
    })

    render(<InstallForm />)

    fireEvent.change(await screen.findByLabelText('login.email'), {
      target: { value: 'admin@example.com' },
    })
    fireEvent.change(screen.getByLabelText('login.name'), { target: { value: 'Admin' } })
    fireEvent.change(screen.getByLabelText('login.password'), { target: { value: 'Password123' } })

    fireEvent.click(screen.getByRole('button', { name: /login\.installBtn/ }))

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/signin')
    })
  })

  it('should disable submit while request is in flight', async () => {
    let resolveSetup:
      | ((value: Awaited<ReturnType<typeof consoleClient.setup.post>>) => void)
      | undefined
    const setupPromise = new Promise<Awaited<ReturnType<typeof consoleClient.setup.post>>>(
      (resolve) => {
        resolveSetup = resolve
      },
    )
    mockSetup.mockReturnValue(setupPromise)
    mockLogin.mockResolvedValue({ result: 'success', data: 'token' })

    render(<InstallForm />)

    fireEvent.change(await screen.findByLabelText('login.email'), {
      target: { value: 'admin@example.com' },
    })
    fireEvent.change(screen.getByLabelText('login.name'), { target: { value: 'Admin' } })
    fireEvent.change(screen.getByLabelText('login.password'), { target: { value: 'Password123' } })

    const button = screen.getByRole('button', { name: /login\.installBtn/ })
    fireEvent.click(button)

    await waitFor(() => {
      expectLoadingButton(button)
    })

    fireEvent.click(button)
    expect(mockSetup).toHaveBeenCalledTimes(1)

    resolveSetup?.({ result: 'success' })

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledTimes(1)
    })
  })

  it('should redirect to sign in when setup is finished', async () => {
    mockFetchSetupStatus.mockResolvedValue({ step: 'finished' })

    render(<InstallForm />)

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/signin')
    })
    expect(mockFetchInitValidateStatus).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('login.email')).not.toBeInTheDocument()
  })
})
