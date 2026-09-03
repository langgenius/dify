import { Button } from '@langgenius/dify-ui/button'
import { Field, FieldError, FieldLabel } from '@langgenius/dify-ui/field'
import { Form } from '@langgenius/dify-ui/form'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Input } from '@langgenius/dify-ui/input'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@langgenius/dify-ui/input-group'
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
import { replaceLoginRedirect } from '@/utils/login-redirect.client'
import { basePath } from '@/utils/var'
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
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code
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
    if (isLoading) return
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
        } else {
          await queryClient.resetQueries({ queryKey: consoleQuery.account.profile.get.key() })
          replaceLoginRedirect(resolvePostLoginRedirect(searchParams), router.replace, basePath)
        }
      } else {
        toast.error(res.data)
      }
    } catch (error) {
      if (hasErrorCode(error, 'authentication_failed'))
        toast.error(t(($) => $['error.invalidEmailOrPassword'], { ns: 'login' }))
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Form
      onFormSubmit={() => {
        void handleEmailPasswordLogin()
      }}
    >
      <Field
        name="email"
        disabled={isInvite}
        validate={(value) => {
          const emailValue = String(value)
          return !emailValue || emailRegex.test(emailValue)
            ? null
            : t(($) => $['error.emailInValid'], { ns: 'login' })
        }}
        className="mb-3"
      >
        <FieldLabel>{t(($) => $.email, { ns: 'login' })}</FieldLabel>
        <Input
          value={email}
          onValueChange={setEmail}
          disabled={isInvite}
          type="email"
          required
          autoComplete="email"
          spellCheck={false}
          placeholder={t(($) => $.emailPlaceholder, { ns: 'login' }) || ''}
        />
        <FieldError>
          {t(($) => $[email ? 'error.emailInValid' : 'error.emailEmpty'], { ns: 'login' })}
        </FieldError>
      </Field>

      <Field name="password" className="relative mb-3">
        <FieldLabel>{t(($) => $.password, { ns: 'login' })}</FieldLabel>
        <InputGroup>
          <InputGroupInput
            value={password}
            onValueChange={setPassword}
            type={showPassword ? 'text' : 'password'}
            required
            autoComplete="current-password"
            spellCheck={false}
            placeholder={t(($) => $.passwordPlaceholder, { ns: 'login' }) || ''}
          />
          <InputGroupAddon align="inline-end">
            <IconButton
              size="lg"
              aria-label={t(($) => $[showPassword ? 'hidePassword' : 'showPassword'], {
                ns: 'login',
              })}
              onClick={() => setShowPassword(!showPassword)}
            >
              {showPassword ? (
                <span className="i-ri-eye-off-line size-4" aria-hidden="true" />
              ) : (
                <span className="i-ri-eye-line size-4" aria-hidden="true" />
              )}
            </IconButton>
          </InputGroupAddon>
        </InputGroup>
        <Link
          href={`/reset-password?${searchParams.toString()}`}
          className={`absolute end-0 top-1 rounded-sm system-xs-regular outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid ${isEmailSetup ? 'text-components-button-secondary-accent-text' : 'pointer-events-none text-components-button-secondary-accent-text-disabled'}`}
          tabIndex={isEmailSetup ? 0 : -1}
          aria-disabled={!isEmailSetup}
        >
          {t(($) => $.forget, { ns: 'login' })}
        </Link>
        <FieldError>
          {t(($) => $[password.trim() ? 'error.passwordInvalid' : 'error.passwordEmpty'], {
            ns: 'login',
          })}
        </FieldError>
      </Field>

      <div className="mb-2">
        <Button type="submit" loading={isLoading} variant="primary" className="w-full">
          {t(($) => $.signBtn, { ns: 'login' })}
        </Button>
      </div>
    </Form>
  )
}
