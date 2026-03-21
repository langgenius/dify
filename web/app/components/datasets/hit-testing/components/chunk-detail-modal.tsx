'use client'
import type { FileAppearanceTypeEnum } from '@/app/components/base/file-uploader/types'
import type { HitTesting } from '@/models/datasets'
import * as React from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import FileIcon from '@/app/components/base/file-uploader/file-type-icon'
import { Markdown } from '@/app/components/base/markdown'
import Modal from '@/app/components/base/modal'
import Tag from '@/app/components/datasets/documents/detail/completed/common/tag'
import { cn } from '@/utils/classnames'
import ImageList from '../../common/image-list'
import Dot from '../../documents/detail/completed/common/dot'
import { SegmentIndexTag } from '../../documents/detail/completed/common/segment-index-tag'
import SummaryText from '../../documents/detail/completed/common/summary-text'
import ChildChunksItem from './child-chunks-item'
import Mask from './mask'
import Score from './score'

const i18nPrefix = ''

type ChunkDetailModalProps = {
  payload: HitTesting
  onHide: () => void
}

const ChunkDetailModal = ({
  payload,
  onHide,
}: ChunkDetailModalProps) => {
  const { t } = useTranslation()
  const { segment, score, child_chunks, files, summary } = payload
  const { position, content, sign_content, keywords, document, answer } = segment
  const isParentChildRetrieval = !!(child_chunks && child_chunks.length > 0)
  const extension = document.name.split('.').slice(-1)[0] as FileAppearanceTypeEnum
  const heighClassName = isParentChildRetrieval ? 'h-[min(627px,_80vh)] overflow-y-auto' : 'h-[min(539px,_80vh)] overflow-y-auto'
  const labelPrefix = isParentChildRetrieval ? t('segment.parentChunk', { ns: 'datasetDocuments' }) : t('segment.chunk', { ns: 'datasetDocuments' })

  const images = useMemo(() => {
    if (!files)
      return []
    return files.map(file => ({
      name: file.name,
      mimeType: file.mime_type,
      sourceUrl: file.source_url,
      size: file.size,
      extension: file.extension,
    }))
  }, [files])

  const showImages = images.length > 0
  const showKeywords = !isParentChildRetrieval && keywords && keywords.length > 0

  return (
    <Modal
      title={t(`${i18nPrefix}chunkDetail`, { ns: 'datasetHitTesting' })}
      isShow
      closable
      onClose={onHide}
      className={cn(isParentChildRetrieval ? '!min-w-[1200px]' : '!min-w-[800px]')}
    >
      <div className="mt-4 flex">
        <div className={cn('flex-1', isParentChildRetrieval && 'pr-6')}>
          {/* Meta info */}
          <div className="flex items-center justify-between">
            <div className="flex grow items-center space-x-2">
              <SegmentIndexTag
                labelPrefix={labelPrefix}
                positionId={position}
                className={cn('w-fit group-hover:opacity-100')}
              />
              <Dot />
              <div className="flex grow items-center space-x-1">
                <FileIcon type={extension} size="sm" />
                <span className="w-0 grow truncate text-[13px] font-normal text-text-secondary">{document.name}</span>
              </div>
            </div>
            <Score value={score} />
          </div>
          {/* Content */}
          <div className="relative">
            {!answer && (
              <Markdown
                className={cn('!mt-2 !text-text-secondary', heighClassName)}
                content={sign_content || content}
                customDisallowedElements={['input']}
              />
            )}
            {answer && (
              <div className="break-all">
                <div className="flex gap-x-1">
                  <div className="w-4 shrink-0 text-[13px] font-medium leading-[20px] text-text-tertiary">Q</div>
                  <div className={cn('body-md-regular line-clamp-20 text-text-secondary')}>
                    {content}
                  </div>
                </div>
                <div className="flex gap-x-1">
                  <div className="w-4 shrink-0 text-[13px] font-medium leading-[20px] text-text-tertiary">A</div>
                  <div className={cn('body-md-regular line-clamp-20 text-text-secondary')}>
                    {answer}
                  </div>
                </div>
              </div>
            )}
            {/* Mask */}
            <Mask className="absolute inset-x-0 bottom-0" />
          </div>
          {(showImages || showKeywords || !!summary) && (
            <div className="flex flex-col gap-y-3 pt-3">
              {showImages && (
                <ImageList images={images} size="md" className="py-1" />
              )}
              {!!summary && (
                <SummaryText value={summary} disabled />
              )}
              {showKeywords && (
                <div className="flex flex-col gap-y-1">
                  <div className="text-xs font-medium uppercase text-text-tertiary">{t(`${i18nPrefix}keyword`, { ns: 'datasetHitTesting' })}</div>
                  <div className="flex flex-wrap gap-x-2">
                    {keywords.map(keyword => (
                      <Tag key={keyword} text={keyword} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {isParentChildRetrieval && (
          <div className="flex-1 pb-6 pl-6">
            <div className="system-xs-semibold-uppercase text-text-secondary">{t(`${i18nPrefix}hitChunks`, { ns: 'datasetHitTesting', num: child_chunks.length })}</div>
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
