'use client'
import type { HumanInputV2ErrorCategory, HumanInputV2FormTransport } from './types'
import { Button } from '@langgenius/dify-ui/button'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import FormStatusCard from '@/features/human-input-form/form-status-card'
import LoadedFormContent from '@/features/human-input-form/loaded-form-content'
import OtpVerification from './otp-verification'
import { HumanInputV2FormTransportProvider } from './transport'
import { useHumanInputV2FormTransport } from './transport-context'
import { useHumanInputV2FormSession } from './use-form-session'

type HumanInputV2FormProps = {
  token: string
  transport?: HumanInputV2FormTransport
  now?: () => number
}

const getBrandingOptions = (
  definition: ReturnType<typeof useHumanInputV2FormSession>['state']['definition'],
) => {
  const customConfig = definition?.branding?.customConfig
  return {
    removeWebappBrand: customConfig?.remove_webapp_brand === true,
    replaceWebappLogo:
      typeof customConfig?.replace_webapp_logo === 'string'
        ? customConfig.replace_webapp_logo
        : null,
  }
}

const HumanInputV2Form = ({ token, transport: injectedTransport, now }: HumanInputV2FormProps) => {
  const { t } = useTranslation()
  const contextTransport = useHumanInputV2FormTransport()
  const transport = injectedTransport ?? contextTransport
  const session = useHumanInputV2FormSession({
    token,
    transport,
    now,
  })
  const { state } = session

  const errorCopy = (category?: HumanInputV2ErrorCategory) => {
    switch (category) {
      case 'not-found':
        return t(($) => $['humanInputV2.formNotFound'], { ns: 'share' })
      case 'form-expired':
        return t(($) => $['humanInputV2.formExpired'], { ns: 'share' })
      case 'already-submitted':
        return t(($) => $['humanInputV2.alreadySubmitted'], { ns: 'share' })
      case 'form-rate-limit':
        return t(($) => $['humanInputV2.formRateLimited'], { ns: 'share' })
      case 'access-rate-limit':
        return t(($) => $['humanInputV2.accessRateLimited'], { ns: 'share' })
      case 'access-delivery-failed':
        return t(($) => $['humanInputV2.deliveryFailed'], { ns: 'share' })
      case 'invalid-otp':
        return t(($) => $['humanInputV2.invalidOtp'], { ns: 'share' })
      case 'challenge-expired':
        return t(($) => $['humanInputV2.challengeExpired'], { ns: 'share' })
      case 'challenge-stale':
        return t(($) => $['humanInputV2.challengeStale'], { ns: 'share' })
      case 'upload-failed':
        return t(($) => $['humanInputV2.uploadFailed'], { ns: 'share' })
      case 'network':
        return t(($) => $['humanInputV2.networkError'], { ns: 'share' })
      case 'unavailable':
        return t(($) => $['humanInputV2.unavailable'], { ns: 'share' })
      default:
        return t(($) => $['humanInputV2.unknownError'], { ns: 'share' })
    }
  }

  if (state.phase === 'loading-form') return <Loading type="app" />

  if (state.phase === 'success') {
    return (
      <FormStatusCard
        iconClassName="i-ri-checkbox-circle-fill text-text-success"
        title={t(($) => $['humanInput.thanks'], { ns: 'share' })}
        subtitle={t(($) => $['humanInput.recorded'], { ns: 'share' })}
        submissionID={token}
        {...getBrandingOptions(state.definition)}
      />
    )
  }

  if (state.phase === 'terminal' || state.phase === 'form-error') {
    return (
      <FormStatusCard
        iconClassName="i-ri-error-warning-fill text-text-destructive"
        title={errorCopy(state.error)}
        subtitle={
          state.phase === 'form-error' ? (
            <Button size="small" onClick={session.retryForm}>
              {t(($) => $['humanInputV2.retry'], { ns: 'share' })}
            </Button>
          ) : undefined
        }
        {...getBrandingOptions(state.definition)}
      />
    )
  }

  if (!state.definition) return <Loading type="app" />

  const verificationError = state.error ? errorCopy(state.error) : undefined

  return (
    <HumanInputV2FormTransportProvider transport={transport}>
      <LoadedFormContent
        key={token}
        definition={state.definition}
        isSubmitting={state.phase === 'submitting'}
        actionsDisabled={!session.canSubmit}
        onSubmit={session.submit}
        verificationContent={
          <OtpVerification
            otpCode={state.otpCode}
            requesting={state.phase === 'requesting-otp'}
            error={verificationError}
            secondsUntilResend={session.secondsUntilResend}
            secondsUntilExpiry={session.secondsUntilExpiry}
            hasChallenge={Boolean(state.challenge)}
            onOtpChange={session.setOtpCode}
            onRetry={session.retryAccess}
            onResend={session.resendAccess}
          />
        }
      />
    </HumanInputV2FormTransportProvider>
  )
}

export default HumanInputV2Form
