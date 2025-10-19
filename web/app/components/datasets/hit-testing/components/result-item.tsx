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
import { Markdown } from '@/app/components/base/markdown'

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
  const { position, word_count, content, sign_content, keywords, document } = data
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
    <div className={cn('cursor-pointer rounded-xl bg-chat-bubble-bg pt-3 hover:shadow-lg')} onClick={showDetailModal}>
      {/* Meta info */}
      <ResultItemMeta className='px-3' labelPrefix={`${isParentChildRetrieval ? 'Parent-' : ''}Chunk`} positionId={position} wordCount={word_count} score={score} />

      {/* Main */}
      <div className='mt-1 px-3'>
        <Markdown
          className='line-clamp-2'
          content={sign_content || content}
          customDisallowedElements={['input']}
        />
        {isParentChildRetrieval && (
          <div className='mt-1'>
            <div
              className={cn('inline-flex h-6 cursor-pointer select-none items-center space-x-0.5 rounded-lg text-text-secondary', isFold && 'bg-workflow-process-bg pl-1')}
              onClick={(e) => {
                e.stopPropagation()
                toggleFold()
              }}
            >
              <Icon className={cn('h-4 w-4', isFold && 'opacity-50')} />
              <div className='text-xs font-semibold uppercase'>{t(`${i18nPrefix}.hitChunks`, { num: child_chunks.length })}</div>
            </div>
            {!isFold && (
              <div className='space-y-2'>
                {child_chunks.map(item => (
                  <div key={item.id} className='ml-[7px] border-l-[2px] border-text-accent-secondary pl-[7px]'>
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
