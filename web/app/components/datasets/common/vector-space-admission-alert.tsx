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
  const { t } = useTranslation()

  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-xl border border-state-destructive-border bg-state-destructive-hover-alt p-3"
    >
      <span className="mt-0.5 i-ri-error-warning-fill size-4 shrink-0 text-text-destructive" />
      <div className="grow">
        <div className="system-sm-semibold text-text-destructive">
          {t(($) => $['embedding.vectorSpaceEstimateExceeded.title'], {
            ns: 'datasetDocuments',
          })}
        </div>
        <div className="mt-0.5 body-xs-regular text-text-secondary">
          {t(($) => $['embedding.vectorSpaceEstimateExceeded.description'], {
            ns: 'datasetDocuments',
            estimated: estimatedMb,
            limit: planLimitMb,
          })}
        </div>
      </div>
      {showUpgrade && <UpgradeBtn loc="knowledge-vector-space-admission" />}
    </div>
  )
}

export default VectorSpaceAdmissionAlert
