import type { DataSet } from '@/models/datasets'
import { cn } from '@langgenius/dify-ui/cn'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { RiFileTextFill, RiRobot2Fill } from '@remixicon/react'
import * as React from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'

const EXTERNAL_PROVIDER = 'external'

type DatasetCardFooterProps = {
  dataset: DataSet
}

const DatasetCardFooter = ({ dataset }: DatasetCardFooterProps) => {
  const { t } = useTranslation()
  const { formatTimeFromNow } = useFormatTimeFromNow()
  const isExternalProvider = dataset.provider === EXTERNAL_PROVIDER

  const documentCount = useMemo(() => {
    const availableDocCount = dataset.total_available_documents ?? 0
    if (availableDocCount < dataset.document_count)
      return `${availableDocCount} / ${dataset.document_count}`
    return `${dataset.document_count}`
  }, [dataset.document_count, dataset.total_available_documents])

  const documentCountTooltip = useMemo(() => {
    const availableDocCount = dataset.total_available_documents ?? 0
    if (availableDocCount < dataset.document_count)
      return t('partialEnabled', { ns: 'dataset', count: dataset.document_count, num: availableDocCount })
    return t('docAllEnabled', { ns: 'dataset', count: availableDocCount })
  }, [t, dataset.document_count, dataset.total_available_documents])

  return (
    <div
      className={cn(
        'flex items-center gap-x-3 px-4 pt-2 pb-3 text-text-tertiary',
        !dataset.embedding_available && 'opacity-30',
      )}
    >
      <Tooltip>
        <TooltipTrigger
          render={(
            <div className="flex items-center gap-x-1">
              <RiFileTextFill className="size-3 text-text-quaternary" />
              <span className="system-xs-medium">{documentCount}</span>
            </div>
          )}
        />
        <TooltipContent>
          {documentCountTooltip}
        </TooltipContent>
      </Tooltip>
      {!isExternalProvider && (
        <Tooltip>
          <TooltipTrigger
            render={(
              <div className="flex items-center gap-x-1">
                <RiRobot2Fill className="size-3 text-text-quaternary" />
                <span className="system-xs-medium">{dataset.app_count}</span>
              </div>
            )}
          />
          <TooltipContent>
            {`${dataset.app_count} ${t('appCount', { ns: 'dataset' })}`}
          </TooltipContent>
        </Tooltip>
      )}
      <span className="system-xs-regular text-divider-deep">/</span>
      <span className="system-xs-regular">{`${t('updated', { ns: 'dataset' })} ${formatTimeFromNow(dataset.updated_at * 1000)}`}</span>
    </div>
  )
}

export default React.memo(DatasetCardFooter)
