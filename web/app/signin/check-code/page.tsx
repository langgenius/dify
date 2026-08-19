'use client'
import type { FormEvent } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import { Input } from '@langgenius/dify-ui/input'
import { toast } from '@langgenius/dify-ui/toast'
import { RiArrowLeftLine, RiMailSendFill } from '@remixicon/react'
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { trackEvent } from '@/app/components/base/amplitude'
import Countdown from '@/app/components/signin/countdown'
import { COUNT_DOWN_TIME_MS, useSetCountdownLeftTime } from '@/app/components/signin/storage'
import { TURNSTILE_SITE_KEY } from '@/config'
import { useLocale } from '@/context/i18n'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import useDocumentTitle from '@/hooks/use-document-title'
import { useRouter, useSearchParams } from '@/next/navigation'
import { emailLoginWithCode, sendEMailLoginCode } from '@/service/common'
import { encryptVerificationCode } from '@/utils/encryption'
import { replaceLoginRedirect } from '@/utils/login-redirect.client'
import { getBrowserTimezone } from '@/utils/timezone'
import { basePath } from '@/utils/var'
import Turnstile from '../components/turnstile'
import { resolvePostLoginRedirect } from '../utils/post-login-redirect'

export default function CheckCode() {
  const { t, i18n } = useTranslation()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const searchParams = useSearchParams()
  const email = decodeURIComponent(searchParams.get('email') as string)
  const token = decodeURIComponent(searchParams.get('token') as string)
  const invite_token = decodeURIComponent(searchParams.get('invite_token') || '')
  const language = i18n.language
  const [code, setVerifyCode] = useState('')
  const [loading, setIsLoading] = useState(false)
  const [isResending, setIsResending] = useState(false)
  const [verifyTurnstileToken, setVerifyTurnstileToken] = useState('')
  const [verifyTurnstileGeneration, setVerifyTurnstileGeneration] = useState(0)
  const [showResendTurnstile, setShowResendTurnstile] = useState(false)
  const [countdownGeneration, setCountdownGeneration] = useState(0)
  const locale = useLocale()
  const setCountdownLeftTime = useSetCountdownLeftTime()
  const codeInputRef = useRef<HTMLInputElement>(null)
  const turnstileSiteKey = TURNSTILE_SITE_KEY.trim()
  const isTurnstileRequired = systemFeatures.deployment_edition === 'CLOUD'
  const shouldRenderTurnstile = isTurnstileRequired && Boolean(turnstileSiteKey)
  const pageTitle = t(($) => $['checkCode.checkYourEmail'], { ns: 'login' })
  useDocumentTitle(pageTitle)

  const verify = async () => {
    if (loading || isResending || showResendTurnstile) return

    let shouldResetTurnstile = false
    try {
      if (!code.trim()) {
        toast.error(t(($) => $['checkCode.emptyCode'], { ns: 'login' }))
        return
      }
      if (!/^\d{6}$/.test(code)) {
        toast.error(t(($) => $['checkCode.invalidCode'], { ns: 'login' }))
        return
      }
      if (isTurnstileRequired && !verifyTurnstileToken) return

      setIsLoading(true)
      shouldResetTurnstile = isTurnstileRequired
      const ret = await emailLoginWithCode({
        email,
        code: encryptVerificationCode(code),
        token,
        language,
        timezone: getBrowserTimezone(),
        ...(isTurnstileRequired ? { turnstile_token: verifyTurnstileToken } : {}),
      })
      if (ret.result === 'success') {
        // Track login success event
        trackEvent('user_login_success', {
          method: 'email_code',
          is_invite: !!invite_token,
        })

        if (invite_token) {
          router.replace(`/signin/invite-settings?${searchParams.toString()}`)
        } else {
          const profileQueryOptions = userProfileQueryOptions()
          await queryClient.resetQueries({ queryKey: profileQueryOptions.queryKey })
          await queryClient.fetchQuery(profileQueryOptions)
          replaceLoginRedirect(resolvePostLoginRedirect(searchParams), router.replace, basePath)
        }
      }
    } catch (error) {
      console.error(error)
    } finally {
      setIsLoading(false)
      if (shouldResetTurnstile) {
        setVerifyTurnstileToken('')
        setVerifyTurnstileGeneration((value) => value + 1)
      }
    }
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    verify()
  }

  useEffect(() => {
    codeInputRef.current?.focus()
  }, [])

  const resendCode = async (turnstileToken?: string) => {
    setIsResending(true)
    try {
      const ret = await sendEMailLoginCode(
        email,
        locale,
        isTurnstileRequired ? turnstileToken : undefined,
      )
      if (ret.result === 'success') {
        setCountdownLeftTime(`${COUNT_DOWN_TIME_MS}`)
        setCountdownGeneration((value) => value + 1)
        const params = new URLSearchParams(searchParams)
        params.set('token', encodeURIComponent(ret.data))
        router.replace(`/signin/check-code?${params.toString()}`)
      }
    } catch (error) {
      console.error(error)
    } finally {
      setIsResending(false)
      setShowResendTurnstile(false)
    }
  }

  const handleResend = () => {
    if (loading || isResending) return

    if (isTurnstileRequired) {
      setVerifyTurnstileToken('')
      setShowResendTurnstile(true)
      return
    }
    void resendCode()
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="inline-flex size-14 items-center justify-center rounded-2xl border border-components-panel-border-subtle bg-background-default-dodge shadow-lg">
        <RiMailSendFill className="size-6 text-2xl text-text-accent-light-mode-only" />
      </div>
      <div className="pt-2 pb-4">
        <h1 className="title-4xl-semi-bold text-text-primary">{pageTitle}</h1>
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
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          value={code}
          onChange={(e) => setVerifyCode(e.target.value)}
          maxLength={6}
          className="mt-1"
          placeholder={
            t(($) => $['checkCode.verificationCodePlaceholder'], { ns: 'login' }) as string
          }
        />
        {shouldRenderTurnstile && (
          <Turnstile
            action={showResendTurnstile ? 'signin_code' : 'signin_code_verify'}
            resetKey={verifyTurnstileGeneration}
            siteKey={turnstileSiteKey}
            onVerify={(turnstileToken) => {
              if (showResendTurnstile) {
                void resendCode(turnstileToken)
                return
              }
              setVerifyTurnstileToken(turnstileToken)
            }}
            onInvalidate={() => {
              if (showResendTurnstile) {
                setShowResendTurnstile(false)
                return
              }
              setVerifyTurnstileToken('')
            }}
            onError={() => {
              setVerifyTurnstileToken('')
            }}
          />
        )}
        <Button
          type="submit"
          loading={loading}
          disabled={
            loading ||
            isResending ||
            showResendTurnstile ||
            (isTurnstileRequired && !verifyTurnstileToken)
          }
          className="my-3 w-full"
          variant="primary"
        >
          {t(($) => $['checkCode.verify'], { ns: 'login' })}
        </Button>
        <Countdown
          key={countdownGeneration}
          onResend={handleResend}
          resendDisabled={
            loading ||
            isResending ||
            showResendTurnstile ||
            (isTurnstileRequired && !turnstileSiteKey)
          }
          restartOnResend={false}
        />
      </form>
      <div className="py-2">
        <div className="h-px bg-linear-to-r from-background-gradient-mask-transparent via-divider-regular to-background-gradient-mask-transparent"></div>
      </div>
      <button
        type="button"
        onClick={() => router.back()}
        className="flex h-9 cursor-pointer appearance-none items-center justify-center text-text-tertiary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
      >
        <span className="inline-block rounded-full bg-background-default-dimmed p-1">
          <RiArrowLeftLine aria-hidden size={12} />
        </span>
        <span className="ml-2 system-xs-regular">{t(($) => $.back, { ns: 'login' })}</span>
      </button>
    </div>
  )
}
