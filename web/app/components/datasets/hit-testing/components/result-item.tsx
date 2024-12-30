'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { RiArrowDownSLine, RiArrowRightSLine, RiArrowRightUpLine } from '@remixicon/react'
import { useBoolean } from 'ahooks'
import { SegmentIndexTag } from '../../documents/detail/completed/common/segment-index-tag'
import Dot from '../../documents/detail/completed/common/dot'
import Score from './score'
import ChildChunkItem from './child-chunks-item'
import ChunkDetailModal from './chunk-detail-modal'
import type { HitTesting } from '@/models/datasets'
import cn from '@/utils/classnames'
import FileIcon from '@/app/components/base/file-uploader/file-type-icon'
import type { FileAppearanceTypeEnum } from '@/app/components/base/file-uploader/types'
import Tag from '@/app/components/datasets/documents/detail/completed/common/tag'
import { extensionToFileType } from '@/app/components/datasets/hit-testing/utils/extension-to-file-type'

const i18nPrefix = 'datasetHitTesting'
type Props = {
  isExternal: boolean
  payload: HitTesting
}

const ResultItem: FC<Props> = ({
  isExternal,
  payload,
}) => {
  const { t } = useTranslation()
  const { segment, content: externalContent, score, child_chunks } = payload
  const data = isExternal ? externalContent : segment
  const { position, word_count, content, keywords, document } = data
  const isParentChildRetrieval = !!(child_chunks && child_chunks.length > 0)
  const extension = document.name.split('.').slice(-1)[0] as FileAppearanceTypeEnum
  const fileType = extensionToFileType(extension)
  const [isFold, {
    toggle: toggleFold,
  }] = useBoolean(false)
  const Icon = isFold ? RiArrowRightSLine : RiArrowDownSLine

  const [isShowDetailModal, {
    setTrue: showDetailModal,
    setFalse: hideDetailModal,
  }] = useBoolean(false)

  return (
    <div className={cn('pt-3 bg-chat-bubble-bg rounded-xl hover:shadow-lg cursor-pointer')} onClick={showDetailModal}>
      {/* Meta info */}
      <div className='flex justify-between items-center px-3'>
        <div className='flex items-center space-x-2'>
          <SegmentIndexTag
            labelPrefix={`${isParentChildRetrieval ? 'Parent-' : ''}Chunk`}
            positionId={position}
            className={cn('w-fit group-hover:opacity-100')}
          />
          <Dot />
          <div className='system-xs-medium text-text-tertiary'>{word_count} {t('datasetDocuments.segment.characters', { count: word_count })}</div>
        </div>
        <Score value={score} />
      </div>

      {/* Main */}
      <div className='mt-1 px-3'>
        <div className='line-clamp-2 body-md-regular break-all'>{content}</div>
        {isParentChildRetrieval && (
          <div className='mt-1'>
            <div className={cn('inline-flex items-center h-6 space-x-0.5 text-text-secondary select-none rounded-lg cursor-pointer', isFold && 'pl-1 bg-[linear-gradient(90deg,_rgba(200,_206,_218,_0.20)_0%,_rgba(200,_206,_218,_0.04)_100%)]')} onClick={toggleFold}>
              <Icon className={cn('w-4 h-4', isFold && 'opacity-50')} />
              <div className='text-xs font-semibold uppercase'>{t(`${i18nPrefix}.hitChunks`, { num: child_chunks.length })}</div>
            </div>
            {!isFold && (
              <div className='space-y-2'>
                {child_chunks.map(item => (
                  <div key={item.id} className='ml-[7px] pl-[7px] border-l-[2px] border-text-accent-secondary'>
                    <ChildChunkItem payload={item} isShowAll={false} />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {!isParentChildRetrieval && keywords && keywords.length > 0 && (
          <div className='mt-2 flex flex-wrap'>
            {keywords.map(keyword => (
              <Tag key={keyword} text={keyword} className='mr-2' />
            ))}
          </div>
        )}
      </div>
      {/* Foot */}
      <div className='mt-3 flex justify-between items-center h-10 pl-3 pr-2 border-t border-divider-subtle'>
        <div className='grow flex items-center space-x-1'>
          <FileIcon type={fileType} size='sm' />
          <span className='grow w-0 truncate text-text-secondary text-[13px] font-normal'>{document.name}</span>
        </div>
        <div
          className='flex items-center space-x-1 cursor-pointer text-text-tertiary'
          onClick={showDetailModal}
        >
          <div className='text-xs uppercase'>{t(`${i18nPrefix}.open`)}</div>
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
    </div >
  )
}
export default React.memo(ResultItem)
