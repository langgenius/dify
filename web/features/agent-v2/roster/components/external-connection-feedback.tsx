import type { ExternalConnectionVerificationState } from './external-connection-verification'
import { Alert, AlertDescription, AlertTitle } from '@langgenius/dify-ui/alert'
import { useTranslation } from 'react-i18next'

type ExternalConnectionFeedbackProps = {
  verification: ExternalConnectionVerificationState
  executionEnabled?: boolean
  editing?: boolean
  showVerifiedStatus?: boolean
}

export function ExternalConnectionFeedback({
  verification,
  executionEnabled = true,
  editing = false,
  showVerifiedStatus = true,
}: ExternalConnectionFeedbackProps) {
  const { t } = useTranslation(['agentRoster'])
  const verified = verification.status === 'verified'
  const verifiedLabel =
    verified && verification.evidence.auth_check === 'passed_for_read_endpoint'
      ? t(($) => $['external.connection.authReadPassed'])
      : t(($) => $['external.connection.authNotExercised'])
  const verificationErrors = {
    authentication_failed: t(($) => $['external.connection.errors.authentication']),
    connection_failed: t(($) => $['external.connection.errors.unreachable']),
    unsupported_protocol: t(($) => $['external.connection.errors.unsupported']),
    invalid_agent_card: t(($) => $['external.connection.errors.invalidAgentCard']),
  }
  const failureTitle = t(($) => $['external.connection.errors.unknown'])
  const failureReason =
    verification.status === 'failed'
      ? verification.reason
        ? verificationErrors[verification.reason]
        : verification.message
      : undefined
  const genericFailure =
    !failureReason ||
    failureReason === failureTitle ||
    /^could not verify the connection\.?$/i.test(failureReason.trim())

  return (
    <>
      {showVerifiedStatus && verified && (
        <p role="status" className="system-xs-regular text-text-success">
          {verifiedLabel}
        </p>
      )}
      {verification.status === 'failed' && (
        <Alert type="error">
          <AlertTitle>{failureTitle}</AlertTitle>
          {(!editing || !genericFailure) && (
            <AlertDescription>
              {genericFailure
                ? t(($) => $['external.connection.errors.changesKept'])
                : failureReason}
            </AlertDescription>
          )}
        </Alert>
      )}
      {verification.status === 'expired' && (
        <Alert type="warning">
          <AlertTitle>{t(($) => $['external.connection.proofExpired'])}</AlertTitle>
        </Alert>
      )}
      {!executionEnabled && !verified && (
        <Alert type="warning">
          <AlertTitle>{t(($) => $['external.api.executionDisabled'])}</AlertTitle>
        </Alert>
      )}
    </>
  )
}
