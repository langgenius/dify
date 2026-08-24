import type { GetAccountProfileResponse } from '@dify/contracts/api/console/account/types.gen'
import type { DeploymentEdition } from '@dify/contracts/api/console/system-features/types.gen'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { emailLoginWithCode, sendEMailLoginCode } from '@/service/common'
import { seedSystemFeatures } from '@/test/console/query-data'
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
  action: string
  callback: (token: string) => void
}

const turnstileMocks = vi.hoisted(() => ({
  deploymentEdition: 'COMMUNITY' as DeploymentEdition,
  remove: vi.fn(),
  render: vi.fn(),
  scriptProps: undefined as ScriptProps | undefined,
  siteKey: '',
}))
const turnstileWidgets = new Map<string, HTMLElement>()

vi.mock('@/app/components/base/amplitude', () => ({
  trackEvent: vi.fn(),
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
  seedSystemFeatures(queryClient, {
    deployment_edition: turnstileMocks.deploymentEdition,
  })
  return queryClient
}

function createDeferred<T>() {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
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
    vi.mocked(emailLoginWithCode).mockReset().mockResolvedValue({ result: 'success' })
    vi.mocked(sendEMailLoginCode).mockReset()
    turnstileWidgets.clear()
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
        verifyButton.textContent = `verify-turnstile-${options.action}`
        verifyButton.addEventListener('click', () =>
          options.callback(`${options.action}-token-${turnstileMocks.render.mock.calls.length}`),
        )
        container.appendChild(verifyButton)
        turnstileWidgets.set(widgetId, verifyButton)
        return widgetId
      },
    )
    turnstileMocks.remove.mockImplementation((widgetId: string) => {
      turnstileWidgets.get(widgetId)?.remove()
      turnstileWidgets.delete(widgetId)
    })
    installTurnstileApi()
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

  it('rejects verification codes that are not exactly six digits', async () => {
    const user = userEvent.setup()
    const queryClient = createQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <CheckCode />
      </QueryClientProvider>,
    )

    fireEvent.change(screen.getByLabelText('login.checkCode.verificationCode'), {
      target: { value: '1234567' },
    })
    await user.click(screen.getByRole('button', { name: 'login.checkCode.verify' }))

    expect(emailLoginWithCode).not.toHaveBeenCalled()
  })

  it('keeps Community verification independent of Turnstile', async () => {
    const user = userEvent.setup()
    const queryClient = createQueryClient()
    vi.mocked(emailLoginWithCode).mockResolvedValue({
      code: 'invalid_code',
      data: '',
      message: 'Invalid code',
      result: 'fail',
    })
    render(
      <QueryClientProvider client={queryClient}>
        <CheckCode />
      </QueryClientProvider>,
    )

    await user.type(screen.getByLabelText('login.checkCode.verificationCode'), '123456')
    await user.click(screen.getByRole('button', { name: 'login.checkCode.verify' }))

    expect(emailLoginWithCode).toHaveBeenCalledWith({
      code: '123456',
      email: 'user@example.com',
      language: expect.any(String),
      timezone: 'Asia/Singapore',
      token: 'email-login-token',
    })
    expect(turnstileMocks.render).not.toHaveBeenCalled()
  })

  it('does not resend while verification is in progress', async () => {
    const user = userEvent.setup()
    const queryClient = createQueryClient()
    const verificationRequest = createDeferred<Awaited<ReturnType<typeof emailLoginWithCode>>>()
    vi.mocked(emailLoginWithCode).mockReturnValue(verificationRequest.promise)
    render(
      <QueryClientProvider client={queryClient}>
        <CheckCode />
      </QueryClientProvider>,
    )

    await user.type(screen.getByLabelText('login.checkCode.verificationCode'), '123456')
    await user.click(screen.getByRole('button', { name: 'login.checkCode.verify' }))
    await waitFor(() => {
      expect(emailLoginWithCode).toHaveBeenCalledOnce()
    })

    const resendButton = screen.getByRole('button', { name: 'resend-code' })
    expect(resendButton).toBeDisabled()
    resendButton.removeAttribute('disabled')
    fireEvent.click(resendButton)
    expect(sendEMailLoginCode).not.toHaveBeenCalled()

    act(() => {
      verificationRequest.resolve({
        code: 'invalid_code',
        data: '',
        message: 'Invalid code',
        result: 'fail',
      })
    })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'login.checkCode.verify' })).toBeEnabled()
    })
  })

  it('does not verify while resend is in progress', async () => {
    const user = userEvent.setup()
    const queryClient = createQueryClient()
    const resendRequest = createDeferred<Awaited<ReturnType<typeof sendEMailLoginCode>>>()
    vi.mocked(sendEMailLoginCode).mockReturnValue(resendRequest.promise)
    render(
      <QueryClientProvider client={queryClient}>
        <CheckCode />
      </QueryClientProvider>,
    )

    await user.type(screen.getByLabelText('login.checkCode.verificationCode'), '123456')
    await user.click(screen.getByRole('button', { name: 'resend-code' }))
    await waitFor(() => {
      expect(sendEMailLoginCode).toHaveBeenCalledOnce()
    })

    const verifyButton = screen.getByRole('button', { name: 'login.checkCode.verify' })
    expect(verifyButton).toBeDisabled()
    const form = verifyButton.closest('form')
    if (!form) throw new Error('Verification form is missing')
    fireEvent.submit(form)
    expect(emailLoginWithCode).not.toHaveBeenCalled()

    act(() => {
      resendRequest.resolve({ data: '', result: 'fail' })
    })
    await waitFor(() => {
      expect(verifyButton).toBeEnabled()
    })
  })

  it('requires a fresh verify-action Turnstile token after every Cloud login attempt', async () => {
    const user = userEvent.setup()
    turnstileMocks.deploymentEdition = 'CLOUD'
    turnstileMocks.siteKey = 'cloud-site-key'
    const queryClient = createQueryClient()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(emailLoginWithCode)
      .mockRejectedValueOnce(new Error('invalid verification code'))
      .mockResolvedValueOnce({
        code: 'invalid_code',
        data: '',
        message: 'Invalid code',
        result: 'fail',
      })

    render(
      <QueryClientProvider client={queryClient}>
        <CheckCode />
      </QueryClientProvider>,
    )

    const codeInput = screen.getByLabelText('login.checkCode.verificationCode')
    const verifyButton = screen.getByRole('button', { name: 'login.checkCode.verify' })
    expect(verifyButton).toBeDisabled()

    act(() => {
      turnstileMocks.scriptProps?.onReady?.()
    })
    expect(turnstileMocks.render).toHaveBeenLastCalledWith(
      expect.any(HTMLElement),
      expect.objectContaining({ action: 'signin_code_verify' }),
    )
    await user.click(
      await screen.findByRole('button', { name: 'verify-turnstile-signin_code_verify' }),
    )
    expect(verifyButton).toBeEnabled()

    await user.type(codeInput, '123456')
    await user.click(verifyButton)

    await waitFor(() => {
      expect(emailLoginWithCode).toHaveBeenCalledWith(
        expect.objectContaining({
          turnstile_token: 'signin_code_verify-token-1',
        }),
      )
    })
    expect(codeInput).toHaveValue('123456')
    await waitFor(() => {
      expect(verifyButton).toBeDisabled()
      expect(turnstileMocks.remove).toHaveBeenCalledWith('widget-1')
      expect(turnstileMocks.render).toHaveBeenCalledTimes(2)
    })
    expect(turnstileMocks.render).toHaveBeenLastCalledWith(
      expect.any(HTMLElement),
      expect.objectContaining({ action: 'signin_code_verify' }),
    )
    await user.click(
      await screen.findByRole('button', { name: 'verify-turnstile-signin_code_verify' }),
    )
    await user.click(verifyButton)

    await waitFor(() => {
      expect(emailLoginWithCode).toHaveBeenLastCalledWith(
        expect.objectContaining({
          turnstile_token: 'signin_code_verify-token-2',
        }),
      )
    })
    expect(codeInput).toHaveValue('123456')
  })

  it('keeps the Cloud resend challenge separate from the verify challenge', async () => {
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
    act(() => {
      turnstileMocks.scriptProps?.onReady?.()
    })
    await user.click(
      await screen.findByRole('button', { name: 'verify-turnstile-signin_code_verify' }),
    )
    expect(screen.getByRole('button', { name: 'login.checkCode.verify' })).toBeEnabled()

    await user.click(resendButton)

    expect(resendButton).toBeDisabled()
    expect(screen.getByRole('button', { name: 'login.checkCode.verify' })).toBeDisabled()
    expect(turnstileMocks.remove).toHaveBeenCalledWith('widget-1')
    expect(
      screen.queryByRole('button', { name: 'verify-turnstile-signin_code_verify' }),
    ).not.toBeInTheDocument()
    expect(turnstileMocks.render).toHaveBeenLastCalledWith(
      expect.any(HTMLElement),
      expect.objectContaining({ action: 'signin_code' }),
    )
    await user.click(await screen.findByRole('button', { name: 'verify-turnstile-signin_code' }))

    await waitFor(() => {
      expect(sendEMailLoginCode).toHaveBeenCalledWith(
        'user@example.com',
        expect.any(String),
        'signin_code-token-2',
      )
    })
    await waitFor(() => {
      expect(
        screen.queryByRole('button', { name: 'verify-turnstile-signin_code' }),
      ).not.toBeInTheDocument()
    })
    expect(turnstileMocks.render).toHaveBeenLastCalledWith(
      expect.any(HTMLElement),
      expect.objectContaining({ action: 'signin_code_verify' }),
    )
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
    await user.click(await screen.findByRole('button', { name: 'verify-turnstile-signin_code' }))

    await waitFor(() => {
      expect(sendEMailLoginCode).toHaveBeenCalledWith(
        'user@example.com',
        expect.any(String),
        'signin_code-token-1',
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

    expect(screen.queryByRole('button', { name: /verify-turnstile-/ })).not.toBeInTheDocument()
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
