'use client'
import { Button } from '@langgenius/dify-ui/button'
import { toast } from '@langgenius/dify-ui/toast'
import { noop } from 'es-toolkit/function'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { resolveWebAppLoginRedirect } from '@/app/(shareLayout)/webapp-signin/login-redirect'
import Input from '@/app/components/base/input'
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
        setWebAppPassport(loginRedirect.appCode, access_token)
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
    <form onSubmit={noop}>
      <div className="mb-3">
        <label htmlFor="email" className="my-2 system-md-semibold text-text-secondary">
          {t(($) => $.email, { ns: 'login' })}
        </label>
        <div className="mt-1">
          <Input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            id="email"
            type="email"
            autoComplete="email"
            placeholder={t(($) => $.emailPlaceholder, { ns: 'login' }) || ''}
            tabIndex={1}
          />
        </div>
      </div>

      <div className="mb-3">
        <label htmlFor="password" className="my-2 flex items-center justify-between">
          <span className="system-md-semibold text-text-secondary">
            {t(($) => $.password, { ns: 'login' })}
          </span>
          <Link
            href={`/webapp-reset-password?${searchParams.toString()}`}
            className={`system-xs-regular ${isEmailSetup ? 'text-components-button-secondary-accent-text' : 'pointer-events-none text-components-button-secondary-accent-text-disabled'}`}
            tabIndex={isEmailSetup ? 0 : -1}
            aria-disabled={!isEmailSetup}
          >
            {t(($) => $.forget, { ns: 'login' })}
          </Link>
        </label>
        <div className="relative mt-1">
          <Input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            id="password"
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleEmailPasswordLogin()
            }}
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            placeholder={t(($) => $.passwordPlaceholder, { ns: 'login' }) || ''}
            tabIndex={2}
          />
          <div className="absolute inset-y-0 right-0 flex items-center">
            <Button type="button" variant="ghost" onClick={() => setShowPassword(!showPassword)}>
              {showPassword ? '👀' : '😝'}
            </Button>
          </div>
        </div>
      </div>

      <div className="mb-2">
        <Button
          tabIndex={2}
          variant="primary"
          onClick={handleEmailPasswordLogin}
          disabled={isLoading || !email || !password}
          className="w-full"
        >
          {t(($) => $.signBtn, { ns: 'login' })}
        </Button>
      </div>
    </form>
  )
}
