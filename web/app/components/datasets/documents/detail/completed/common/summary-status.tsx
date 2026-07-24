import { memo, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import Badge from '@/app/components/base/badge'
import { SearchLinesSparkle } from '@/app/components/base/icons/src/vender/knowledge'
import Tooltip from '@/app/components/base/tooltip'

type SummaryStatusProps = {
  status: string
}

const SummaryStatus = ({ status }: SummaryStatusProps) => {
  const { t } = useTranslation()

  const tip = useMemo(() => {
    if (status === 'SUMMARIZING') {
      return t('list.summary.generatingSummary', { ns: 'datasetDocuments' })
    }
    return ''
  }, [status, t])

  return (
    <Tooltip
      popupContent={tip}
    >
      {
        status === 'SUMMARIZING' && (
          <Badge className="border-text-accent-secondary text-text-accent-secondary">
            <SearchLinesSparkle className="mr-0.5 h-3 w-3" />
            <span>{t('list.summary.generating', { ns: 'datasetDocuments' })}</span>
          </Badge>
        )
      }
    </Tooltip>
  )
}

export default memo(SummaryStatus)
