import type { KnowledgeFsDocumentOutlineNodeResponse } from '@dify/contracts/api/console/knowledge-fs/types.gen'
import type {
  DocumentRevisionChunk,
  LogicalDocument,
  LogicalDocumentRevision,
} from './document-models'
import { Button } from '@langgenius/dify-ui/button'
import { toast } from '@langgenius/dify-ui/toast'
import copy from 'copy-to-clipboard'
import { useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Markdown } from '@/app/components/base/markdown'
import { chunkCharacterCount, chunkContentParts } from './document-detail-model'
import { DocumentMetadataCard } from './document-metadata-card'

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
    <span className="mt-0.75 inline-flex shrink-0 rounded bg-background-section-burn px-1 py-0.5 system-2xs-medium text-text-tertiary">
      {label}
    </span>
  )
}

export function DocumentChunkDetail({
  canEdit,
  controlSpaceId,
  document,
  chunks,
  chunksComplete,
  isLoadingMore,
  locale,
  outlineNodesByChunkId,
  outlineSummaryChunkIds,
  revision,
  selectedChunkId,
}: {
  canEdit: boolean
  controlSpaceId: string
  document: LogicalDocument
  chunks: DocumentRevisionChunk[]
  chunksComplete: boolean
  isLoadingMore: boolean
  locale: string
  outlineNodesByChunkId: Map<string, KnowledgeFsDocumentOutlineNodeResponse>
  outlineSummaryChunkIds: Set<string>
  revision?: Exclude<LogicalDocumentRevision, null>
  selectedChunkId?: string
}) {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const contentScrollRef = useRef<HTMLDivElement>(null)
  const characterCount = useMemo(
    () => chunks.reduce((total, chunk) => total + chunkCharacterCount(chunk.text), 0),
    [chunks],
  )
  const averageChunkLength = chunks.length ? Math.round(characterCount / chunks.length) : 0
  const childChunkCount = chunks.filter((chunk) => chunk.parentChunkId).length
  const parentChunkCount = chunks.length - childChunkCount
  const chunkMarkerLabels = useMemo(() => {
    const parentChunkIds = new Set(
      chunks.flatMap((chunk) => (chunk.parentChunkId ? [chunk.parentChunkId] : [])),
    )
    const positionsByParent = new Map<string, number>()
    const labels = new Map<string, string>()

    for (const chunk of chunks) {
      if (parentChunkIds.has(chunk.id)) continue
      const parentId = chunk.parentChunkId ?? ''
      const position = (positionsByParent.get(parentId) ?? 0) + 1
      positionsByParent.set(parentId, position)
      labels.set(chunk.id, `C-${position}`)
    }

    return labels
  }, [chunks])
  const sizeBytes = revision?.sizeBytes ?? document.active?.sizeBytes
  const sourceName =
    typeof document.userMetadata.sourceName === 'string'
      ? document.userMetadata.sourceName
      : undefined
  const retrievalCount =
    typeof document.userMetadata.retrievalCount === 'number'
      ? document.userMetadata.retrievalCount
      : undefined

  useEffect(() => {
    const animationFrame = globalThis.requestAnimationFrame(() => {
      const contentScroll = contentScrollRef.current
      const selectedChunk = selectedChunkId
        ? globalThis.document?.getElementById(`document-chunk-${selectedChunkId}`)
        : undefined
      if (!contentScroll || !selectedChunk) return

      const contentRect = contentScroll.getBoundingClientRect()
      const chunkRect = selectedChunk.getBoundingClientRect()
      const chunkTop = contentScroll.scrollTop + chunkRect.top - contentRect.top
      const chunkBottom = chunkTop + chunkRect.height
      if (chunkTop < contentScroll.scrollTop)
        contentScroll.scrollTo({ top: Math.max(0, chunkTop - 16), behavior: 'instant' })
      else if (chunkBottom > contentScroll.scrollTop + contentScroll.clientHeight)
        contentScroll.scrollTo({ top: Math.max(0, chunkTop - 16), behavior: 'instant' })
    })

    return () => globalThis.cancelAnimationFrame(animationFrame)
  }, [chunks, outlineNodesByChunkId, outlineSummaryChunkIds, selectedChunkId])

  return (
    <>
      <article
        aria-busy={isLoadingMore}
        className="min-h-72 min-w-0 overflow-hidden bg-background-default xl:px-6"
      >
        {chunks.length ? (
          <div
            ref={contentScrollRef}
            className="flex max-h-[70vh] flex-col gap-3 overflow-auto px-2 pt-1 xl:h-full xl:max-h-none xl:px-0"
            data-testid="chunk-content-scroll"
          >
            {chunks.map((chunk) => {
              const content = chunkContentParts(chunk)
              const markerLabel = chunkMarkerLabels.get(chunk.id)
              const outlineNode = outlineNodesByChunkId.get(chunk.id)
              const outlineSummary = outlineSummaryChunkIds.has(chunk.id)
                ? outlineNode?.summary?.trim()
                : undefined
              return (
                <section
                  key={chunk.id}
                  id={`document-chunk-${chunk.id}`}
                  className="group scroll-mt-4 rounded-lg px-3 pt-2 [contain-intrinsic-size:auto_160px] [content-visibility:auto] first:pt-3 xl:px-0"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start gap-1">
                        {!content.body && markerLabel && <ChunkMarker label={markerLabel} />}
                        <h3 className="system-sm-semibold wrap-break-word text-text-primary">
                          {outlineNode?.title.trim() ||
                            content.heading ||
                            t(($) => $['newKnowledge.chunkHeading'], {
                              position: chunk.ordinal + 1,
                            })}
                        </h3>
                      </div>
                      {outlineSummary && (
                        <p className="mt-1 text-[13px] leading-5.5 wrap-break-word text-text-tertiary">
                          {outlineSummary}
                        </p>
                      )}
                    </div>
                    <Button
                      aria-label={tCommon(($) => $['operation.copy'])}
                      className="opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 motion-reduce:transition-none"
                      onClick={() => {
                        copy(chunk.text)
                        toast.success(tCommon(($) => $['actionMsg.copySuccessfully']))
                      }}
                      size="small"
                      variant="ghost"
                    >
                      <span aria-hidden className="i-ri-file-copy-line size-4" />
                    </Button>
                  </div>
                  {content.body && (
                    <div className="mt-3 flex items-start gap-1">
                      {markerLabel && <ChunkMarker label={markerLabel} />}
                      <Markdown
                        className="min-w-0 flex-1 text-[13px]! leading-5.5! wrap-break-word text-text-secondary!"
                        content={content.body}
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
          </div>
        ) : (
          <div className="flex min-h-72 items-center justify-center px-6 text-center body-sm-regular text-text-tertiary">
            {t(($) => $['newKnowledge.selectChunk'])}
          </div>
        )}
      </article>

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
                    : new Intl.NumberFormat(locale).format(chunks.length)
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
    </>
  )
}
