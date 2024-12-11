'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { RiArrowDownSLine, RiArrowRightSLine, RiArrowRightUpLine } from '@remixicon/react'
import { useBoolean } from 'ahooks'
import { SegmentIndexTag } from '../../documents/detail/completed'
import Dot from '../../documents/detail/completed/common/dot'
import Score from './score'
import ChildChunkItem from './child-chunks-item'
import ChunkDetailModal from './chunk-detail-modal'
import type { HitTesting } from '@/models/datasets'
import cn from '@/utils/classnames'
import FileIcon from '@/app/components/base/file-uploader/file-type-icon'
import type { FileAppearanceTypeEnum } from '@/app/components/base/file-uploader/types'
import Tag from '@/app/components/datasets/documents/detail/completed/common/tag'

type Props = {
  payload: HitTesting
}

const ResultItem: FC<Props> = ({
  payload,
}) => {
  const { t } = useTranslation()
  const { segment, score, child_chunks } = payload
  const { position, word_count, content, keywords, document } = segment
  const isParentChildRetrieval = !!(child_chunks && child_chunks.length > 0)
  const extension = document.name.split('.').slice(0, -1)[0] as FileAppearanceTypeEnum
  const [isFold, {
    toggle: toggleFold,
  }] = useBoolean(false)
  const Icon = isFold ? RiArrowRightSLine : RiArrowDownSLine

  const [isShowDetailModal, {
    setTrue: showDetailModal,
    setFalse: hideDetailModal,
  }] = useBoolean(false)

  return (
    <div>
      {/* Meta info */}
      <div className='flex justify-between items-center'>
        <div className='flex items-center space-x-2'>
          <SegmentIndexTag
            isParentChildRetrieval={isParentChildRetrieval}
            positionId={position}
            className={cn('w-fit group-hover:opacity-100')}
          />
          <Dot />
          <div className='system-xs-medium text-text-tertiary'>{word_count} {t('datasetDocuments.segment.characters')}</div>
        </div>
        <Score value={score} />
      </div>

      {/* Main */}
      <div>
        <div className='line-clamp-2'>{content}</div>
        {isParentChildRetrieval && (
          <div>
            <div className='flex items-center space-x-0.5 text-text-secondary' onClick={toggleFold}>
              <Icon className={cn('w-4 h-4', isFold && 'opacity-50')} />
              <div>{t('dataset.hitChunks', { num: child_chunks.length })}</div>
            </div>
            {child_chunks.map(item => (
              <ChildChunkItem key={item.id} payload={item} isShowAll={false} />
            ))}
          </div>
        )}
        {!isParentChildRetrieval && keywords && keywords.length > 0 && (
          <div className='flex flex-wrap'>
            {keywords.map(keyword => (
              <Tag key={keyword} text={keyword} className='mr-2' />
            ))}
          </div>
        )}
      </div>
      {/* Foot */}
      <div className='flex justify-between items-center h-10 pl-3 pr-2 border-t border-divider-subtle'>
        <div className='flex items-center space-x-1'>
          <FileIcon type={extension} size='sm' />
          <span className='grow w-0 truncate text-text-secondary text-[13px] font-normal'>{document.name}</span>
        </div>
        <div
          className='flex items-center space-x-1 cursor-pointer text-text-tertiary'
          onClick={showDetailModal}
        >
          <div className='text-xs uppercase'>{t('dataset.open')}</div>
          <RiArrowRightUpLine className='size-3.5' />
        </div>
      </div>

      {
        isShowDetailModal && (
          <ChunkDetailModal
            payload={payload}
            onHide={hideDetailModal}
          />
        )
      }
    </div>
  )
}
export default React.memo(ResultItem)
