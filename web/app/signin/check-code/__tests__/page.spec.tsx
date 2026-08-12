import type { GetAccountProfileResponse } from '@dify/contracts/api/console/account/types.gen'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { emailLoginWithCode, sendEMailLoginCode } from '@/service/common'
import CheckCode from '../page'

const navigationMocks = vi.hoisted(() => ({
  back: vi.fn(),
  replace: vi.fn(),
  searchParams: new URLSearchParams(),
}))

const serviceBaseMocks = vi.hoisted(() => ({
  get: vi.fn(),
}))

type ScriptProps = {
  id: string
  src: string
  onReady?: () => void
  onError?: () => void
}

type TurnstileOptions = {
  callback: (token: string) => void
}

const turnstileMocks = vi.hoisted(() => ({
  deploymentEdition: 'COMMUNITY',
  remove: vi.fn(),
  render: vi.fn(),
  scriptProps: undefined as ScriptProps | undefined,
  siteKey: '',
}))

vi.mock('@/app/components/base/amplitude', () => ({
  trackEvent: vi.fn(),
}))

vi.mock('@/features/system-features/client', () => ({
  systemFeaturesQueryOptions: () => ({
    queryKey: ['system-features'],
    queryFn: () => Promise.resolve({ deployment_edition: turnstileMocks.deploymentEdition }),
  }),
}))

vi.mock('@/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/config')>()),
  get TURNSTILE_SITE_KEY() {
    return turnstileMocks.siteKey
  },
}))

vi.mock('@/app/components/signin/countdown', () => ({
  default: ({ onResend, resendDisabled }: { onResend?: () => void; resendDisabled?: boolean }) => (
    <button type="button" disabled={resendDisabled} onClick={onResend}>
      resend-code
    </button>
  ),
}))

vi.mock('@/next/script', () => ({
  default: (props: ScriptProps) => {
    turnstileMocks.scriptProps = props
    return null
  },
}))

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({
    back: navigationMocks.back,
    replace: navigationMocks.replace,
  }),
  useSearchParams: () => navigationMocks.searchParams,
}))

vi.mock('@/service/base', () => serviceBaseMocks)

vi.mock('@/service/common', () => ({
  emailLoginWithCode: vi.fn(),
  sendEMailLoginCode: vi.fn(),
}))

vi.mock('@/utils/encryption', () => ({
  encryptVerificationCode: (code: string) => code,
}))

vi.mock('@/utils/timezone', () => ({
  getBrowserTimezone: () => 'Asia/Singapore',
}))

function createQueryClient() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })
  queryClient.setQueryData(['system-features'], {
    deployment_edition: turnstileMocks.deploymentEdition,
  })
  return queryClient
}

function installTurnstileApi() {
  Object.defineProperty(window, 'turnstile', {
    configurable: true,
    value: {
      remove: turnstileMocks.remove,
      render: turnstileMocks.render,
    },
  })
}

const accountProfile: GetAccountProfileResponse = {
  avatar: null,
  avatar_url: null,
  created_at: 1_700_000_000,
  email: 'user@example.com',
  id: 'account-id',
  interface_language: 'en-US',
  interface_theme: 'light',
  is_password_set: true,
  last_login_at: 1_700_000_000,
  last_login_ip: '127.0.0.1',
  name: 'User',
  timezone: 'Asia/Singapore',
}

describe('CheckCode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    navigationMocks.searchParams = new URLSearchParams({
      email: 'user@example.com',
      redirect_url: '/apps',
      token: 'email-login-token',
    })
    turnstileMocks.deploymentEdition = 'COMMUNITY'
    turnstileMocks.scriptProps = undefined
    turnstileMocks.siteKey = ''
    turnstileMocks.render.mockImplementation(
      (container: HTMLElement, options: TurnstileOptions) => {
        const widgetId = `widget-${turnstileMocks.render.mock.calls.length}`
        const verifyButton = document.createElement('button')
        verifyButton.type = 'button'
        verifyButton.dataset.widgetId = widgetId
        verifyButton.textContent = 'verify-turnstile'
        verifyButton.addEventListener('click', () => options.callback('fresh-turnstile-token'))
        container.appendChild(verifyButton)
        return widgetId
      },
    )
    turnstileMocks.remove.mockImplementation((widgetId: string) => {
      document.querySelector(`[data-widget-id="${widgetId}"]`)?.remove()
    })
    installTurnstileApi()
    vi.mocked(emailLoginWithCode).mockResolvedValue({ result: 'success' })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('exposes the page title as the main heading', () => {
    const queryClient = createQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <CheckCode />
      </QueryClientProvider>,
    )

    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()
  })

  it.each([
    ['Enter', '{Enter}'],
    ['Space', ' '],
  ])('supports going back with the %s key', async (_, key) => {
    const user = userEvent.setup()
    const queryClient = createQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <CheckCode />
      </QueryClientProvider>,
    )

    const backButton = screen.getByRole('button', { name: 'login.back' })
    expect(backButton).toHaveProperty('tabIndex', 0)
    backButton.focus()
    expect(backButton).toHaveFocus()
    await user.keyboard(key)

    expect(navigationMocks.back).toHaveBeenCalledOnce()
  })

  it('uses a fresh Turnstile token for each Cloud resend', async () => {
    const user = userEvent.setup()
    turnstileMocks.deploymentEdition = 'CLOUD'
    turnstileMocks.siteKey = 'cloud-site-key'
    const queryClient = createQueryClient()
    vi.mocked(sendEMailLoginCode).mockResolvedValue({ result: 'success', data: 'new-login-token' })

    render(
      <QueryClientProvider client={queryClient}>
        <CheckCode />
      </QueryClientProvider>,
    )

    const resendButton = screen.getByRole('button', { name: 'resend-code' })
    expect(resendButton).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'verify-turnstile' })).not.toBeInTheDocument()

    await user.click(resendButton)

    expect(resendButton).toBeDisabled()
    act(() => {
      turnstileMocks.scriptProps?.onReady?.()
    })
    await user.click(await screen.findByRole('button', { name: 'verify-turnstile' }))

    await waitFor(() => {
      expect(sendEMailLoginCode).toHaveBeenCalledWith(
        'user@example.com',
        expect.any(String),
        'fresh-turnstile-token',
      )
    })
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'verify-turnstile' })).not.toBeInTheDocument()
    })
  })

  it('keeps Turnstile script-error recovery available during a Cloud resend', async () => {
    const user = userEvent.setup()
    turnstileMocks.deploymentEdition = 'CLOUD'
    turnstileMocks.siteKey = 'cloud-site-key'
    const queryClient = createQueryClient()
    vi.mocked(sendEMailLoginCode).mockResolvedValue({ result: 'success', data: 'new-login-token' })
    Object.defineProperty(window, 'turnstile', {
      configurable: true,
      value: undefined,
    })

    render(
      <QueryClientProvider client={queryClient}>
        <CheckCode />
      </QueryClientProvider>,
    )

    const resendButton = screen.getByRole('button', { name: 'resend-code' })
    await user.click(resendButton)
    const initialScriptSrc = turnstileMocks.scriptProps?.src

    act(() => {
      turnstileMocks.scriptProps?.onError?.()
    })

    expect(screen.getByRole('alert')).toHaveTextContent('login.turnstile.loadError')
    expect(resendButton).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'common.operation.retry' }))

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(turnstileMocks.scriptProps?.src).not.toBe(initialScriptSrc)

    installTurnstileApi()
    act(() => {
      turnstileMocks.scriptProps?.onReady?.()
    })
    await user.click(await screen.findByRole('button', { name: 'verify-turnstile' }))

    await waitFor(() => {
      expect(sendEMailLoginCode).toHaveBeenCalledWith(
        'user@example.com',
        expect.any(String),
        'fresh-turnstile-token',
      )
    })
  })

  it('does not require Turnstile outside Cloud based on the site key alone', async () => {
    const user = userEvent.setup()
    const queryClient = createQueryClient()
    turnstileMocks.siteKey = 'site-key-not-used-outside-cloud'
    vi.mocked(sendEMailLoginCode).mockResolvedValue({ result: 'success', data: 'new-login-token' })

    render(
      <QueryClientProvider client={queryClient}>
        <CheckCode />
      </QueryClientProvider>,
    )

    expect(screen.queryByRole('button', { name: 'verify-turnstile' })).not.toBeInTheDocument()
    const resendButton = screen.getByRole('button', { name: 'resend-code' })
    expect(resendButton).toBeEnabled()
    await user.click(resendButton)

    expect(sendEMailLoginCode).toHaveBeenCalledWith(
      'user@example.com',
      expect.any(String),
      undefined,
    )
  })

  describe('Post-login profile bootstrap', () => {
    it('should resolve an inactive profile query before navigating to the console home', async () => {
      const user = userEvent.setup()
      const queryClient = createQueryClient()
      const profileQueryOptions = userProfileQueryOptions()
      const profileQueryKey = profileQueryOptions.queryKey
      let resolveProfileResponse: (response: Response) => void = () => {}
      const profileResponse = new Promise<Response>((resolve) => {
        resolveProfileResponse = resolve
      })
      serviceBaseMocks.get
        .mockRejectedValueOnce(new Response(null, { status: 401 }))
        .mockReturnValueOnce(profileResponse)
      await queryClient.prefetchQuery(profileQueryOptions)
      expect(queryClient.getQueryState(profileQueryKey)?.status).toBe('error')

      render(
        <QueryClientProvider client={queryClient}>
          <CheckCode />
        </QueryClientProvider>,
      )

      await user.type(screen.getByLabelText('login.checkCode.verificationCode'), '123456')
      await user.click(screen.getByRole('button', { name: 'login.checkCode.verify' }))

      await waitFor(() => {
        expect(serviceBaseMocks.get).toHaveBeenCalledTimes(2)
      })
      expect(queryClient.getQueryState(profileQueryKey)).toMatchObject({
        fetchStatus: 'fetching',
        status: 'pending',
      })
      expect(navigationMocks.replace).not.toHaveBeenCalled()

      resolveProfileResponse(
        new Response(JSON.stringify(accountProfile), {
          headers: {
            'content-type': 'application/json',
            'x-env': 'DEVELOPMENT',
            'x-version': '1.0.0',
          },
          status: 200,
        }),
      )

      await waitFor(() => {
        expect(navigationMocks.replace).toHaveBeenCalledWith('/apps')
      })
      expect(queryClient.getQueryState(profileQueryKey)?.status).toBe('success')
    })

    it('should keep a Cloud verification-code login on the current deployment', async () => {
      const user = userEvent.setup()
      const queryClient = createQueryClient()
      const locationReplace = vi.fn()
      navigationMocks.searchParams = new URLSearchParams({
        email: 'hanxujiang%2B4%40dify.ai',
        token: 'email-login-token',
      })
      serviceBaseMocks.get.mockResolvedValue(
        new Response(JSON.stringify(accountProfile), {
          headers: {
            'content-type': 'application/json',
            'x-env': 'DEVELOPMENT',
            'x-version': '1.0.0',
          },
          status: 200,
        }),
      )
      vi.stubGlobal('location', {
        ...window.location,
        origin: 'https://saas.dify.dev',
        replace: locationReplace,
      } as unknown as Location)

      render(
        <QueryClientProvider client={queryClient}>
          <CheckCode />
        </QueryClientProvider>,
      )

      await user.type(screen.getByLabelText('login.checkCode.verificationCode'), '123456')
      await user.click(screen.getByRole('button', { name: 'login.checkCode.verify' }))

      await waitFor(() => {
        expect(navigationMocks.replace).toHaveBeenCalledWith('/')
      })
      expect(locationReplace).not.toHaveBeenCalled()
    })
  })
})
