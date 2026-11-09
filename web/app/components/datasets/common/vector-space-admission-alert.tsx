import { Alert, AlertActions, AlertDescription, AlertTitle } from '@langgenius/dify-ui/alert'
import { useTranslation } from 'react-i18next'
import UpgradeBtn from '@/app/components/billing/upgrade-btn'

type VectorSpaceAdmissionAlertProps = {
  showUpgrade: boolean
  estimatedMb: number
  planLimitMb: number
}

const VectorSpaceAdmissionAlert = ({
  showUpgrade,
  estimatedMb,
  planLimitMb,
}: VectorSpaceAdmissionAlertProps) => {
  const { t } = useTranslation(['datasetDocuments'])

  return (
    <Alert type="error">
      <AlertTitle>
        {t(($) => $['embedding.vectorSpaceEstimateExceeded.title'], {
          ns: 'datasetDocuments',
        })}
      </AlertTitle>
      <AlertDescription>
        {t(($) => $['embedding.vectorSpaceEstimateExceeded.description'], {
          ns: 'datasetDocuments',
          estimated: estimatedMb,
          limit: planLimitMb,
        })}
      </AlertDescription>
      {showUpgrade && (
        <AlertActions>
          <UpgradeBtn size="s" loc="knowledge-vector-space-admission" />
        </AlertActions>
      )}
    </Alert>
  )
}

export default VectorSpaceAdmissionAlert
