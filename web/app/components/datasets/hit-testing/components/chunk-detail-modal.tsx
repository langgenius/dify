'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { SegmentIndexTag } from '../../documents/detail/completed'
import Dot from '../../documents/detail/completed/common/dot'
import Score from './score'
import ChildChunksItem from './child-chunks-item'
import Modal from '@/app/components/base/modal'
import type { HitTesting } from '@/models/datasets'
import FileIcon from '@/app/components/base/file-uploader/file-type-icon'
import type { FileAppearanceTypeEnum } from '@/app/components/base/file-uploader/types'
import cn from '@/utils/classnames'
import Tag from '@/app/components/datasets/documents/detail/completed/common/tag'

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
  const { position, word_count, content, keywords, document } = segment
  const isParentChildRetrieval = !!(child_chunks && child_chunks.length > 0)
  const extension = document.name.split('.').slice(0, -1)[0] as FileAppearanceTypeEnum

  return (
    <Modal
      title={t('dataset.chunkDetail')}
      isShow
      closable
      onClose={onHide}
      className={cn(isParentChildRetrieval ? '!min-w-[1200px]' : '!min-w-[720px]')}
    >
      <div className='flex h-'>
        <div>
          {/* Meta info */}
          <div className='flex justify-between items-center'>
            <div className='grow flex items-center space-x-2'>
              <SegmentIndexTag
                isParentChildRetrieval={isParentChildRetrieval}
                positionId={position}
                className={cn('w-fit group-hover:opacity-100')}
              />
              <Dot />
              <div className='flex items-center space-x-1'>
                <FileIcon type={extension} size='sm' />
                <span className='grow w-0 truncate text-text-secondary text-[13px] font-normal'>{document.name}</span>
              </div>
            </div>
            <Score value={score} />
          </div>
          <div className=' max-h-[752px] overflow-y-auto'>
            {content}
          </div>
          {!isParentChildRetrieval && keywords && keywords.length > 0 && (
            <div>
              <div>{t('dataset.keywords')}</div>
              <div className='flex flex-wrap'>
                {keywords.map(keyword => (
                  <Tag key={keyword} text={keyword} className='mr-2' />
                ))}
              </div>
            </div>
          )}
        </div>

        {isParentChildRetrieval && (
          <div className='shrink-0 w-[552px] px-6'>
            <div>{t('dataset.hitChunks', { num: child_chunks.length })}</div>
            <div className='space-y-2'>
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
