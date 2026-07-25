'use client'
import type { FormEvent } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import { toast } from '@langgenius/dify-ui/toast'
import { RiArrowLeftLine, RiMailSendFill } from '@remixicon/react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { resolveWebAppLoginRedirect } from '@/app/(shareLayout)/webapp-signin/login-redirect'
import Input from '@/app/components/base/input'
import Countdown from '@/app/components/signin/countdown'
import { useLocale } from '@/context/i18n'
import { useWebAppStore } from '@/context/web-app-context'
import { useRouter, useSearchParams } from '@/next/navigation'
import { sendWebAppEMailLoginCode, webAppEmailLoginWithCode } from '@/service/common'
import { fetchAccessToken } from '@/service/share'
import { setWebAppAccessToken, setWebAppPassport } from '@/service/webapp-auth'
import { encryptVerificationCode } from '@/utils/encryption'
import { getClientLoginFallback } from '@/utils/login-redirect'
import { replaceLoginRedirect } from '@/utils/login-redirect.client'
import { basePath } from '@/utils/var'

export default function CheckCode() {
  const { t } = useTranslation()
  const router = useRouter()
  const searchParams = useSearchParams()
  const email = decodeURIComponent(searchParams.get('email') as string)
  const token = decodeURIComponent(searchParams.get('token') as string)
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const locale = useLocale()
  const codeInputRef = useRef<HTMLInputElement>(null)
  const redirectUrl = searchParams.get('redirect_url')
  const embeddedUserId = useWebAppStore((s) => s.embeddedUserId)

  useEffect(() => {
    if (!resolveWebAppLoginRedirect(redirectUrl, window.location.origin))
      replaceLoginRedirect(getClientLoginFallback(), router.replace, basePath)
  }, [redirectUrl, router])

  const verify = async () => {
    const loginRedirect = resolveWebAppLoginRedirect(redirectUrl, window.location.origin)
    if (!loginRedirect) {
      replaceLoginRedirect(getClientLoginFallback(), router.replace, basePath)
      return
    }
    try {
      if (!code.trim()) {
        toast.error(t(($) => $['checkCode.emptyCode'], { ns: 'login' }))
        return
      }
      if (!/\d{6}/.test(code)) {
        toast.error(t(($) => $['checkCode.invalidCode'], { ns: 'login' }))
        return
      }
      setLoading(true)
      const ret = await webAppEmailLoginWithCode({
        email,
        code: encryptVerificationCode(code),
        token,
      })
      if (ret.result === 'success') {
        if (ret?.data?.access_token) {
          setWebAppAccessToken(ret.data.access_token)
        }
        const { access_token } = await fetchAccessToken({
          appCode: loginRedirect.appCode,
          userId: embeddedUserId || undefined,
        })
        setWebAppPassport(loginRedirect.appCode, access_token)
        replaceLoginRedirect(loginRedirect.target, router.replace, basePath)
      }
    } catch (error) {
      console.error(error)
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    verify()
  }

  useEffect(() => {
    codeInputRef.current?.focus()
  }, [])

  const resendCode = async () => {
    const loginRedirect = resolveWebAppLoginRedirect(redirectUrl, window.location.origin)
    if (!loginRedirect) {
      replaceLoginRedirect(getClientLoginFallback(), router.replace, basePath)
      return
    }
    try {
      const ret = await sendWebAppEMailLoginCode(email, locale)
      if (ret.result === 'success') {
        const params = new URLSearchParams(searchParams)
        params.set('token', encodeURIComponent(ret.data))
        params.set('redirect_url', loginRedirect.target.href)
        router.replace(`/webapp-signin/check-code?${params.toString()}`)
      }
    } catch (error) {
      console.error(error)
    }
  }

  return (
    <div className="flex w-[400px] flex-col gap-3">
      <div className="inline-flex size-14 items-center justify-center rounded-2xl border border-components-panel-border-subtle bg-background-default-dodge shadow-lg">
        <RiMailSendFill className="size-6 text-2xl text-text-accent-light-mode-only" />
      </div>
      <div className="pt-2 pb-4">
        <h2 className="title-4xl-semi-bold text-text-primary">
          {t(($) => $['checkCode.checkYourEmail'], { ns: 'login' })}
        </h2>
        <p className="mt-2 body-md-regular text-text-secondary">
          <span>
            {t(($) => $['checkCode.tipsPrefix'], { ns: 'login' })}
            <strong>{email}</strong>
          </span>
          <br />
          {t(($) => $['checkCode.validTime'], { ns: 'login' })}
        </p>
      </div>

      <form onSubmit={handleSubmit}>
        <label htmlFor="code" className="mb-1 system-md-semibold text-text-secondary">
          {t(($) => $['checkCode.verificationCode'], { ns: 'login' })}
        </label>
        <Input
          ref={codeInputRef}
          id="code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          maxLength={6}
          className="mt-1"
          placeholder={t(($) => $['checkCode.verificationCodePlaceholder'], { ns: 'login' }) || ''}
        />
        <Button
          type="submit"
          loading={loading}
          disabled={loading}
          className="my-3 w-full"
          variant="primary"
        >
          {t(($) => $['checkCode.verify'], { ns: 'login' })}
        </Button>
        <Countdown onResend={resendCode} />
      </form>
      <div className="py-2">
        <div className="h-px bg-linear-to-r from-background-gradient-mask-transparent via-divider-regular to-background-gradient-mask-transparent"></div>
      </div>
      <div
        onClick={() => router.back()}
        className="flex h-9 cursor-pointer items-center justify-center text-text-tertiary"
      >
        <div className="bg-background-default-dimm inline-block rounded-full p-1">
          <RiArrowLeftLine size={12} />
        </div>
        <span className="ml-2 system-xs-regular">{t(($) => $.back, { ns: 'login' })}</span>
      </div>
    </div>
  )
}
