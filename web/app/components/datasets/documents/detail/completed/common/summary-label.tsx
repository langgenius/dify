import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/utils/classnames'

type SummaryLabelProps = {
  summary?: string
  className?: string
}
const SummaryLabel = ({
  summary,
  className,
}: SummaryLabelProps) => {
  const { t } = useTranslation()

  return (
    <div className={cn('space-y-1', className)}>
      <div className="system-xs-medium-uppercase mt-2 flex items-center justify-between text-text-tertiary">
        {t('segment.summary', { ns: 'datasetDocuments' })}
        <div className="ml-2 h-px grow bg-divider-regular"></div>
      </div>
      <div className="body-xs-regular text-text-tertiary">{summary}</div>
    </div>
  )
}

export default memo(SummaryLabel)
