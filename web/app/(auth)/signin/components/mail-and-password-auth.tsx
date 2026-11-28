import type { LoginPayload } from '@dify/contracts/api/console/login/types.gen'
import { Button } from '@langgenius/dify-ui/button'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldValidity,
} from '@langgenius/dify-ui/field'
import { Form } from '@langgenius/dify-ui/form'
import { Input } from '@langgenius/dify-ui/input'
import {
  PasswordField,
  PasswordFieldInput,
  PasswordFieldToggle,
} from '@langgenius/dify-ui/password-field'
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { trackEvent } from '@/app/components/base/amplitude'
import { toast } from '@/app/notifications'
import { emailRegex, validPassword } from '@/config'
import Link from '@/next/link'
import { useRouter, useSearchParams } from '@/next/navigation'
import { consoleQuery } from '@/service/console'
import { encryptPassword } from '@/utils/encryption'
import { replaceLoginRedirect } from '@/utils/login-redirect.client'
import { basePath } from '@/utils/var'
import { resolvePostLoginRedirect } from '../utils/post-login-redirect'

type MailAndPasswordAuthProps = {
  isInvite: boolean
  isEmailSetup: boolean
  // The invited account has no password yet, so this form sets one instead of checking one.
  isNewAccount?: boolean
}

function hasErrorCode(error: unknown, code: string) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code
}

export default function MailAndPasswordAuth({
  isInvite,
  isEmailSetup,
  isNewAccount = false,
}: MailAndPasswordAuthProps) {
  const { t } = useTranslation(['login', 'accountSettings'])
  const router = useRouter()
  const searchParams = useSearchParams()
  const emailFromLink = decodeURIComponent(searchParams.get('email') || '')
  const [email, setEmail] = useState(emailFromLink)
  const [password, setPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const { mutateAsync: login } = useMutation(consoleQuery.login.post.mutationOptions())

  const handleEmailPasswordLogin = async () => {
    if (isLoading) return
    try {
      setIsLoading(true)
      const loginData: LoginPayload = {
        email,
        password: encryptPassword(password),
        remember_me: true,
      }
      if (isInvite)
        loginData.invite_token = decodeURIComponent(searchParams.get('invite_token') as string)
      const res = await login({ body: loginData })
      if (res.result === 'success') {
        trackEvent('user_login_success', {
          method: 'email_password',
          is_invite: isInvite,
        })

        if (isInvite) {
          router.replace(`/signin/invite-settings?${searchParams.toString()}`)
        } else {
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
          placeholder={t(($) => $.emailPlaceholder, { ns: 'login' })}
        />
        <FieldError>
          {t(($) => $[email ? 'error.emailInValid' : 'error.emailEmpty'], { ns: 'login' })}
        </FieldError>
      </Field>

      <Field
        name="password"
        validate={(value) =>
          !isNewAccount || !value || validPassword.test(String(value))
            ? null
            : t(($) => $['error.passwordInvalid'], { ns: 'login' })
        }
        className="relative mb-3"
      >
        <FieldLabel>
          {isNewAccount
            ? t(($) => $['account.newPassword'], { ns: 'accountSettings' })
            : t(($) => $.password, { ns: 'login' })}
        </FieldLabel>
        <PasswordField>
          <PasswordFieldInput
            value={password}
            onValueChange={setPassword}
            required
            autoComplete={isNewAccount ? 'new-password' : 'current-password'}
            placeholder={t(($) => $.passwordPlaceholder, { ns: 'login' })}
          />
          <PasswordFieldToggle aria-label={t(($) => $.showPassword, { ns: 'login' })} />
        </PasswordField>
        {isNewAccount ? (
          <FieldValidity>
            {({ validity }) =>
              validity.valid !== false ? (
                <FieldDescription>
                  {t(($) => $['error.passwordInvalid'], { ns: 'login' })}
                </FieldDescription>
              ) : null
            }
          </FieldValidity>
        ) : isEmailSetup ? (
          <Link
            href={`/reset-password?${searchParams.toString()}`}
            className="absolute inset-e-0 top-1 rounded-sm system-xs-regular text-text-accent outline-hidden hover:underline focus-visible:ring-2 focus-visible:ring-state-accent-solid"
          >
            {t(($) => $.forget, { ns: 'login' })}
          </Link>
        ) : (
          <span className="absolute inset-e-0 top-1 system-xs-regular text-components-button-secondary-accent-text-disabled">
            {t(($) => $.forget, { ns: 'login' })}
          </span>
        )}
        <FieldError>
          {t(($) => $[password.trim() ? 'error.passwordInvalid' : 'error.passwordEmpty'], {
            ns: 'login',
          })}
        </FieldError>
      </Field>

      <div className="mb-2">
        <Button type="submit" loading={isLoading} variant="primary" className="w-full">
          {isNewAccount
            ? t(($) => $['signup.createAccount'], { ns: 'login' })
            : t(($) => $.signBtn, { ns: 'login' })}
        </Button>
      </div>
    </Form>
  )
}
