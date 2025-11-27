import Link from 'next/link'
import { useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useRouter, useSearchParams } from 'next/navigation'
import { useContext } from 'use-context-selector'
import Button from '@/app/components/base/button'
import Toast from '@/app/components/base/toast'
import { emailRegex } from '@/config'
import { login } from '@/service/common'
import Input from '@/app/components/base/input'
import I18NContext from '@/context/i18n'
import { noop } from 'lodash-es'
import { resolvePostLoginRedirect } from '../utils/post-login-redirect'
import type { ResponseError } from '@/service/fetch'

type MailAndPasswordAuthProps = {
  isInvite: boolean
  isEmailSetup: boolean
  allowRegistration: boolean
}

export default function MailAndPasswordAuth({ isInvite, isEmailSetup, allowRegistration: _allowRegistration }: MailAndPasswordAuthProps) {
  const { t } = useTranslation()
  const { locale } = useContext(I18NContext)
  const router = useRouter()
  const searchParams = useSearchParams()
  const [showPassword, setShowPassword] = useState(false)
  const emailFromLink = decodeURIComponent(searchParams.get('email') || '')
  // State management for form inputs
  const [email, setEmail] = useState(emailFromLink)
  const [password, setPassword] = useState('')
  const passwordInputRef = useRef<HTMLInputElement>(null)

  // Loading state for form submission
  const [isLoading, setIsLoading] = useState(false)

  // Fix for issue #21177 Bug 1: Check for autofilled password value
  // Chrome and other browsers may autofill the password field without triggering
  // the onChange event, which leaves the login button disabled. This effect
  // periodically checks the input value to detect autofill and update state.
  useEffect(() => {
    const checkAutofill = () => {
      // If the input has a value but our state doesn't, it was likely autofilled
      if (passwordInputRef.current && passwordInputRef.current.value && !password) {
        setPassword(passwordInputRef.current.value)
      }
    }

    // Check immediately and after a short delay to catch autofill
    // The delay is necessary because autofill may happen after initial render
    checkAutofill()
    const timeoutId = setTimeout(checkAutofill, 100)

    // Cleanup timeout on unmount or dependency change
    return () => clearTimeout(timeoutId)
  }, [password])

  const handleEmailPasswordLogin = async () => {
    if (!email) {
      Toast.notify({ type: 'error', message: t('login.error.emailEmpty') })
      return
    }
    if (!emailRegex.test(email)) {
      Toast.notify({
        type: 'error',
        message: t('login.error.emailInValid'),
      })
      return
    }
    if (!password?.trim()) {
      Toast.notify({ type: 'error', message: t('login.error.passwordEmpty') })
      return
    }

    try {
      setIsLoading(true)
      const loginData: Record<string, any> = {
        email,
        password,
        language: locale,
        remember_me: true,
      }
      if (isInvite)
        loginData.invite_token = decodeURIComponent(searchParams.get('invite_token') as string)
      const res = await login({
        url: '/login',
        body: loginData,
      })
      if (res.result === 'success') {
        if (isInvite) {
          router.replace(`/signin/invite-settings?${searchParams.toString()}`)
        }
        else {
          const redirectUrl = resolvePostLoginRedirect(searchParams)
          router.replace(redirectUrl || '/apps')
        }
      }
      else {
        Toast.notify({
          type: 'error',
          message: res.data,
        })
      }
    }
    catch (error) {
      if ((error as ResponseError).code === 'authentication_failed') {
        Toast.notify({
          type: 'error',
          message: t('login.error.invalidEmailOrPassword'),
        })
      }
    }
    finally {
      setIsLoading(false)
    }
  }

  return <form onSubmit={noop}>
    <div className='mb-3'>
      <label htmlFor="email" className="system-md-semibold my-2 text-text-secondary">
        {t('login.email')}
      </label>
      <div className="mt-1">
        <Input
          value={email}
          onChange={e => setEmail(e.target.value)}
          disabled={isInvite}
          id="email"
          type="email"
          autoComplete="email"
          placeholder={t('login.emailPlaceholder') || ''}
          tabIndex={1}
        />
      </div>
    </div>

    <div className='mb-3'>
      <label htmlFor="password" className="my-2 flex items-center justify-between">
        <span className='system-md-semibold text-text-secondary'>{t('login.password')}</span>
        <Link
          href={`/reset-password?${searchParams.toString()}`}
          className={`system-xs-regular ${isEmailSetup ? 'text-components-button-secondary-accent-text' : 'pointer-events-none text-components-button-secondary-accent-text-disabled'}`}
          tabIndex={isEmailSetup ? 0 : -1}
          aria-disabled={!isEmailSetup}
        >
          {t('login.forget')}
        </Link>
      </label>
      <div className="relative mt-1">
        <Input
          ref={passwordInputRef}
          id="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          // Fix for issue #21177 Bug 1: Handle autofill events via onInput
          // The onInput event fires for all input changes including autofill,
          // which helps catch cases where onChange might not fire
          onInput={e => {
            const target = e.target as HTMLInputElement
            // Update state if the input value changed (e.g., from autofill)
            if (target.value && target.value !== password) {
              setPassword(target.value)
            }
          }}
          // Allow form submission via Enter key
          onKeyDown={(e) => {
            if (e.key === 'Enter')
              handleEmailPasswordLogin()
          }}
          type={showPassword ? 'text' : 'password'}
          autoComplete="current-password"
          placeholder={t('login.passwordPlaceholder') || ''}
          tabIndex={2}
        />
        <div className="absolute inset-y-0 right-0 flex items-center">
          <Button
            type="button"
            variant='ghost'
            onClick={() => setShowPassword(!showPassword)}
          >
            {showPassword ? '👀' : '😝'}
          </Button>
        </div>
      </div>
    </div>

    <div className='mb-2'>
      <Button
        tabIndex={2}
        variant='primary'
        onClick={handleEmailPasswordLogin}
        disabled={isLoading || !email || !password}
        className="w-full"
      >{t('login.signBtn')}</Button>
    </div>
  </form>
}
