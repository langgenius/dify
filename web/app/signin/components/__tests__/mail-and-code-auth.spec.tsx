import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import MailAndCodeAuth from '../mail-and-code-auth'

type TurnstileOptions = {
  sitekey: string
  action: string
  callback: (token: string) => void
  'error-callback': (errorCode: string) => boolean
  'expired-callback': () => void
  'timeout-callback': () => void
}

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  remove: vi.fn(),
  render: vi.fn(),
  sendEMailLoginCode: vi.fn(),
  setCountdownLeftTime: vi.fn(),
  turnstileSiteKey: 'site-key-for-tests',
}))

let turnstileOptions: TurnstileOptions | undefined

const renderMailAndCodeAuth = (deploymentEdition: 'CLOUD' | 'COMMUNITY' = 'CLOUD') =>
  renderWithConsoleQuery(<MailAndCodeAuth isInvite={false} />, {
    systemFeatures: { deployment_edition: deploymentEdition },
  })

vi.mock('@/next/script', async () => {
  const { useEffect } = await vi.importActual<typeof import('react')>('react')

  function ScriptMock({ onReady }: { onReady?: () => void }) {
    useEffect(() => {
      onReady?.()
    }, [onReady])
    return null
  }

  return {
    default: ScriptMock,
  }
})

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({ push: mocks.push }),
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/context/i18n', () => ({
  useLocale: () => 'en-US',
}))

vi.mock('@/app/components/signin/storage', () => ({
  COUNT_DOWN_TIME_MS: 60_000,
  useSetCountdownLeftTime: () => mocks.setCountdownLeftTime,
}))

vi.mock('@/config', async () => {
  const actual = await vi.importActual<typeof import('@/config')>('@/config')
  return {
    ...actual,
    get TURNSTILE_SITE_KEY() {
      return mocks.turnstileSiteKey
    },
  }
})

vi.mock('@/service/common', () => ({
  sendEMailLoginCode: (...args: unknown[]) => mocks.sendEMailLoginCode(...args),
}))

describe('MailAndCodeAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    turnstileOptions = undefined
    mocks.turnstileSiteKey = 'site-key-for-tests'
    mocks.render.mockImplementation((_container: HTMLElement, options: TurnstileOptions) => {
      turnstileOptions = options
      return 'widget-id'
    })
    mocks.sendEMailLoginCode.mockResolvedValue({ result: 'success', data: 'login-token' })
    Object.defineProperty(window, 'turnstile', {
      configurable: true,
      value: {
        remove: mocks.remove,
        render: mocks.render,
      },
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('enables SaaS email-code login only while Turnstile verification is valid', async () => {
    const user = userEvent.setup()
    renderMailAndCodeAuth()

    await user.type(screen.getByRole('textbox', { name: 'login.email' }), 'user@example.com')
    const continueButton = screen.getByRole('button', { name: 'login.signup.verifyMail' })

    await waitFor(() => {
      expect(mocks.render).toHaveBeenCalledTimes(1)
    })
    expect(turnstileOptions).toMatchObject({
      sitekey: 'site-key-for-tests',
      action: 'signin_code',
    })
    expect(continueButton).toBeDisabled()

    act(() => {
      turnstileOptions?.callback('turnstile-token')
    })
    expect(continueButton).toBeEnabled()

    act(() => {
      turnstileOptions?.['expired-callback']()
    })
    expect(continueButton).toBeDisabled()

    act(() => {
      turnstileOptions?.callback('fresh-turnstile-token')
      turnstileOptions?.['error-callback']('network-error')
    })
    expect(continueButton).toBeDisabled()

    act(() => {
      turnstileOptions?.callback('another-turnstile-token')
      turnstileOptions?.['timeout-callback']()
    })
    expect(continueButton).toBeDisabled()
  })

  it('submits the SaaS email-code login after Turnstile verification succeeds', async () => {
    const user = userEvent.setup()
    renderMailAndCodeAuth()

    await user.type(screen.getByRole('textbox', { name: 'login.email' }), 'user@example.com')
    await waitFor(() => {
      expect(turnstileOptions).toBeDefined()
    })
    act(() => {
      turnstileOptions?.callback('turnstile-token')
    })
    await user.click(screen.getByRole('button', { name: 'login.signup.verifyMail' }))

    await waitFor(() => {
      expect(mocks.sendEMailLoginCode).toHaveBeenCalledWith(
        'user@example.com',
        'en-US',
        'turnstile-token',
      )
    })
    expect(mocks.push).toHaveBeenCalledWith(expect.stringContaining('/signin/check-code?'))
  })

  it('requires a fresh Turnstile token after an email-code request fails', async () => {
    const user = userEvent.setup()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.sendEMailLoginCode
      .mockRejectedValueOnce(new Error('email send failed'))
      .mockResolvedValueOnce({ result: 'success', data: 'login-token' })
    renderMailAndCodeAuth()

    await user.type(screen.getByRole('textbox', { name: 'login.email' }), 'user@example.com')
    await waitFor(() => {
      expect(turnstileOptions).toBeDefined()
    })
    act(() => {
      turnstileOptions?.callback('consumed-turnstile-token')
    })
    const continueButton = screen.getByRole('button', { name: 'login.signup.verifyMail' })
    await user.click(continueButton)

    await waitFor(() => {
      expect(mocks.sendEMailLoginCode).toHaveBeenCalledWith(
        'user@example.com',
        'en-US',
        'consumed-turnstile-token',
      )
    })
    await waitFor(() => {
      expect(continueButton).toBeDisabled()
      expect(mocks.render).toHaveBeenCalledTimes(2)
    })

    act(() => {
      turnstileOptions?.callback('fresh-turnstile-token')
    })
    expect(continueButton).toBeEnabled()
    await user.click(continueButton)

    await waitFor(() => {
      expect(mocks.sendEMailLoginCode).toHaveBeenLastCalledWith(
        'user@example.com',
        'en-US',
        'fresh-turnstile-token',
      )
    })
    expect(mocks.push).toHaveBeenCalledWith(expect.stringContaining('/signin/check-code?'))
  })

  it('keeps non-SaaS email-code login independent of Turnstile', async () => {
    const user = userEvent.setup()
    renderMailAndCodeAuth('COMMUNITY')

    await user.type(screen.getByRole('textbox', { name: 'login.email' }), 'user@example.com')

    expect(screen.getByRole('button', { name: 'login.signup.verifyMail' })).toBeEnabled()
    expect(mocks.render).not.toHaveBeenCalled()
  })

  it('keeps SaaS email-code login disabled when the Turnstile site key is missing', async () => {
    const user = userEvent.setup()
    mocks.turnstileSiteKey = ''
    renderMailAndCodeAuth()

    await user.type(screen.getByRole('textbox', { name: 'login.email' }), 'user@example.com')

    expect(screen.getByRole('button', { name: 'login.signup.verifyMail' })).toBeDisabled()
    expect(mocks.render).not.toHaveBeenCalled()
  })
})
