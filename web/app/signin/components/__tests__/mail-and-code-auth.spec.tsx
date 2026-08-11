import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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

  it('enables SaaS email-code login only while Turnstile verification is valid', async () => {
    const user = userEvent.setup()
    render(<MailAndCodeAuth isInvite={false} isCloudEdition />)

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
    render(<MailAndCodeAuth isInvite={false} isCloudEdition />)

    await user.type(screen.getByRole('textbox', { name: 'login.email' }), 'user@example.com')
    await waitFor(() => {
      expect(turnstileOptions).toBeDefined()
    })
    act(() => {
      turnstileOptions?.callback('turnstile-token')
    })
    await user.click(screen.getByRole('button', { name: 'login.signup.verifyMail' }))

    await waitFor(() => {
      expect(mocks.sendEMailLoginCode).toHaveBeenCalledWith('user@example.com', 'en-US')
    })
    expect(mocks.push).toHaveBeenCalledWith(expect.stringContaining('/signin/check-code?'))
  })

  it('keeps non-SaaS email-code login independent of Turnstile', async () => {
    const user = userEvent.setup()
    render(<MailAndCodeAuth isInvite={false} isCloudEdition={false} />)

    await user.type(screen.getByRole('textbox', { name: 'login.email' }), 'user@example.com')

    expect(screen.getByRole('button', { name: 'login.signup.verifyMail' })).toBeEnabled()
    expect(mocks.render).not.toHaveBeenCalled()
  })

  it('keeps SaaS email-code login disabled when the Turnstile site key is missing', async () => {
    const user = userEvent.setup()
    mocks.turnstileSiteKey = ''
    render(<MailAndCodeAuth isInvite={false} isCloudEdition />)

    await user.type(screen.getByRole('textbox', { name: 'login.email' }), 'user@example.com')

    expect(screen.getByRole('button', { name: 'login.signup.verifyMail' })).toBeDisabled()
    expect(mocks.render).not.toHaveBeenCalled()
  })
})
