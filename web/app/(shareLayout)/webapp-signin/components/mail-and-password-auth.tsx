'use client'
import { Button } from '@langgenius/dify-ui/button'
import { Field, FieldLabel } from '@langgenius/dify-ui/field'
import { Form } from '@langgenius/dify-ui/form'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Input } from '@langgenius/dify-ui/input'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@langgenius/dify-ui/input-group'
import { toast } from '@langgenius/dify-ui/toast'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { resolveWebAppLoginRedirect } from '@/app/(shareLayout)/webapp-signin/login-redirect'
import { emailRegex } from '@/config'
import { useLocale } from '@/context/i18n'
import { useWebAppStore } from '@/context/web-app-context'
import Link from '@/next/link'
import { useRouter, useSearchParams } from '@/next/navigation'
import { webAppLogin } from '@/service/common'
import { fetchAccessToken } from '@/service/share'
import { setWebAppAccessToken, setWebAppPassport } from '@/service/webapp-auth'
import { encryptPassword } from '@/utils/encryption'
import { getClientLoginFallback } from '@/utils/login-redirect'
import { replaceLoginRedirect } from '@/utils/login-redirect.client'
import { basePath } from '@/utils/var'

type MailAndPasswordAuthProps = {
  isEmailSetup: boolean
}

export default function MailAndPasswordAuth({ isEmailSetup }: MailAndPasswordAuthProps) {
  const { t } = useTranslation()
  const locale = useLocale()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [showPassword, setShowPassword] = useState(false)
  const emailFromLink = decodeURIComponent(searchParams.get('email') || '')
  const [email, setEmail] = useState(emailFromLink)
  const [password, setPassword] = useState('')

  const [isLoading, setIsLoading] = useState(false)
  const redirectUrl = searchParams.get('redirect_url')
  const embeddedUserId = useWebAppStore((s) => s.embeddedUserId)

  useEffect(() => {
    if (!resolveWebAppLoginRedirect(redirectUrl, window.location.origin))
      replaceLoginRedirect(getClientLoginFallback(), router.replace, basePath)
  }, [redirectUrl, router])

  const handleEmailPasswordLogin = async () => {
    const loginRedirect = resolveWebAppLoginRedirect(redirectUrl, window.location.origin)
    if (!loginRedirect) {
      replaceLoginRedirect(getClientLoginFallback(), router.replace, basePath)
      return
    }
    if (!email) {
      toast.error(t(($) => $['error.emailEmpty'], { ns: 'login' }))
      return
    }
    if (!emailRegex.test(email)) {
      toast.error(t(($) => $['error.emailInValid'], { ns: 'login' }))
      return
    }
    if (!password?.trim()) {
      toast.error(t(($) => $['error.passwordEmpty'], { ns: 'login' }))
      return
    }

    try {
      setIsLoading(true)
      const loginData = {
        email,
        password: encryptPassword(password),
        language: locale,
        remember_me: true,
      }

      const res = await webAppLogin({
        url: '/login',
        body: loginData,
      })
      if (res.result === 'success') {
        if (res?.data?.access_token) {
          setWebAppAccessToken(res.data.access_token)
        }

        const { access_token } = await fetchAccessToken({
          appCode: loginRedirect.appCode,
          userId: embeddedUserId || undefined,
        })
        setWebAppPassport(loginRedirect.address, access_token)
        replaceLoginRedirect(loginRedirect.target, router.replace, basePath)
      } else {
        toast.error(res.data)
      }
    } catch (error: unknown) {
      const authenticationError = error as { code?: unknown; message?: unknown }
      if (
        authenticationError.code === 'authentication_failed' &&
        typeof authenticationError.message === 'string'
      )
        toast.error(authenticationError.message)
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
      <Field name="email" className="mb-3 block">
        <FieldLabel className="my-2 py-0 text-sm leading-5 font-semibold text-text-secondary">
          {t(($) => $.email, { ns: 'login' })}
        </FieldLabel>
        <div className="mt-1">
          <Input
            value={email}
            onValueChange={setEmail}
            id="email"
            type="email"
            autoComplete="email"
            spellCheck={false}
            placeholder={t(($) => $.emailPlaceholder, { ns: 'login' }) || ''}
          />
        </div>
      </Field>

      <Field name="password" className="mb-3 block">
        <div className="my-2 flex items-center justify-between">
          <FieldLabel className="py-0 text-sm leading-5 font-semibold text-text-secondary">
            {t(($) => $.password, { ns: 'login' })}
          </FieldLabel>
          <Link
            href={`/webapp-reset-password?${searchParams.toString()}`}
            className={`system-xs-regular ${isEmailSetup ? 'text-components-button-secondary-accent-text' : 'pointer-events-none text-components-button-secondary-accent-text-disabled'}`}
            tabIndex={isEmailSetup ? 0 : -1}
            aria-disabled={!isEmailSetup}
          >
            {t(($) => $.forget, { ns: 'login' })}
          </Link>
        </div>
        <InputGroup className="mt-1">
          <InputGroupInput
            value={password}
            onValueChange={setPassword}
            id="password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            spellCheck={false}
            placeholder={t(($) => $.passwordPlaceholder, { ns: 'login' }) || ''}
          />
          <InputGroupAddon align="inline-end">
            <IconButton
              size="lg"
              variant="ghost"
              aria-label={t(($) => $[showPassword ? 'hidePassword' : 'showPassword'], {
                ns: 'login',
              })}
              onClick={() => setShowPassword(!showPassword)}
            >
              <span aria-hidden="true">{showPassword ? '👀' : '😝'}</span>
            </IconButton>
          </InputGroupAddon>
        </InputGroup>
      </Field>

      <div className="mb-2">
        <Button
          type="submit"
          variant="primary"
          disabled={isLoading || !email || !password}
          className="w-full"
        >
          {t(($) => $.signBtn, { ns: 'login' })}
        </Button>
      </div>
    </Form>
  )
}
