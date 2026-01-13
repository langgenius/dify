import type { InitValidateStatusResponse, SetupStatusResponse } from '@/models/common'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { fetchInitValidateStatus, fetchSetupStatus, login, setup } from '@/service/common'
import { encryptPassword } from '@/utils/encryption'
import InstallForm from './installForm'

const mockPush = vi.fn()
const mockReplace = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
}))

vi.mock('@/service/common', () => ({
  fetchSetupStatus: vi.fn(),
  fetchInitValidateStatus: vi.fn(),
  setup: vi.fn(),
  login: vi.fn(),
}))

vi.mock('@/context/global-public-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/context/global-public-context')>()
  return {
    ...actual,
    useIsSystemFeaturesPending: () => false,
  }
})

const mockFetchSetupStatus = vi.mocked(fetchSetupStatus)
const mockFetchInitValidateStatus = vi.mocked(fetchInitValidateStatus)
const mockSetup = vi.mocked(setup)
const mockLogin = vi.mocked(login)

const prepareLoadedState = () => {
  mockFetchSetupStatus.mockResolvedValue({ step: 'not_started' } as SetupStatusResponse)
  mockFetchInitValidateStatus.mockResolvedValue({ status: 'finished' } as InitValidateStatusResponse)
}

describe('InstallForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prepareLoadedState()
  })

  it('should render form after loading', async () => {
    render(<InstallForm />)

    expect(await screen.findByLabelText('login.email')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /login\.installBtn/ })).toBeInTheDocument()
  })

  it('should show validation error when required fields are empty', async () => {
    render(<InstallForm />)

    await screen.findByLabelText('login.email')

    fireEvent.click(screen.getByRole('button', { name: /login\.installBtn/ }))

    await waitFor(() => {
      expect(screen.getByText('login.error.emailInValid')).toBeInTheDocument()
      expect(screen.getByText('login.error.nameEmpty')).toBeInTheDocument()
    })
    expect(mockSetup).not.toHaveBeenCalled()
  })

  it('should submit and redirect to apps on successful login', async () => {
    mockSetup.mockResolvedValue({ result: 'success' } as any)
    mockLogin.mockResolvedValue({ result: 'success', data: { access_token: 'token' } } as any)

    render(<InstallForm />)

    fireEvent.change(await screen.findByLabelText('login.email'), { target: { value: 'admin@example.com' } })
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
          language: 'en',
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
      expect(mockReplace).toHaveBeenCalledWith('/apps')
    })
  })

  it('should redirect to sign in when login fails', async () => {
    mockSetup.mockResolvedValue({ result: 'success' } as any)
    mockLogin.mockResolvedValue({ result: 'fail', data: 'error', code: 'login_failed', message: 'login failed' } as any)

    render(<InstallForm />)

    fireEvent.change(await screen.findByLabelText('login.email'), { target: { value: 'admin@example.com' } })
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

    fireEvent.change(await screen.findByLabelText('login.email'), { target: { value: 'admin@example.com' } })
    fireEvent.change(screen.getByLabelText('login.name'), { target: { value: 'Admin' } })
    fireEvent.change(screen.getByLabelText('login.password'), { target: { value: 'Password123' } })

    const button = screen.getByRole('button', { name: /login\.installBtn/ })
    fireEvent.click(button)

    await waitFor(() => {
      expect(button).toBeDisabled()
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
      expect(localStorage.setItem).toHaveBeenCalledWith('setup_status', 'finished')
      expect(mockPush).toHaveBeenCalledWith('/signin')
    })
  })
})
