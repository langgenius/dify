import type { DataSet } from '@/models/datasets'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from '@langgenius/dify-ui/popover'
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

  const documentCountDescription = useMemo(() => {
    const availableDocCount = dataset.total_available_documents ?? 0
    if (availableDocCount < dataset.document_count)
      return t(($) => $.partialEnabled, {
        ns: 'dataset',
        count: dataset.document_count,
        num: availableDocCount,
      })
    return t(($) => $.docAllEnabled, { ns: 'dataset', count: availableDocCount })
  }, [t, dataset.document_count, dataset.total_available_documents])

  return (
    <div
      className={cn(
        'flex items-center gap-x-3 px-4 pt-2 pb-3 text-text-tertiary',
        !dataset.embedding_available && 'opacity-30',
      )}
    >
      <Popover>
        <PopoverTrigger
          onClick={(event) => event.stopPropagation()}
          render={
            <Button variant="ghost" size="small" className="min-w-6 px-1 text-text-tertiary" />
          }
        >
          <span aria-hidden="true" className="i-ri-file-text-fill size-3 text-text-quaternary" />
          <span className="system-xs-medium">{documentCount}</span>
          <span className="sr-only">{t(($) => $['datasetMenus.documents'], { ns: 'common' })}</span>
        </PopoverTrigger>
        <PopoverContent className="p-3" onClick={(event) => event.stopPropagation()}>
          <PopoverTitle className="system-xs-medium text-text-primary">
            {t(($) => $['datasetMenus.documents'], { ns: 'common' })}
          </PopoverTitle>
          <PopoverDescription className="system-xs-regular text-text-secondary">
            {documentCountDescription}
          </PopoverDescription>
        </PopoverContent>
      </Popover>
      {!isExternalProvider && (
        <Popover>
          <PopoverTrigger
            onClick={(event) => event.stopPropagation()}
            render={
              <Button variant="ghost" size="small" className="min-w-6 px-1 text-text-tertiary" />
            }
          >
            <span aria-hidden="true" className="i-ri-robot-2-fill size-3 text-text-quaternary" />
            <span className="system-xs-medium">{dataset.app_count}</span>
            <span className="sr-only">{t(($) => $.appCount, { ns: 'dataset' })}</span>
          </PopoverTrigger>
          <PopoverContent className="p-3" onClick={(event) => event.stopPropagation()}>
            <PopoverTitle className="system-xs-regular text-text-secondary">
              {`${dataset.app_count} ${t(($) => $.appCount, { ns: 'dataset' })}`}
            </PopoverTitle>
          </PopoverContent>
        </Popover>
      )}
      <span className="system-xs-regular text-divider-deep">/</span>
      <span className="system-xs-regular">{`${t(($) => $.updated, { ns: 'dataset' })} ${formatTimeFromNow(dataset.updated_at * 1000)}`}</span>
    </div>
  )
}

export default React.memo(DatasetCardFooter)
