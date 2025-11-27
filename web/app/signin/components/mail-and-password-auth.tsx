import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
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

/**
 * Mail and Password Authentication Component
 *
 * This component provides a login form with email and password fields.
 * It includes fixes for issue #21177:
 * - Bug 1: Detects autofilled passwords and updates button state
 * - Bug 2: (Handled in parent component)
 */
export default function MailAndPasswordAuth({ isInvite, isEmailSetup, allowRegistration: _allowRegistration }: MailAndPasswordAuthProps) {
  // ============================================================================
  // Hooks and Context
  // ============================================================================
  const { t } = useTranslation()
  const { locale } = useContext(I18NContext)
  const router = useRouter()
  const searchParams = useSearchParams()

  // ============================================================================
  // State Management
  // ============================================================================
  // Password visibility toggle state
  const [showPassword, setShowPassword] = useState(false)

  // Extract email from URL parameters (e.g., from invite links)
  const emailFromLink = decodeURIComponent(searchParams.get('email') || '')

  // State management for form inputs
  const [email, setEmail] = useState(emailFromLink)
  const [password, setPassword] = useState('')

  // Ref for password input element - used to detect autofill
  // Fix for issue #21177 Bug 1: This ref allows us to check the actual DOM
  // value even when React state hasn't been updated by autofill
  const passwordInputRef = useRef<HTMLInputElement>(null)

  // Loading state for form submission
  // Prevents multiple submissions and shows loading indicator
  const [isLoading, setIsLoading] = useState(false)

  // Fix for issue #21177 Bug 1: Check for autofilled password value
  // Chrome and other browsers may autofill the password field without triggering
  // the onChange event, which leaves the login button disabled. This effect
  // periodically checks the input value to detect autofill and update state.
  useEffect(() => {
    const checkAutofill = () => {
      // If the input has a value but our state doesn't, it was likely autofilled
      if (passwordInputRef.current && passwordInputRef.current.value && !password)
        setPassword(passwordInputRef.current.value)
    }

    // Check immediately and after a short delay to catch autofill
    // The delay is necessary because autofill may happen after initial render
    checkAutofill()
    const timeoutId = setTimeout(checkAutofill, 100)

    // Cleanup timeout on unmount or dependency change
    return () => clearTimeout(timeoutId)
  }, [password])

  // ============================================================================
  // Event Handlers
  // ============================================================================

  /**
   * Handle email and password login submission.
   *
   * This function:
   * 1. Validates email and password inputs
   * 2. Makes the login API call
   * 3. Handles success/error responses
   * 4. Redirects user to appropriate page after login
   */
  const handleEmailPasswordLogin = async () => {
    // ========================================================================
    // Input Validation
    // ========================================================================
    // Validate email is provided
    if (!email) {
      Toast.notify({ type: 'error', message: t('login.error.emailEmpty') })
      return
    }

    // Validate email format using regex
    if (!emailRegex.test(email)) {
      Toast.notify({
        type: 'error',
        message: t('login.error.emailInValid'),
      })
      return
    }

    // Validate password is provided and not just whitespace
    if (!password?.trim()) {
      Toast.notify({ type: 'error', message: t('login.error.passwordEmpty') })
      return
    }

    // ========================================================================
    // Login API Call
    // ========================================================================
    try {
      // Set loading state to prevent multiple submissions
      setIsLoading(true)

      // Build login request data
      const loginData: Record<string, any> = {
        email,
        password,
        language: locale,
        remember_me: true,
      }

      // Add invite token if this is an invite flow
      if (isInvite)
        loginData.invite_token = decodeURIComponent(searchParams.get('invite_token') as string)

      // Make the login API call
      const res = await login({
        url: '/login',
        body: loginData,
      })

      // ========================================================================
      // Handle Login Response
      // ========================================================================
      if (res.result === 'success') {
        // Handle invite flow - redirect to invite settings
        if (isInvite) {
          router.replace(`/signin/invite-settings?${searchParams.toString()}`)
        }
        // Handle normal login - redirect to apps page or custom redirect URL
        else {
          const redirectUrl = resolvePostLoginRedirect(searchParams)
          router.replace(redirectUrl || '/apps')
        }
      }
      // Handle login failure
      else {
        Toast.notify({
          type: 'error',
          message: res.data,
        })
      }
    }
    catch (error) {
      // Handle authentication errors specifically
      if ((error as ResponseError).code === 'authentication_failed') {
        Toast.notify({
          type: 'error',
          message: t('login.error.invalidEmailOrPassword'),
        })
      }
    }
    finally {
      // Always reset loading state, even if there was an error
      setIsLoading(false)
    }
  }

  // ============================================================================
  // Render
  // ============================================================================
  return (
    <form onSubmit={noop}>
      {/* Email Input Field */}
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

      {/* Password Input Field */}
      <div className='mb-3'>
        <label htmlFor="password" className="my-2 flex items-center justify-between">
          <span className='system-md-semibold text-text-secondary'>{t('login.password')}</span>
          {/* Forgot Password Link */}
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
            // which helps catch cases where onChange might not fire.
            // This is crucial because browser autofill may not trigger onChange
            // events, leaving the login button disabled even when password is filled.
            onInput={(e) => {
              const target = e.target as HTMLInputElement
              // Update state if the input value changed (e.g., from autofill)
              // This ensures the login button becomes enabled when autofill occurs
              if (target.value && target.value !== password)
                setPassword(target.value)
            }}
            // Allow form submission via Enter key for better UX
            onKeyDown={(e) => {
              if (e.key === 'Enter')
                handleEmailPasswordLogin()
            }}
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            placeholder={t('login.passwordPlaceholder') || ''}
            tabIndex={2}
          />
          {/* Password Visibility Toggle Button */}
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

      {/* Login Submit Button */}
      <div className='mb-2'>
        <Button
          tabIndex={2}
          variant='primary'
          onClick={handleEmailPasswordLogin}
          // Button is disabled when:
          // - Form is submitting (isLoading)
          // - Email is empty
          // - Password is empty
          // Fix for issue #21177 Bug 1: The password state is now updated
          // when autofill occurs, so the button will be enabled correctly
          disabled={isLoading || !email || !password}
          className="w-full"
        >
          {t('login.signBtn')}
        </Button>
      </div>
    </form>
  )
}
