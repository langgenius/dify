import { Button } from '@langgenius/dify-ui/button'
import { Input } from '@langgenius/dify-ui/input'
import { useTranslation } from 'react-i18next'

type OtpVerificationProps = {
  otpCode: string
  requesting: boolean
  error?: string
  secondsUntilResend: number
  secondsUntilExpiry: number
  hasChallenge: boolean
  onOtpChange: (value: string) => void
  onRetry: () => void
  onResend: () => void
}

const OtpVerification = ({
  otpCode,
  requesting,
  error,
  secondsUntilResend,
  secondsUntilExpiry,
  hasChallenge,
  onOtpChange,
  onRetry,
  onResend,
}: OtpVerificationProps) => {
  const { t } = useTranslation()

  return (
    <div className="my-3 rounded-xl border border-divider-subtle bg-background-section p-3">
      <label htmlFor="human-input-v2-otp" className="system-sm-semibold text-text-primary">
        {t(($) => $['humanInputV2.otpLabel'], { ns: 'share' })}
      </label>
      <div className="mt-1 system-xs-regular text-text-secondary">
        {requesting
          ? t(($) => $['humanInputV2.requestingCode'], { ns: 'share' })
          : hasChallenge
            ? t(($) => $['humanInputV2.codeSent'], { ns: 'share' })
            : t(($) => $['humanInputV2.codeRequired'], { ns: 'share' })}
      </div>
      {hasChallenge && (
        <Input
          id="human-input-v2-otp"
          className="mt-3"
          value={otpCode}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          aria-invalid={Boolean(error)}
          placeholder={t(($) => $['humanInputV2.otpPlaceholder'], { ns: 'share' })}
          onChange={(event) => onOtpChange(event.target.value)}
        />
      )}
      {error && (
        <div role="alert" className="mt-2 system-xs-regular text-text-destructive">
          {error}
        </div>
      )}
      <div className="mt-3 flex items-center justify-between gap-3">
        {hasChallenge ? (
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
              disabled={requesting || secondsUntilResend > 0}
              onClick={onResend}
            >
              {secondsUntilResend > 0
                ? t(($) => $['humanInputV2.resendIn'], {
                    ns: 'share',
                    seconds: secondsUntilResend,
                  })
                : t(($) => $['humanInputV2.resendCode'], { ns: 'share' })}
            </Button>
          </>
        ) : (
          <Button size="small" disabled={requesting} onClick={onRetry}>
            {t(($) => $['humanInputV2.sendCode'], { ns: 'share' })}
          </Button>
        )}
      </div>
    </div>
  )
}

export default OtpVerification
