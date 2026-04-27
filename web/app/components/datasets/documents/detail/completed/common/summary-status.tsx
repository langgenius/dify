import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { memo, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import Badge from '@/app/components/base/badge'
import { SearchLinesSparkle } from '@/app/components/base/icons/src/vender/knowledge'

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

  if (status !== 'SUMMARIZING')
    return null

  return (
    <Tooltip>
      <TooltipTrigger
        render={(
          <span className="inline-flex">
            <Badge className="border-text-accent-secondary text-text-accent-secondary">
              <SearchLinesSparkle aria-hidden className="mr-0.5 h-3 w-3" />
              <span>{t('list.summary.generating', { ns: 'datasetDocuments' })}</span>
            </Badge>
          </span>
        )}
      />
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  )
}

export default memo(SummaryStatus)
