import { Button } from '@langgenius/dify-ui/button'
import { FieldControl, FieldLabel, FieldRoot } from '@langgenius/dify-ui/field'
import { Form } from '@langgenius/dify-ui/form'
import { toast } from '@langgenius/dify-ui/toast'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { trackEvent } from '@/app/components/base/amplitude'
import { emailRegex } from '@/config'
import { useLocale } from '@/context/i18n'
import Link from '@/next/link'
import { useRouter, useSearchParams } from '@/next/navigation'
import { consoleQuery } from '@/service/client'
import { login } from '@/service/common'
import { setWebAppAccessToken } from '@/service/webapp-auth'
import { encryptPassword } from '@/utils/encryption'
import { resolvePostLoginRedirect } from '../utils/post-login-redirect'

type MailAndPasswordAuthProps = {
  isInvite: boolean
  isEmailSetup: boolean
}

type LoginRequestBody = {
  email: string
  password: string
  language: string
  remember_me: boolean
  invite_token?: string
}

function hasErrorCode(error: unknown, code: string) {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === code
}

export default function MailAndPasswordAuth({ isInvite, isEmailSetup }: MailAndPasswordAuthProps) {
  const { t } = useTranslation()
  const locale = useLocale()
  const router = useRouter()
  const queryClient = useQueryClient()
  const searchParams = useSearchParams()
  const [showPassword, setShowPassword] = useState(false)
  const emailFromLink = decodeURIComponent(searchParams.get('email') || '')
  const [email, setEmail] = useState(emailFromLink)
  const [password, setPassword] = useState('')

  const [isLoading, setIsLoading] = useState(false)

  const handleEmailPasswordLogin = async () => {
    if (!email) {
      toast.error(t('error.emailEmpty', { ns: 'login' }))
      return
    }
    if (!emailRegex.test(email)) {
      toast.error(t('error.emailInValid', { ns: 'login' }))
      return
    }
    if (!password?.trim()) {
      toast.error(t('error.passwordEmpty', { ns: 'login' }))
      return
    }

    try {
      setIsLoading(true)
      const loginData: LoginRequestBody = {
        email,
        password: encryptPassword(password),
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
        if (res?.data?.access_token) {
          // Track login success event
          setWebAppAccessToken(res.data.access_token)
        }
        trackEvent('user_login_success', {
          method: 'email_password',
          is_invite: isInvite,
        })

        if (isInvite) {
          router.replace(`/signin/invite-settings?${searchParams.toString()}`)
        }
        else {
          await queryClient.resetQueries({ queryKey: consoleQuery.account.profile.get.key() })
          const redirectUrl = resolvePostLoginRedirect(searchParams)
          router.replace(redirectUrl || '/')
        }
      }
      else {
        toast.error(res.data)
      }
    }
    catch (error) {
      if (hasErrorCode(error, 'authentication_failed')) {
        toast.error(t('error.invalidEmailOrPassword', { ns: 'login' }))
      }
    }
    finally {
      setIsLoading(false)
    }
  }

  return (
    <Form
      onFormSubmit={() => {
        void handleEmailPasswordLogin()
      }}
    >
      <FieldRoot name="email" disabled={isInvite} className="mb-3">
        <FieldLabel className="my-2 py-0 system-md-semibold text-text-secondary">
          {t('email', { ns: 'login' })}
        </FieldLabel>
        <FieldControl
          value={email}
          onValueChange={setEmail}
          disabled={isInvite}
          type="email"
          autoComplete="email"
          spellCheck={false}
          placeholder={t('emailPlaceholder', { ns: 'login' }) || ''}
        />
      </FieldRoot>

      <FieldRoot name="password" className="mb-3">
        <div className="my-2 flex items-center justify-between">
          <FieldLabel className="py-0 system-md-semibold text-text-secondary">{t('password', { ns: 'login' })}</FieldLabel>
          <Link
            href={`/reset-password?${searchParams.toString()}`}
            className={`system-xs-regular ${isEmailSetup ? 'text-components-button-secondary-accent-text' : 'pointer-events-none text-components-button-secondary-accent-text-disabled'}`}
            tabIndex={isEmailSetup ? 0 : -1}
            aria-disabled={!isEmailSetup}
          >
            {t('forget', { ns: 'login' })}
          </Link>
        </div>
        <div className="relative mt-1">
          <FieldControl
            value={password}
            onValueChange={setPassword}
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            spellCheck={false}
            placeholder={t('passwordPlaceholder', { ns: 'login' }) || ''}
            className="pr-10"
          />
          <div className="absolute inset-y-0 right-0 flex items-center">
            <Button
              type="button"
              variant="ghost"
              aria-label={t(showPassword ? 'hidePassword' : 'showPassword', { ns: 'login' })}
              aria-pressed={showPassword}
              className="mr-1 size-8 p-0 text-text-tertiary hover:text-text-secondary"
              onClick={() => setShowPassword(!showPassword)}
            >
              {showPassword
                ? <span className="i-ri-eye-off-line size-4" aria-hidden="true" />
                : <span className="i-ri-eye-line size-4" aria-hidden="true" />}
            </Button>
          </div>
        </div>
      </FieldRoot>

      <div className="mb-2">
        <Button
          type="submit"
          loading={isLoading}
          variant="primary"
          disabled={isLoading || !email || !password}
          className="w-full"
        >
          {t('signBtn', { ns: 'login' })}
        </Button>
      </div>
    </Form>
  )
}
