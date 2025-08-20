import Button from '@/app/components/base/button'
import { BlockEnum } from '@/app/components/workflow/types'
import type { NodeTracing } from '@/types/workflow'
import { RiLoader2Line } from '@remixicon/react'
import React, { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ChunkCardList } from '../../../../chunk-card-list'

type ResultTextProps = {
  isRunning?: boolean
  outputs?: any
  error?: string
  tracing?: NodeTracing[]
  onSwitchToDetail: () => void
}

const ResultPreview = ({
  isRunning,
  outputs,
  error,
  tracing,
  onSwitchToDetail,
}: ResultTextProps) => {
  const { t } = useTranslation()

  const chunkInfo = useMemo(() => {
    if (!outputs || !tracing)
      return undefined
    const knowledgeIndexNode = tracing.find(node => node.node_type === BlockEnum.KnowledgeBase)
    return knowledgeIndexNode?.inputs?.chunks
  }, [outputs, tracing])

  return (
    <>
      {isRunning && !outputs && (
        <div className='flex grow flex-col items-center justify-center gap-y-2 pb-20'>
          <RiLoader2Line className='size-4 animate-spin' />
          <div className='system-sm-regular text-text-tertiary'>{t('pipeline.result.resultPreview.loading')}</div>
        </div>
      )}
      {!isRunning && error && (
        <div className='flex grow flex-col items-center justify-center gap-y-2 pb-20'>
          <div className='system-sm-regular text-text-tertiary'>{t('pipeline.result.resultPreview.error')}</div>
          <Button onClick={onSwitchToDetail}>
            {t('pipeline.result.resultPreview.viewDetails')}
          </Button>
        </div>
      )}
      {outputs && (
        <div className='flex grow flex-col bg-background-body p-1'>
          {!!chunkInfo && <ChunkCardList chunkInfo={chunkInfo} />}
          <div className='system-xs-regular mt-1 flex items-center gap-x-2 text-text-tertiary'>
            <div className='h-px flex-1 bg-gradient-to-r from-background-gradient-mask-transparent to-divider-regular' />
            <span className='shrink-0truncate' title={t('pipeline.result.resultPreview.footerTip', { count: 20 })}>
              {t('pipeline.result.resultPreview.footerTip', { count: 20 })}
            </span>
            <div className='h-px flex-1 bg-gradient-to-l from-background-gradient-mask-transparent to-divider-regular' />
          </div>
        </div>
      )}
    </>
  )
}

export default React.memo(ResultPreview)
