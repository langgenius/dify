'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { RiArrowDownSLine, RiArrowRightSLine } from '@remixicon/react'
import { useBoolean } from 'ahooks'
import ChildChunkItem from './child-chunks-item'
import ChunkDetailModal from './chunk-detail-modal'
import ResultItemMeta from './result-item-meta'
import ResultItemFooter from './result-item-footer'
import type { HitTesting } from '@/models/datasets'
import cn from '@/utils/classnames'
import type { FileAppearanceTypeEnum } from '@/app/components/base/file-uploader/types'
import Tag from '@/app/components/datasets/documents/detail/completed/common/tag'
import { extensionToFileType } from '@/app/components/datasets/hit-testing/utils/extension-to-file-type'

const i18nPrefix = 'datasetHitTesting'
type Props = {
  payload: HitTesting
}

const ResultItem: FC<Props> = ({
  payload,
}) => {
  const { t } = useTranslation()
  const { segment, score, child_chunks } = payload
  const data = segment
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
      <ResultItemMeta className='px-3' labelPrefix={`${isParentChildRetrieval ? 'Parent-' : ''}Chunk`} positionId={position} wordCount={word_count} score={score} />

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
      <ResultItemFooter docType={fileType} docTitle={document.name} showDetailModal={showDetailModal} />

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
