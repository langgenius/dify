'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { SegmentIndexTag } from '../../documents/detail/completed/common/segment-index-tag'
import Dot from '../../documents/detail/completed/common/dot'
import Score from './score'
import ChildChunksItem from './child-chunks-item'
import Modal from '@/app/components/base/modal'
import type { HitTesting } from '@/models/datasets'
import FileIcon from '@/app/components/base/file-uploader/file-type-icon'
import type { FileAppearanceTypeEnum } from '@/app/components/base/file-uploader/types'
import cn from '@/utils/classnames'
import Tag from '@/app/components/datasets/documents/detail/completed/common/tag'

const i18nPrefix = 'datasetHitTesting'

type Props = {
  payload: HitTesting
  onHide: () => void
}

const ChunkDetailModal: FC<Props> = ({
  payload,
  onHide,
}) => {
  const { t } = useTranslation()
  const { segment, score, child_chunks } = payload
  const { position, content, keywords, document } = segment
  const isParentChildRetrieval = !!(child_chunks && child_chunks.length > 0)
  const extension = document.name.split('.').slice(-1)[0] as FileAppearanceTypeEnum
  const heighClassName = isParentChildRetrieval ? 'h-[min(627px,_80vh)] overflow-y-auto' : 'h-[min(539px,_80vh)] overflow-y-auto'
  return (
    <Modal
      title={t(`${i18nPrefix}.chunkDetail`)}
      isShow
      closable
      onClose={onHide}
      className={cn(isParentChildRetrieval ? '!min-w-[1200px]' : '!min-w-[800px]')}
    >
      <div className='mt-4 flex'>
        <div className={cn('flex-1', isParentChildRetrieval && 'pr-6')}>
          {/* Meta info */}
          <div className='flex justify-between items-center'>
            <div className='grow flex items-center space-x-2'>
              <SegmentIndexTag
                labelPrefix={`${isParentChildRetrieval ? 'Parent-' : ''}Chunk`}
                positionId={position}
                className={cn('w-fit group-hover:opacity-100')}
              />
              <Dot />
              <div className='grow flex items-center space-x-1'>
                <FileIcon type={extension} size='sm' />
                <span className='grow w-0 truncate text-text-secondary text-[13px] font-normal'>{document.name}</span>
              </div>
            </div>
            <Score value={score} />
          </div>
          <div className={cn('mt-2 body-md-regular text-text-secondary', heighClassName)}>
            {content}
          </div>
          {!isParentChildRetrieval && keywords && keywords.length > 0 && (
            <div className='mt-6'>
              <div className='font-medium text-xs text-text-tertiary uppercase'>{t(`${i18nPrefix}.keyword`)}</div>
              <div className='mt-1 flex flex-wrap'>
                {keywords.map(keyword => (
                  <Tag key={keyword} text={keyword} className='mr-2' />
                ))}
              </div>
            </div>
          )}
        </div>

        {isParentChildRetrieval && (
          <div className='flex-1 pl-6 pb-6'>
            <div className='system-xs-semibold-uppercase text-text-secondary'>{t(`${i18nPrefix}.hitChunks`, { num: child_chunks.length })}</div>
            <div className={cn('mt-1 space-y-2', heighClassName)}>
              {child_chunks.map(item => (
                <ChildChunksItem key={item.id} payload={item} isShowAll />
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}

export default React.memo(ChunkDetailModal)
