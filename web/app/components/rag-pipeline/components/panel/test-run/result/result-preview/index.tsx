import { RiLoader2Line } from '@remixicon/react'
import * as React from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import { RAG_PIPELINE_PREVIEW_CHUNK_NUM } from '@/config'
import { ChunkCardList } from '../../../../chunk-card-list'
import { formatPreviewChunks } from './utils'

type ResultTextProps = {
  isRunning?: boolean
  outputs?: any
  error?: string
  onSwitchToDetail: () => void
}

const ResultPreview = ({
  isRunning,
  outputs,
  error,
  onSwitchToDetail,
}: ResultTextProps) => {
  const { t } = useTranslation()

  const previewChunks = useMemo(() => {
    return formatPreviewChunks(outputs)
  }, [outputs])

  return (
    <>
      {isRunning && !outputs && (
        <div className="flex grow flex-col items-center justify-center gap-y-2 pb-20">
          <RiLoader2Line className="size-4 animate-spin text-text-tertiary" />
          <div className="system-sm-regular text-text-tertiary">{t('result.resultPreview.loading', { ns: 'pipeline' })}</div>
        </div>
      )}
      {!isRunning && error && (
        <div className="flex grow flex-col items-center justify-center gap-y-2 pb-20">
          <div className="system-sm-regular text-text-tertiary">{t('result.resultPreview.error', { ns: 'pipeline' })}</div>
          <Button onClick={onSwitchToDetail}>
            {t('result.resultPreview.viewDetails', { ns: 'pipeline' })}
          </Button>
        </div>
      )}
      {outputs && previewChunks && (
        <div className="flex grow flex-col bg-background-body p-1">
          <ChunkCardList chunkType={outputs.chunk_structure} chunkInfo={previewChunks} />
          <div className="system-xs-regular mt-1 flex items-center gap-x-2 text-text-tertiary">
            <div className="h-px flex-1 bg-gradient-to-r from-background-gradient-mask-transparent to-divider-regular" />
            <span className="shrink-0truncate" title={t('result.resultPreview.footerTip', { ns: 'pipeline', count: RAG_PIPELINE_PREVIEW_CHUNK_NUM })}>
              {t('result.resultPreview.footerTip', { ns: 'pipeline', count: RAG_PIPELINE_PREVIEW_CHUNK_NUM })}
            </span>
            <div className="h-px flex-1 bg-gradient-to-l from-background-gradient-mask-transparent to-divider-regular" />
          </div>
        </div>
      )}
    </>
  )
}

export default React.memo(ResultPreview)
