import type { ReactElement } from 'react'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from '@/app/notifications'
import { consoleQuery } from '@/service/console'
import { expectLoadingButton } from '@/test/button'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'
import { encryptPassword } from '@/utils/encryption'
import InstallForm from './installForm'

const render = (ui: ReactElement) => renderWithConsoleQuery(ui)

const mockPush = vi.fn()
const mockReplace = vi.fn()

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
}))

vi.mock('@/app/notifications', () => ({ toast: { error: vi.fn() } }))

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const mockFetchSetupStatus = vi.fn<() => Promise<Response>>()
const mockFetchInitValidateStatus = vi.fn<() => Promise<Response>>()
const mockSetup = vi.fn<() => Promise<Response>>()
const mockLogin = vi.fn<() => Promise<Response>>()
const requests: Request[] = []
const network = vi.fn<typeof fetch>()

const submitAccount = async () => {
  fireEvent.change(await screen.findByLabelText('login.email'), {
    target: { value: 'admin@example.com' },
  })
  fireEvent.change(screen.getByLabelText('login.name'), { target: { value: 'Admin' } })
  fireEvent.change(screen.getByLabelText('login.password'), { target: { value: 'Password123' } })
  fireEvent.click(screen.getByRole('button', { name: /login\.installBtn/ }))
}

const prepareLoadedState = () => {
  mockFetchSetupStatus.mockImplementation(async () => json({ step: 'not_started' }))
  mockFetchInitValidateStatus.mockImplementation(async () => json({ status: 'finished' }))
  mockSetup.mockImplementation(async () => json({ result: 'success' }, 201))
  mockLogin.mockImplementation(async () => json({ result: 'success', data: 'token' }))
}

describe('InstallForm', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    prepareLoadedState()
    requests.length = 0
    network.mockImplementation(async (input, init) => {
      const request = new Request(input, init)
      requests.push(request)
      const route = `${request.method} ${new URL(request.url).pathname}`
      switch (route) {
        case 'GET /console/api/setup':
          return mockFetchSetupStatus()
        case 'GET /console/api/init':
          return mockFetchInitValidateStatus()
        case 'POST /console/api/setup':
          return mockSetup()
        case 'POST /console/api/login':
          return mockLogin()
        default:
          throw new Error(`Unexpected request: ${route}`)
      }
    })
    vi.stubGlobal('fetch', network)
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
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
    await waitFor(() => expect(mockFetchInitValidateStatus).toHaveBeenCalledOnce())
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
    const { queryClient } = render(<InstallForm />)
    const profileKey = consoleQuery.account.profile.get.queryKey()
    expect(queryClient.getQueryData(profileKey)).toBeDefined()
    let profileAtNavigation: unknown
    mockReplace.mockImplementation(() => {
      profileAtNavigation = queryClient.getQueryData(profileKey)
    })

    await submitAccount()

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/')
    })
    expect(profileAtNavigation).toBeUndefined()
    const writes = requests.filter((request) => request.method === 'POST')
    expect(writes.map((request) => new URL(request.url).pathname)).toEqual([
      '/console/api/setup',
      '/console/api/login',
    ])
    expect(await Promise.all(writes.map((request) => request.json()))).toEqual([
      {
        email: 'admin@example.com',
        name: 'Admin',
        password: 'Password123',
        language: 'en-US',
      },
      { email: 'admin@example.com', password: encryptPassword('Password123') },
    ])
  })

  it('should redirect to sign in when login fails', async () => {
    mockLogin.mockImplementation(async () => json({ result: 'fail', data: 'error' }))

    const { queryClient } = render(<InstallForm />)
    const profileKey = consoleQuery.account.profile.get.queryKey()
    const profile = queryClient.getQueryData(profileKey)

    await submitAccount()

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/signin')
    })
    expect(queryClient.getQueryData(profileKey)).toEqual(profile)
  })

  it('should disable submit while request is in flight', async () => {
    const setup = createDeferred<Response>()
    const login = createDeferred<Response>()
    mockSetup.mockReturnValue(setup.promise)
    mockLogin.mockReturnValue(login.promise)

    render(<InstallForm />)

    await submitAccount()
    const button = screen.getByRole('button', { name: /login\.installBtn/ })

    await waitFor(() => {
      expectLoadingButton(button)
    })

    fireEvent.click(button)
    expect(mockSetup).toHaveBeenCalledTimes(1)
    expect(mockLogin).not.toHaveBeenCalled()

    await act(async () => setup.resolve(json({ result: 'success' }, 201)))

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledTimes(1)
    })
    expectLoadingButton(button)
    fireEvent.click(button)
    expect(mockSetup).toHaveBeenCalledTimes(1)
    expect(mockReplace).not.toHaveBeenCalled()
    await act(async () => login.resolve(json({ result: 'success' })))
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'))
  })

  it('should redirect to sign in when setup is finished', async () => {
    mockFetchSetupStatus.mockImplementation(async () => json({ step: 'finished' }))

    render(<InstallForm />)

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/signin')
    })
    expect(mockFetchInitValidateStatus).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('login.email')).not.toBeInTheDocument()
  })

  it('waits for initialization validation before allowing account setup', async () => {
    const init = createDeferred<Response>()
    mockFetchInitValidateStatus.mockReturnValue(init.promise)
    render(<InstallForm />)

    await waitFor(() => expect(mockFetchInitValidateStatus).toHaveBeenCalledOnce())
    try {
      expect(screen.queryByLabelText('login.email')).not.toBeInTheDocument()
    } finally {
      await act(async () => init.resolve(json({ status: 'finished' })))
    }
    expect(await screen.findByLabelText('login.email')).toBeInTheDocument()
  })

  it('redirects to initialization without exposing the setup form when validation is required', async () => {
    mockFetchInitValidateStatus.mockImplementation(async () => json({ status: 'not_started' }))
    render(<InstallForm />)

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/init'))
    expect(screen.queryByLabelText('login.email')).not.toBeInTheDocument()
    expect(mockSetup).not.toHaveBeenCalled()
  })

  it.each(['setup', 'initialization'] as const)(
    'rechecks cached %s status before redirecting',
    async (status) => {
      const queryClient = createConsoleQueryClient()
      if (status === 'setup')
        queryClient.setQueryData(consoleQuery.setup.get.queryKey(), { step: 'finished' })
      else queryClient.setQueryData(consoleQuery.init.get.queryKey(), { status: 'not_started' })

      renderWithConsoleQuery(<InstallForm />, { queryClient })

      expect(await screen.findByLabelText('login.email')).toBeInTheDocument()
      expect(mockFetchSetupStatus).toHaveBeenCalledOnce()
      expect(mockFetchInitValidateStatus).toHaveBeenCalledOnce()
      expect(mockPush).not.toHaveBeenCalled()
    },
  )

  it('keeps setup status fresh after creating the account without interrupting automatic login', async () => {
    mockSetup.mockImplementation(async () => {
      mockFetchSetupStatus.mockImplementation(async () => json({ step: 'finished' }))
      return json({ result: 'success' }, 201)
    })
    const { queryClient } = render(<InstallForm />)
    await submitAccount()

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'))
    await waitFor(() => {
      expect(queryClient.getQueryState(consoleQuery.setup.get.queryKey())?.isInvalidated).toBe(true)
    })
    expect(mockPush).not.toHaveBeenCalled()
    expect(mockFetchSetupStatus).toHaveBeenCalledOnce()
  })

  it('retains the form and allows retry after a failed setup without attempting login', async () => {
    mockSetup.mockImplementationOnce(async () =>
      json(
        {
          code: 'invalid_param',
          message: 'Setup could not be completed',
          status: 400,
        },
        400,
      ),
    )
    render(<InstallForm />)
    await submitAccount()

    const button = screen.getByRole('button', { name: /login\.installBtn/ })
    await waitFor(() => expect(button).toBeEnabled())
    expect(toast.error).toHaveBeenCalledExactlyOnceWith('Setup could not be completed')
    expect(screen.getByLabelText('login.email')).toHaveValue('admin@example.com')
    expect(mockLogin).not.toHaveBeenCalled()
    expect(mockReplace).not.toHaveBeenCalled()

    await userEvent.click(button)
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'))
    expect(mockSetup).toHaveBeenCalledTimes(2)
    expect(mockLogin).toHaveBeenCalledOnce()
  })

  it('redirects to sign in after an HTTP login failure without repeating setup', async () => {
    mockLogin.mockImplementation(async () =>
      json(
        {
          code: 'invalid_account_password',
          message: 'Automatic login failed',
          status: 400,
        },
        400,
      ),
    )
    const { queryClient } = render(<InstallForm />)
    const profileKey = consoleQuery.account.profile.get.queryKey()
    const profile = queryClient.getQueryData(profileKey)
    await submitAccount()

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/signin'))
    expect(toast.error).toHaveBeenCalledExactlyOnceWith('Automatic login failed')
    expect(mockSetup).toHaveBeenCalledOnce()
    expect(mockLogin).toHaveBeenCalledOnce()
    expect(queryClient.getQueryData(profileKey)).toEqual(profile)
  })

  it.each([
    ['setup', mockFetchSetupStatus],
    ['initialization', mockFetchInitValidateStatus],
  ] as const)(
    'does not expose the form when the %s status request fails',
    async (name, handler) => {
      const message = `Unable to load ${name} status`
      handler.mockImplementation(async () =>
        json({ code: 'invalid_param', message, status: 400 }, 400),
      )
      render(<InstallForm />)

      await waitFor(() => expect(toast.error).toHaveBeenCalledExactlyOnceWith(message))
      expect(screen.queryByLabelText('login.email')).not.toBeInTheDocument()
      expect(mockPush).not.toHaveBeenCalled()
      expect(mockSetup).not.toHaveBeenCalled()
      expect(mockLogin).not.toHaveBeenCalled()
      expect(handler).toHaveBeenCalledOnce()
    },
  )
})
