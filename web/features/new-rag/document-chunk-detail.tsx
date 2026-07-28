import type {
  DocumentRevisionChunk,
  LogicalDocument,
  LogicalDocumentRevision,
} from '@dify/contracts/knowledge-fs/types.gen'
import { Button } from '@langgenius/dify-ui/button'
import { toast } from '@langgenius/dify-ui/toast'
import copy from 'copy-to-clipboard'
import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  chunkCharacterCount,
  chunkContentParts,
  chunkMetadataEntries,
} from './document-detail-model'

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

export function DocumentChunkDetail({
  document,
  chunks,
  chunksComplete,
  locale,
  revision,
  selectedChunkId,
}: {
  document: LogicalDocument
  chunks: DocumentRevisionChunk[]
  chunksComplete: boolean
  locale: string
  revision?: Exclude<LogicalDocumentRevision, null>
  selectedChunkId?: string
}) {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const selectedChunk = useMemo(
    () => chunks.find((chunk) => chunk.id === selectedChunkId) ?? chunks[0],
    [chunks, selectedChunkId],
  )
  const characterCount = useMemo(
    () => chunks.reduce((total, chunk) => total + chunkCharacterCount(chunk.text), 0),
    [chunks],
  )
  const averageChunkLength = chunks.length ? Math.round(characterCount / chunks.length) : 0
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
    if (!selectedChunkId) return
    globalThis.document
      ?.getElementById(`document-chunk-${selectedChunkId}`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [selectedChunkId])

  return (
    <>
      <article
        aria-busy={!chunksComplete}
        className="min-h-72 min-w-0 overflow-hidden bg-background-default xl:px-7"
      >
        {!chunksComplete && (
          <p
            className="border-b border-divider-subtle bg-state-accent-hover px-5 py-2 system-xs-regular text-text-accent"
            role="status"
          >
            {t(($) => $['newKnowledge.documentContentIncomplete'])}
          </p>
        )}
        {chunks.length ? (
          <div
            className="max-h-[70vh] space-y-6 overflow-auto px-2 py-1 xl:px-0"
            data-testid="chunk-content-scroll"
          >
            {chunks.map((chunk) => {
              const content = chunkContentParts(chunk.text)
              return (
                <section
                  key={chunk.id}
                  id={`document-chunk-${chunk.id}`}
                  className="group scroll-mt-4 rounded-lg px-3 py-4 [contain-intrinsic-size:auto_160px] [content-visibility:auto] xl:px-0"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="system-sm-semibold break-words text-text-primary">
                        {content.heading ||
                          t(($) => $['newKnowledge.chunkHeading'], { position: chunk.ordinal })}
                      </h3>
                      <p className="mt-1 system-2xs-regular text-text-tertiary">
                        {t(($) => $['newKnowledge.chunkLocation'], { position: chunk.ordinal })}
                      </p>
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
                    <p className="mt-3 body-md-regular break-words whitespace-pre-wrap text-text-primary">
                      {content.body}
                    </p>
                  )}
                  {!chunk.text && (
                    <p className="mt-3 body-md-regular text-text-tertiary">
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

      <aside className="min-w-0 xl:pl-6">
        <section className="rounded-xl bg-background-default-subtle p-4">
          <h2 className="system-sm-semibold text-text-primary">
            {t(($) => $['newKnowledge.metadata'])}
          </h2>
          <p className="mt-2 system-xs-regular text-text-tertiary">
            {t(($) => $['newKnowledge.documentOverviewDescription'])}
          </p>
          <Button
            className="mt-2"
            onClick={() => toast.info(t(($) => $['newKnowledge.filtersUnavailable']))}
            variant="primary"
          >
            {t(($) => $['metadata.documentMetadata.startLabeling'])}
          </Button>
        </section>
        <section className="mt-6">
          <dl className="space-y-3">
            <div>
              <dt className="system-2xs-medium text-text-tertiary">
                {t(($) => $['newKnowledge.sourceColumn'])}
              </dt>
              <dd className="mt-1 system-xs-regular break-words text-text-secondary">
                {sourceName ??
                  (document.sourceId
                    ? t(($) => $['newKnowledge.sourceType.connector'])
                    : t(($) => $['newKnowledge.manualUpload']))}
              </dd>
            </div>
            <div>
              <dt className="system-2xs-medium text-text-tertiary">
                {t(($) => $['newKnowledge.fileSize'])}
              </dt>
              <dd className="mt-1 system-xs-regular text-text-secondary">
                {sizeBytes !== undefined ? formatBytes(sizeBytes, locale) : '—'}
              </dd>
            </div>
            <div>
              <dt className="system-2xs-medium text-text-tertiary">
                {t(($) => $['newKnowledge.createdAt'])}
              </dt>
              <dd className="mt-1 system-xs-regular text-text-secondary">
                {formatDate(document.createdAt, locale)}
              </dd>
            </div>
            <div>
              <dt className="system-2xs-medium text-text-tertiary">
                {t(($) => $['newKnowledge.lastIndexed'])}
              </dt>
              <dd className="mt-1 system-xs-regular text-text-secondary">
                {formatDate(revision?.activatedAt ?? revision?.createdAt, locale)}
              </dd>
            </div>
            <div>
              <dt className="system-2xs-medium text-text-tertiary">
                {t(($) => $['newKnowledge.documentRevision'])}
              </dt>
              <dd className="mt-1 system-xs-regular text-text-secondary">
                {revision?.revision ?? document.activeRevision ?? '—'}
              </dd>
            </div>
          </dl>
        </section>
        <section className="mt-7">
          <h2 className="system-sm-semibold text-text-primary">
            {t(($) => $['newKnowledge.indexInformation'])}
          </h2>
          <dl className="mt-3 space-y-3">
            <div>
              <dt className="system-2xs-medium text-text-tertiary">
                {t(($) => $['newKnowledge.chunkCount'])}
              </dt>
              <dd className="mt-1 system-xs-regular text-text-secondary">
                {chunksComplete ? new Intl.NumberFormat(locale).format(chunks.length) : '—'}
              </dd>
            </div>
            <div>
              <dt className="system-2xs-medium text-text-tertiary">
                {t(($) => $['newKnowledge.averageChunkLength'])}
              </dt>
              <dd className="mt-1 system-xs-regular text-text-secondary">
                {chunksComplete ? new Intl.NumberFormat(locale).format(averageChunkLength) : '—'}
              </dd>
            </div>
            <div>
              <dt className="system-2xs-medium text-text-tertiary">
                {t(($) => $['newKnowledge.retrievalCount'])}
              </dt>
              <dd className="mt-1 system-xs-regular text-text-secondary">
                {retrievalCount === undefined
                  ? '—'
                  : new Intl.NumberFormat(locale).format(retrievalCount)}
              </dd>
            </div>
            <div>
              <dt className="system-2xs-medium text-text-tertiary">
                {t(($) => $['newKnowledge.mimeType'])}
              </dt>
              <dd className="mt-1 system-xs-regular break-words text-text-secondary">
                {revision?.mimeType ?? document.active?.mimeType ?? '—'}
              </dd>
            </div>
            {selectedChunk && (
              <>
                <div>
                  <dt className="system-2xs-medium text-text-tertiary">
                    {t(($) => $['newKnowledge.tokenCount'])}
                  </dt>
                  <dd className="mt-1 system-xs-regular text-text-secondary">
                    {new Intl.NumberFormat(locale).format(selectedChunk.tokenCount)}
                  </dd>
                </div>
                <div>
                  <dt className="system-2xs-medium text-text-tertiary">
                    {t(($) => $['newKnowledge.characterCount'])}
                  </dt>
                  <dd className="mt-1 system-xs-regular text-text-secondary">
                    {new Intl.NumberFormat(locale).format(chunkCharacterCount(selectedChunk.text))}
                  </dd>
                </div>
                {chunkMetadataEntries(selectedChunk.userMetadata).map(([key, value]) => (
                  <div key={key}>
                    <dt className="system-2xs-medium break-words text-text-tertiary">{key}</dt>
                    <dd className="mt-1 system-xs-regular break-words text-text-secondary">
                      {value}
                    </dd>
                  </div>
                ))}
              </>
            )}
          </dl>
        </section>
      </aside>
    </>
  )
}
