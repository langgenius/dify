import type { ExternalConnectionFailure } from './external-connection-errors'
import type { ExternalConnectionVerificationState } from './external-connection-verification'
import { Alert, AlertDescription, AlertTitle } from '@langgenius/dify-ui/alert'
import { useTranslation } from 'react-i18next'

type ExternalConnectionFeedbackProps = {
  verification: ExternalConnectionVerificationState
  failure?: ExternalConnectionFailure
  executionEnabled?: boolean
  showVerifiedStatus?: boolean
}

export function ExternalConnectionFeedback({
  verification,
  failure,
  executionEnabled = true,
  showVerifiedStatus = true,
}: ExternalConnectionFeedbackProps) {
  const { t } = useTranslation(['agentRoster'])
  const verified = verification.status === 'verified'
  const verifiedLabel =
    verified && verification.evidence.auth_check === 'passed_for_read_endpoint'
      ? t(($) => $['external.connection.authReadPassed'])
      : t(($) => $['external.connection.authNotExercised'])
  const failureTitle = t(($) => $['external.connection.errors.unknown'])

  return (
    <>
      {showVerifiedStatus && verified && (
        <p role="status" className="system-xs-regular text-text-success">
          {verifiedLabel}
        </p>
      )}
      {verification.status === 'failed' && !failure?.field && (
        <Alert type="error">
          <AlertTitle>{failureTitle}</AlertTitle>
          {failure && failure.message !== failureTitle && (
            <AlertDescription>
              {failure.message}
              {failure.details && failure.details.length > 0 && (
                <ul className="list-disc ps-4">
                  {failure.details.map((detail) => (
                    <li key={detail}>{detail}</li>
                  ))}
                </ul>
              )}
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
