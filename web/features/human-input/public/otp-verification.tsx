import type { HumanInputV2Challenge } from './types'
import { Button } from '@langgenius/dify-ui/button'
import { Field, FieldDescription, FieldError, FieldLabel } from '@langgenius/dify-ui/field'
import { Input } from '@langgenius/dify-ui/input'
import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

type OtpVerificationProps = {
  otpCode: string
  requesting: boolean
  submitting: boolean
  error?: string
  challenge?: HumanInputV2Challenge
  now?: () => number
  focusOnMount?: boolean
  onOtpChange: (value: string) => void
  onRetry: () => void
  onResend: () => void
}

const OtpVerification = ({
  otpCode,
  requesting,
  submitting,
  error,
  challenge,
  now = Date.now,
  focusOnMount = false,
  onOtpChange,
  onRetry,
  onResend,
}: OtpVerificationProps) => {
  const { t } = useTranslation(['share'])
  const resendLabelId = useId()
  const codeRef = useRef<HTMLInputElement>(null)
  const focusCodeRef = useRef(focusOnMount)
  useEffect(() => {
    if (challenge && focusCodeRef.current) {
      codeRef.current?.focus()
      focusCodeRef.current = false
    }
  }, [challenge])
  const [clock, setClock] = useState(now)
  useEffect(() => {
    if (!challenge) return
    const update = () => setClock(now())
    const timer = window.setInterval(update, 1000)
    window.addEventListener('focus', update)
    document.addEventListener('visibilitychange', update)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', update)
      document.removeEventListener('visibilitychange', update)
    }
  }, [challenge, now])
  const secondsUntilResend = challenge
    ? Math.max(0, Math.ceil((challenge.resendAt - clock) / 1000))
    : 0
  const secondsUntilExpiry = challenge
    ? Math.max(0, Math.ceil((challenge.expiresAt - clock) / 1000))
    : 0

  return (
    <div className="my-3 rounded-xl border border-divider-subtle bg-background-section p-3">
      <Field name="otp_code" invalid={Boolean(error)}>
        <FieldLabel>{t(($) => $['humanInputV2.otpLabel'], { ns: 'share' })}</FieldLabel>
        <FieldDescription>
          {requesting
            ? t(($) => $['humanInputV2.requestingCode'], { ns: 'share' })
            : challenge
              ? t(($) => $['humanInputV2.codeSent'], { ns: 'share' })
              : t(($) => $['humanInputV2.codeRequired'], { ns: 'share' })}
        </FieldDescription>
        {challenge && (
          <Input
            ref={codeRef}
            value={otpCode}
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            required
            readOnly={submitting}
            maxLength={6}
            placeholder={t(($) => $['humanInputV2.otpPlaceholder'], { ns: 'share' })}
            onChange={(event) => onOtpChange(event.target.value)}
          />
        )}
        {error && (
          <FieldError match role="alert">
            {error}
          </FieldError>
        )}
      </Field>
      <div className="mt-3 flex items-center justify-between gap-3">
        {challenge ? (
          <>
            <div className="system-xs-regular text-text-tertiary">
              {t(($) => $['humanInputV2.codeExpiresIn'], {
                ns: 'share',
                seconds: secondsUntilExpiry,
              })}
            </div>
            <Button
              size="small"
              variant="ghost"
              loading={requesting}
              disabled={submitting || secondsUntilResend > 0}
              focusableWhenDisabled
              aria-labelledby={resendLabelId}
              onClick={onResend}
            >
              <span id={resendLabelId}>
                {t(($) => $['humanInputV2.resendCode'], { ns: 'share' })}
              </span>
              {secondsUntilResend > 0 && <span aria-hidden>({secondsUntilResend})</span>}
            </Button>
          </>
        ) : (
          <Button
            size="small"
            loading={requesting}
            disabled={submitting}
            onClick={() => {
              focusCodeRef.current = true
              onRetry()
            }}
          >
            {t(($) => $['humanInputV2.sendCode'], { ns: 'share' })}
          </Button>
        )}
      </div>
    </div>
  )
}

export default OtpVerification
