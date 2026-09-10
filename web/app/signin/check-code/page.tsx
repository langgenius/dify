'use client'
import { Button } from '@langgenius/dify-ui/button'
import { Field, FieldError, FieldLabel } from '@langgenius/dify-ui/field'
import { Form } from '@langgenius/dify-ui/form'
import { Input } from '@langgenius/dify-ui/input'
import { toast } from '@langgenius/dify-ui/toast'
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

type CheckCodeFormValues = {
  code: string
}

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
  const [loading, setLoading] = useState(false)
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

  const verify = async (code: string) => {
    if (loading || isResending || showResendTurnstile) return

    let shouldResetTurnstile = false
    try {
      if (isTurnstileRequired && !verifyTurnstileToken) return

      setLoading(true)
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
          await queryClient.query(profileQueryOptions)
          replaceLoginRedirect(resolvePostLoginRedirect(searchParams), router.replace, basePath)
        }
      } else {
        toast.error(ret.data)
      }
    } catch (error) {
      console.error(error)
    } finally {
      setLoading(false)
      if (shouldResetTurnstile) {
        setVerifyTurnstileToken('')
        setVerifyTurnstileGeneration((value) => value + 1)
      }
    }
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
        <span
          className="i-ri-mail-send-fill size-6 text-text-accent-light-mode-only"
          aria-hidden="true"
        />
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

      <Form<CheckCodeFormValues> onFormSubmit={({ code }) => void verify(code)}>
        <Field name="code">
          <FieldLabel>{t(($) => $['checkCode.verificationCode'], { ns: 'login' })}</FieldLabel>
          <Input
            ref={codeInputRef}
            inputMode="numeric"
            autoComplete="one-time-code"
            spellCheck={false}
            required
            pattern="[0-9]{6}"
            maxLength={6}
            placeholder={
              t(($) => $['checkCode.verificationCodePlaceholder'], { ns: 'login' }) as string
            }
          />
          <FieldError match="valueMissing">
            {t(($) => $['checkCode.emptyCode'], { ns: 'login' })}
          </FieldError>
          <FieldError match="patternMismatch">
            {t(($) => $['checkCode.invalidCode'], { ns: 'login' })}
          </FieldError>
        </Field>
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
            isResending || showResendTurnstile || (isTurnstileRequired && !verifyTurnstileToken)
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
      </Form>
      <div className="py-2">
        <div className="h-px bg-linear-to-r from-background-gradient-mask-transparent via-divider-regular to-background-gradient-mask-transparent"></div>
      </div>
      <button
        type="button"
        onClick={() => router.back()}
        className="flex h-9 cursor-pointer appearance-none items-center justify-center text-text-tertiary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
      >
        <span className="inline-block rounded-full bg-background-default-dimmed p-1">
          <span className="i-ri-arrow-left-line size-3" aria-hidden="true" />
        </span>
        <span className="ml-2 system-xs-regular">{t(($) => $.back, { ns: 'login' })}</span>
      </button>
    </div>
  )
}
