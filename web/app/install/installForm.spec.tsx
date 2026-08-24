import type { ReactElement } from 'react'
import type { InitValidateStatusResponse, SetupStatusResponse } from '@/models/common'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fetchInitValidateStatus, fetchSetupStatus, login, setup } from '@/service/common'
import { expectLoadingButton } from '@/test/button'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import { encryptPassword } from '@/utils/encryption'
import InstallForm from './installForm'

const render = (ui: ReactElement) => renderWithConsoleQuery(ui)

const mockPush = vi.fn()
const mockReplace = vi.fn()

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
}))

vi.mock('@/service/common', () => ({
  fetchSetupStatus: vi.fn(),
  fetchInitValidateStatus: vi.fn(),
  setup: vi.fn(),
  login: vi.fn(),
}))

const mockFetchSetupStatus = vi.mocked(fetchSetupStatus)
const mockFetchInitValidateStatus = vi.mocked(fetchInitValidateStatus)
const mockSetup = vi.mocked(setup)
const mockLogin = vi.mocked(login)

const prepareLoadedState = () => {
  mockFetchSetupStatus.mockResolvedValue({ step: 'not_started' } as SetupStatusResponse)
  mockFetchInitValidateStatus.mockResolvedValue({
    status: 'finished',
  } as InitValidateStatusResponse)
}

describe('InstallForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
    mockSetup.mockResolvedValue({ result: 'success' } as any)
    mockLogin.mockResolvedValue({ result: 'success', data: { access_token: 'token' } } as any)

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
        url: '/login',
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
    mockSetup.mockResolvedValue({ result: 'success' } as any)
    mockLogin.mockResolvedValue({
      result: 'fail',
      data: 'error',
      code: 'login_failed',
      message: 'login failed',
    } as any)

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
    let resolveSetup: ((value: any) => void) | undefined
    const setupPromise = new Promise((resolve) => {
      resolveSetup = resolve
    })
    mockSetup.mockReturnValue(setupPromise as any)
    mockLogin.mockResolvedValue({ result: 'success', data: { access_token: 'token' } } as any)

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
    mockFetchSetupStatus.mockResolvedValue({ step: 'finished' } as SetupStatusResponse)

    render(<InstallForm />)

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/signin')
    })
  })
})
