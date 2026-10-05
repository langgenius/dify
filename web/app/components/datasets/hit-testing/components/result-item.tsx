'use client'
import type { HitTesting } from '@/models/datasets'
import { cn } from '@langgenius/dify-ui/cn'
import { RiArrowDownSLine, RiArrowRightSLine } from '@remixicon/react'
import { useBoolean } from 'ahooks'
import { memo, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Markdown } from '@/app/components/base/markdown'
import SummaryLabel from '@/app/components/datasets/documents/detail/completed/common/summary-label'
import Tag from '@/app/components/datasets/documents/detail/completed/common/tag'
import ImageList from '../../common/image-list'
import ChildChunkItem from './child-chunks-item'
import { ChunkDetailDialog } from './chunk-detail-dialog'
import { ResultItemMeta } from './result-item-meta'

const i18nPrefix = ''
type ResultItemProps = {
  payload: HitTesting
}

export const ResultItem = memo(({ payload }: ResultItemProps) => {
  const { t } = useTranslation(['datasetHitTesting'])
  const { segment, score, child_chunks, files, summary } = payload
  const data = segment
  const { position, word_count, content, sign_content, keywords } = data
  const isParentChildRetrieval = !!(child_chunks && child_chunks.length > 0)
  const [isFold, { toggle: toggleFold }] = useBoolean(false)
  const Icon = isFold ? RiArrowRightSLine : RiArrowDownSLine

  const [open, setOpen] = useState(false)
  const richPreviewRef = useRef<HTMLDivElement>(null)

  const images = useMemo(() => {
    if (!files) return []
    return files.map((file) => ({
      name: file.name,
      mimeType: file.mime_type,
      sourceUrl: file.source_url,
      size: file.size,
      extension: file.extension,
    }))
  }, [files])

  return (
    <div
      className={cn('cursor-pointer rounded-xl bg-chat-bubble-bg pt-3 hover:shadow-lg')}
      onClick={(event) => {
        if (
          !(event.target instanceof Node) ||
          !event.currentTarget.contains(event.target) ||
          richPreviewRef.current?.contains(event.target)
        )
          return
        setOpen(true)
      }}
    >
      {/* Meta info */}
      <ResultItemMeta
        className="px-3"
        labelPrefix={`${isParentChildRetrieval ? 'Parent-' : ''}Chunk`}
        positionId={position}
        wordCount={word_count}
        score={score}
      />

      {/* Main */}
      <div className="mt-1 px-3">
        <div ref={richPreviewRef} className="cursor-auto">
          <Markdown
            className="line-clamp-2"
            content={sign_content || content}
            customDisallowedElements={['input']}
          />
        </div>
        {images.length > 0 && <ImageList images={images} size="md" className="py-1" />}
        {isParentChildRetrieval && (
          <div className="mt-1">
            <button
              type="button"
              aria-expanded={!isFold}
              className={cn(
                'inline-flex h-6 cursor-pointer items-center space-x-0.5 rounded-lg text-text-secondary select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-state-accent-solid',
                isFold && 'bg-workflow-process-bg pl-1',
              )}
              onClick={(e) => {
                e.stopPropagation()
                toggleFold()
              }}
            >
              <Icon className={cn('size-4', isFold && 'opacity-50')} />
              <span className="text-xs font-semibold uppercase">
                {t(($) => $[`${i18nPrefix}hitChunks`], {
                  ns: 'datasetHitTesting',
                  num: child_chunks.length,
                })}
              </span>
            </button>
            {!isFold && (
              <div className="space-y-2">
                {child_chunks.map((item) => (
                  <div
                    key={item.id}
                    className="ml-1.75 border-l-2 border-text-accent-secondary pl-1.75"
                  >
                    <ChildChunkItem payload={item} isShowAll={false} />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {!isParentChildRetrieval && keywords && keywords.length > 0 && (
          <div className="mt-2 flex flex-wrap">
            {keywords.map((keyword) => (
              <Tag key={keyword} text={keyword} className="mr-2" />
            ))}
          </div>
        )}
        {summary && <SummaryLabel summary={summary} className="mt-2" />}
      </div>
      <ChunkDetailDialog payload={payload} open={open} onOpenChange={setOpen} />
    </div>
  )
})
