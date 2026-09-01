import type { KnowledgeFsDocumentMultimodalItemResponse } from '@dify/contracts/api/console/knowledge-fs/types.gen'
import type { DocumentRevisionChunk, LogicalDocument, LogicalDocumentRevision } from '../models'
import type { DocumentContentBlock } from './model'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  ScrollArea,
  ScrollAreaContent,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaViewport,
} from '@langgenius/dify-ui/scroll-area'
import { toast } from '@langgenius/dify-ui/toast'
import copy from 'copy-to-clipboard'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Markdown } from '@/app/components/base/markdown'
import { DocumentMetadataCard } from '../metadata/card'
import { chunkCharacterCount, placeDocumentMultimodalItems } from './model'
import { DocumentMultimodalAsset } from './multimodal-asset'

const SELECTED_CHUNK_TOP_OFFSET = 8
const SELECTED_CHUNK_ALIGNMENT_FRAMES = 12
const SELECTED_CHUNK_ALIGNMENT_TOLERANCE = 1

function formatBytes(bytes: number, locale: string) {
  const numberFormat = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 })
  if (bytes < 1024) return `${numberFormat.format(bytes)} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = units[0]
  for (let index = 1; index < units.length && value >= 1024; index++) {
    value /= 1024
    unit = units[index]
  }
  return `${new Intl.NumberFormat(locale, {
    maximumFractionDigits: value >= 10 ? 0 : 1,
  }).format(value)} ${unit}`
}

function formatDate(value: string | undefined, locale: string) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function formatDateOnly(value: string | undefined, locale: string) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date)
}

function ChunkMarker({ label }: { label: string }) {
  return (
    <span className="float-left mt-0.75 mr-1 inline-flex shrink-0 rounded bg-background-section-burn px-1 py-0.5 system-2xs-medium text-text-tertiary">
      {label}
    </span>
  )
}

function DocumentSectionHeading({ children, level }: { children: React.ReactNode; level: number }) {
  const headingLevel = Math.min(6, Math.max(2, Math.trunc(level) + 1))
  const Heading = `h${headingLevel}` as 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
  return (
    <Heading
      className={cn(
        'wrap-break-word text-text-primary',
        headingLevel === 2 && 'system-xl-semibold',
        headingLevel === 3 && 'system-sm-semibold',
        headingLevel >= 4 && 'system-sm-semibold',
      )}
    >
      {children}
    </Heading>
  )
}

function DocumentSectionSummary({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation('dataset')
  const [expanded, setExpanded] = useState(true)

  return (
    <div className="mt-3 overflow-hidden rounded-lg bg-background-section">
      <button
        aria-expanded={expanded}
        className={cn(
          'flex w-full items-center gap-1.5 px-3.5 pt-3 text-left system-xs-regular text-text-secondary outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:ring-inset',
          !expanded && 'pb-3',
        )}
        type="button"
        onClick={() => setExpanded((current) => !current)}
      >
        <span aria-hidden className="i-ri-file-list-3-line size-4 shrink-0" />
        <span className="min-w-0 flex-1">{t(($) => $['newKnowledge.documentSummary'])}</span>
        <span
          aria-hidden
          className={cn(
            'i-ri-arrow-down-s-line size-4 shrink-0 transition-transform motion-reduce:transition-none',
            !expanded && '-rotate-90',
          )}
        />
      </button>
      {expanded && (
        <p className="px-3.5 pt-1 pb-3 system-xs-regular wrap-break-word text-text-secondary">
          {children}
        </p>
      )}
    </div>
  )
}

export function DocumentReadingPane({
  contentBlocks,
  isLoadingMore,
  multimodalItems,
  selectedChunkId,
}: {
  contentBlocks: DocumentContentBlock[]
  isLoadingMore: boolean
  multimodalItems: KnowledgeFsDocumentMultimodalItemResponse[]
  selectedChunkId?: string
}) {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const contentScrollRef = useRef<HTMLDivElement>(null)
  const contentChunks = useMemo(() => contentBlocks.map((block) => block.chunk), [contentBlocks])
  const multimodalPlacement = useMemo(
    () => placeDocumentMultimodalItems(contentChunks, multimodalItems),
    [contentChunks, multimodalItems],
  )
  useEffect(() => {
    let alignedFrameCount = 0
    let attemptedFrameCount = 0
    let animationFrame: number

    const alignSelectedChunk = () => {
      const contentScroll = contentScrollRef.current
      const selectedChunk = selectedChunkId
        ? globalThis.document?.getElementById(`document-chunk-${selectedChunkId}`)
        : undefined
      if (!contentScroll || !selectedChunk) return

      const contentRect = contentScroll.getBoundingClientRect()
      const chunkRect = selectedChunk.getBoundingClientRect()
      const alignmentDelta = chunkRect.top - contentRect.top - SELECTED_CHUNK_TOP_OFFSET
      attemptedFrameCount += 1

      if (Math.abs(alignmentDelta) <= SELECTED_CHUNK_ALIGNMENT_TOLERANCE) {
        alignedFrameCount += 1
      } else {
        alignedFrameCount = 0
        contentScroll.scrollTo({
          top: Math.max(0, contentScroll.scrollTop + alignmentDelta),
          behavior: 'instant',
        })
      }

      if (alignedFrameCount < 2 && attemptedFrameCount < SELECTED_CHUNK_ALIGNMENT_FRAMES)
        animationFrame = globalThis.requestAnimationFrame(alignSelectedChunk)
    }

    animationFrame = globalThis.requestAnimationFrame(alignSelectedChunk)

    return () => globalThis.cancelAnimationFrame(animationFrame)
  }, [contentBlocks, selectedChunkId])

  return (
    <article
      aria-busy={isLoadingMore}
      className="min-h-72 min-w-0 overflow-hidden bg-background-default xl:px-6"
    >
      {contentBlocks.length || multimodalPlacement.unplaced.length ? (
        <ScrollArea className="relative max-h-[70vh] min-h-0 min-w-0 xl:h-full xl:max-h-none">
          <ScrollAreaViewport
            ref={contentScrollRef}
            className="max-h-[70vh] overscroll-contain xl:max-h-none"
            data-testid="chunk-content-scroll"
            style={{ overflowX: 'hidden' }}
          >
            <ScrollAreaContent
              className="flex min-h-full w-full max-w-full flex-col gap-3 px-2 pt-1 xl:px-0"
              style={{ minWidth: 0 }}
            >
              {contentBlocks.map((block) => {
                const { chunk } = block
                const chunkMultimodalItems = multimodalPlacement.byChunkId.get(chunk.id) ?? []
                return (
                  <section
                    key={chunk.id}
                    id={`document-chunk-${chunk.id}`}
                    className="group relative scroll-mt-4 rounded-lg px-3 pt-2 [contain-intrinsic-size:auto_160px] [content-visibility:auto] first:pt-3 xl:px-0"
                  >
                    <div className="min-w-0">
                      {block.heading && (
                        <DocumentSectionHeading level={block.heading.level}>
                          {block.heading.text ||
                            t(($) => $['newKnowledge.chunkHeading'], {
                              position: chunk.ordinal + 1,
                            })}
                        </DocumentSectionHeading>
                      )}
                      {block.summary && (
                        <DocumentSectionSummary>{block.summary}</DocumentSectionSummary>
                      )}
                    </div>
                    <Button
                      aria-label={tCommon(($) => $['operation.copy'])}
                      className="absolute top-1 right-0 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 motion-reduce:transition-none"
                      onClick={() => {
                        copy(chunk.text)
                        toast.success(tCommon(($) => $['actionMsg.copySuccessfully']))
                      }}
                      size="small"
                      variant="ghost"
                    >
                      <span aria-hidden className="i-ri-file-copy-line size-4" />
                    </Button>
                    {chunkMultimodalItems.length > 0 && (
                      <div className="mt-3 space-y-3">
                        {chunkMultimodalItems.map((item) => (
                          <DocumentMultimodalAsset item={item} key={item.id} />
                        ))}
                      </div>
                    )}
                    {block.body && (
                      <div className="mt-3 flow-root">
                        {block.markerLabel && <ChunkMarker label={block.markerLabel} />}
                        <Markdown
                          className="min-w-0 text-[13px]! leading-5.5! wrap-break-word text-text-secondary! before:hidden after:hidden"
                          content={block.body}
                          renderSoftBreaks={false}
                        />
                      </div>
                    )}
                    {!chunk.text && (
                      <p className="mt-3 text-[13px] leading-5.5 text-text-tertiary">
                        {t(($) => $['newKnowledge.emptyChunk'])}
                      </p>
                    )}
                  </section>
                )
              })}
              {multimodalPlacement.unplaced.length > 0 && (
                <section className="space-y-3 rounded-lg px-3 pt-2 first:pt-3 xl:px-0">
                  <h3 className="system-sm-semibold text-text-primary">
                    {t(($) => $['newKnowledge.documentImages'])}
                  </h3>
                  {multimodalPlacement.unplaced.map((item) => (
                    <DocumentMultimodalAsset item={item} key={item.id} />
                  ))}
                </section>
              )}
            </ScrollAreaContent>
          </ScrollAreaViewport>
          <ScrollAreaScrollbar>
            <ScrollAreaThumb />
          </ScrollAreaScrollbar>
        </ScrollArea>
      ) : (
        <div className="flex min-h-72 items-center justify-center px-6 text-center body-sm-regular text-text-tertiary">
          {t(($) => $['newKnowledge.selectChunk'])}
        </div>
      )}
    </article>
  )
}

export function DocumentFactsSidebar({
  canEdit,
  chunksComplete,
  controlSpaceId,
  document,
  indexChunks,
  locale,
  revision,
}: {
  canEdit: boolean
  chunksComplete: boolean
  controlSpaceId: string
  document: LogicalDocument
  indexChunks: DocumentRevisionChunk[]
  locale: string
  revision?: Exclude<LogicalDocumentRevision, null>
}) {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const characterCount = useMemo(
    () => indexChunks.reduce((total, chunk) => total + chunkCharacterCount(chunk.text), 0),
    [indexChunks],
  )
  const averageChunkLength = indexChunks.length
    ? Math.round(characterCount / indexChunks.length)
    : 0
  const childChunkCount = indexChunks.filter((chunk) => chunk.parentChunkId).length
  const parentChunkCount = indexChunks.length - childChunkCount
  const sizeBytes = revision?.sizeBytes ?? document.active?.sizeBytes
  const sourceName =
    typeof document.userMetadata.sourceName === 'string'
      ? document.userMetadata.sourceName
      : undefined
  const retrievalCount =
    typeof document.userMetadata.retrievalCount === 'number'
      ? document.userMetadata.retrievalCount
      : undefined

  return (
    <aside className="min-w-0 space-y-6 xl:pt-3 xl:pl-6">
      <DocumentMetadataCard
        canEdit={canEdit}
        controlSpaceId={controlSpaceId}
        document={document}
        locale={locale}
      />
      <section>
        <dl className="space-y-3">
          <div className="flex gap-3">
            <dt className="w-30 shrink-0 system-xs-regular text-text-tertiary">
              {t(($) => $['newKnowledge.sourceColumn'])}
            </dt>
            <dd className="min-w-0 flex-1 system-xs-regular wrap-break-word text-text-primary">
              {sourceName ??
                (document.sourceId
                  ? t(($) => $['newKnowledge.sourceType.connector'])
                  : t(($) => $['newKnowledge.manualUpload']))}
            </dd>
          </div>
          <div className="flex gap-3">
            <dt className="w-30 shrink-0 system-xs-regular text-text-tertiary">
              {t(($) => $['newKnowledge.fileSize'])}
            </dt>
            <dd className="min-w-0 flex-1 system-xs-regular text-text-primary">
              {sizeBytes !== undefined ? formatBytes(sizeBytes, locale) : '—'}
            </dd>
          </div>
          <div className="flex gap-3">
            <dt className="w-30 shrink-0 system-xs-regular text-text-tertiary">
              {tCommon(($) => $['operation.added'])}
            </dt>
            <dd className="min-w-0 flex-1 system-xs-regular text-text-primary">
              {formatDateOnly(document.createdAt, locale)}
            </dd>
          </div>
          <div className="flex gap-3">
            <dt className="w-30 shrink-0 system-xs-regular text-text-tertiary">
              {t(($) => $['newKnowledge.lastIndexed'])}
            </dt>
            <dd className="min-w-0 flex-1 system-xs-regular text-text-primary">
              {formatDate(revision?.activatedAt ?? revision?.createdAt, locale)}
            </dd>
          </div>
          <div className="flex gap-3">
            <dt className="w-30 shrink-0 system-xs-regular text-text-tertiary">
              {t(($) => $['newKnowledge.documentRevision'])}
            </dt>
            <dd className="min-w-0 flex-1 system-xs-regular text-text-primary">
              {revision?.revision ?? document.activeRevision ?? '—'}
            </dd>
          </div>
        </dl>
      </section>
      <section>
        <h2 className="system-xs-medium text-text-tertiary">
          {t(($) => $['newKnowledge.indexInformation'])}
        </h2>
        <dl className="mt-3 space-y-3">
          <div className="flex gap-3">
            <dt className="w-30 shrink-0 system-xs-regular text-text-tertiary">
              {t(($) => $['newKnowledge.chunkCount'])}
            </dt>
            <dd className="min-w-0 flex-1 system-xs-regular text-text-primary">
              {chunksComplete
                ? childChunkCount
                  ? t(($) => $['newKnowledge.parentChildChunkCount'], {
                      childCount: new Intl.NumberFormat(locale).format(childChunkCount),
                      parentCount: new Intl.NumberFormat(locale).format(parentChunkCount),
                    })
                  : new Intl.NumberFormat(locale).format(indexChunks.length)
                : '—'}
            </dd>
          </div>
          <div className="flex gap-3">
            <dt className="w-30 shrink-0 system-xs-regular text-text-tertiary">
              {t(($) => $['newKnowledge.averageChunkLength'])}
            </dt>
            <dd className="min-w-0 flex-1 system-xs-regular text-text-primary">
              {chunksComplete
                ? t(($) => $['newKnowledge.averageChunkLengthValue'], {
                    value: new Intl.NumberFormat(locale).format(averageChunkLength),
                  })
                : '—'}
            </dd>
          </div>
          <div className="flex gap-3">
            <dt className="w-30 shrink-0 system-xs-regular text-text-tertiary">
              {t(($) => $['newKnowledge.retrievalCount'])}
            </dt>
            <dd className="min-w-0 flex-1 system-xs-regular text-text-primary">
              {retrievalCount === undefined
                ? '—'
                : t(($) => $['newKnowledge.retrievalCountValue'], {
                    value: new Intl.NumberFormat(locale).format(retrievalCount),
                  })}
            </dd>
          </div>
        </dl>
      </section>
    </aside>
  )
}
