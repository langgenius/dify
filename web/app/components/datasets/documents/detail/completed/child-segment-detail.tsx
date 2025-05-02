import React, { type FC, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiCloseLine,
  RiCollapseDiagonalLine,
  RiExpandDiagonalLine,
} from '@remixicon/react'
import ActionButtons from './common/action-buttons'
import ChunkContent from './common/chunk-content'
import Dot from './common/dot'
import { SegmentIndexTag } from './common/segment-index-tag'
import { useSegmentListContext } from './index'
import type { ChildChunkDetail, ChunkingMode } from '@/models/datasets'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { formatNumber } from '@/utils/format'
import classNames from '@/utils/classnames'
import Divider from '@/app/components/base/divider'
import { formatTime } from '@/utils/time'

type IChildSegmentDetailProps = {
  chunkId: string
  childChunkInfo?: Partial<ChildChunkDetail> & { id: string }
  onUpdate: (segmentId: string, childChunkId: string, content: string) => void
  onCancel: () => void
  docForm: ChunkingMode
}

/**
 * Show all the contents of the segment
 */
const ChildSegmentDetail: FC<IChildSegmentDetailProps> = ({
  chunkId,
  childChunkInfo,
  onUpdate,
  onCancel,
  docForm,
}) => {
  const { t } = useTranslation()
  const [content, setContent] = useState(childChunkInfo?.content || '')
  const { eventEmitter } = useEventEmitterContextContext()
  const [loading, setLoading] = useState(false)
  const fullScreen = useSegmentListContext(s => s.fullScreen)
  const toggleFullScreen = useSegmentListContext(s => s.toggleFullScreen)

  eventEmitter?.useSubscription((v) => {
    if (v === 'update-child-segment')
      setLoading(true)
    if (v === 'update-child-segment-done')
      setLoading(false)
  })

  const handleCancel = () => {
    onCancel()
  }

  const handleSave = () => {
    onUpdate(chunkId, childChunkInfo?.id || '', content)
  }

  const wordCountText = useMemo(() => {
    const count = content.length
    return `${formatNumber(count)} ${t('datasetDocuments.segment.characters', { count })}`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content.length])

  const EditTimeText = useMemo(() => {
    const timeText = formatTime({
      date: (childChunkInfo?.updated_at ?? 0) * 1000,
      dateFormat: 'MM/DD/YYYY h:mm:ss',
    })
    return `${t('datasetDocuments.segment.editedAt')} ${timeText}`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [childChunkInfo?.updated_at])

  return (
    <div className={'flex h-full flex-col'}>
      <div className={classNames('flex items-center justify-between', fullScreen ? 'py-3 pr-4 pl-6 border border-divider-subtle' : 'pt-3 pr-3 pl-4')}>
        <div className='flex flex-col'>
          <div className='system-xl-semibold text-text-primary'>{t('datasetDocuments.segment.editChildChunk')}</div>
          <div className='flex items-center gap-x-2'>
            <SegmentIndexTag positionId={childChunkInfo?.position || ''} labelPrefix={t('datasetDocuments.segment.childChunk') as string} />
            <Dot />
            <span className='system-xs-medium text-text-tertiary'>{wordCountText}</span>
            <Dot />
            <span className='system-xs-medium text-text-tertiary'>
              {EditTimeText}
            </span>
          </div>
        </div>
        <div className='flex items-center'>
          {fullScreen && (
            <>
              <ActionButtons
                handleCancel={handleCancel}
                handleSave={handleSave}
                loading={loading}
                isChildChunk={true}
              />
              <Divider type='vertical' className='ml-4 mr-2 h-3.5 bg-divider-regular' />
            </>
          )}
          <div className='mr-1 flex h-8 w-8 cursor-pointer items-center justify-center p-1.5' onClick={toggleFullScreen}>
            {fullScreen ? <RiCollapseDiagonalLine className='h-4 w-4 text-text-tertiary' /> : <RiExpandDiagonalLine className='h-4 w-4 text-text-tertiary' />}
          </div>
          <div className='flex h-8 w-8 cursor-pointer items-center justify-center p-1.5' onClick={onCancel}>
            <RiCloseLine className='h-4 w-4 text-text-tertiary' />
          </div>
        </div>
      </div>
      <div className={classNames('flex grow w-full', fullScreen ? 'flex-row justify-center px-6 pt-6' : 'py-3 px-4')}>
        <div className={classNames('break-all overflow-hidden whitespace-pre-line h-full', fullScreen ? 'w-1/2' : 'w-full')}>
          <ChunkContent
            docForm={docForm}
            question={content}
            onQuestionChange={content => setContent(content)}
            isEditMode={true}
          />
        </div>
      </div>
      {!fullScreen && (
        <div className='flex items-center justify-end border-t-[1px] border-t-divider-subtle p-4 pt-3'>
          <ActionButtons
            handleCancel={handleCancel}
            handleSave={handleSave}
            loading={loading}
            isChildChunk={true}
          />
        </div>
      )}
    </div>
  )
}

export default React.memo(ChildSegmentDetail)
