import type {
  DocumentRevisionChunk,
  LogicalDocument,
  LogicalDocumentRevision,
} from '@dify/contracts/knowledge-fs/types.gen'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { chunkCharacterCount, chunkMetadataEntries } from './document-detail-model'

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
  locale,
  revision,
  selectedChunk,
}: {
  document: LogicalDocument
  locale: string
  revision?: Exclude<LogicalDocumentRevision, null>
  selectedChunk?: DocumentRevisionChunk
}) {
  const { t } = useTranslation('dataset')
  const characterCount = useMemo(
    () => (selectedChunk ? chunkCharacterCount(selectedChunk.text) : 0),
    [selectedChunk],
  )
  const sizeBytes = revision?.sizeBytes ?? document.active?.sizeBytes
  return (
    <>
      <article className="min-h-72 min-w-0 overflow-hidden rounded-xl border border-divider-subtle bg-background-default">
        {selectedChunk ? (
          <>
            <header className="border-b border-divider-subtle px-5 py-4">
              <h2 className="system-md-semibold text-text-primary">
                {t(($) => $['newKnowledge.chunkHeading'], {
                  position: selectedChunk.ordinal,
                })}
              </h2>
              <p className="mt-1 system-2xs-regular text-text-tertiary">
                {t(($) => $['newKnowledge.chunkLocation'], {
                  position: selectedChunk.ordinal,
                })}
              </p>
            </header>
            <div
              key={selectedChunk.id}
              className="max-h-[58vh] overflow-auto px-5 py-4"
              data-testid="chunk-content-scroll"
            >
              <p className="body-md-regular break-words whitespace-pre-wrap text-text-primary">
                {selectedChunk.text || t(($) => $['newKnowledge.emptyChunk'])}
              </p>
            </div>
          </>
        ) : (
          <div className="flex min-h-72 items-center justify-center px-6 text-center body-sm-regular text-text-tertiary">
            {t(($) => $['newKnowledge.selectChunk'])}
          </div>
        )}
      </article>

      <aside className="space-y-4">
        <section className="rounded-xl border border-divider-subtle bg-background-default p-4">
          <h2 className="system-sm-semibold text-text-primary">
            {t(($) => $['newKnowledge.metadata'])}
          </h2>
          {selectedChunk && (
            <dl className="mt-3 space-y-3">
              <div>
                <dt className="system-2xs-medium text-text-tertiary">
                  {t(($) => $['newKnowledge.characterCount'])}
                </dt>
                <dd className="mt-1 system-xs-regular text-text-secondary">
                  {new Intl.NumberFormat(locale).format(characterCount)}
                </dd>
              </div>
              <div>
                <dt className="system-2xs-medium text-text-tertiary">
                  {t(($) => $['newKnowledge.tokenCount'])}
                </dt>
                <dd className="mt-1 system-xs-regular text-text-secondary">
                  {new Intl.NumberFormat(locale).format(selectedChunk.tokenCount)}
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
            </dl>
          )}
        </section>
        <section className="rounded-xl border border-divider-subtle bg-background-default p-4">
          <h2 className="system-sm-semibold text-text-primary">
            {t(($) => $['newKnowledge.documentFacts'])}
          </h2>
          <dl className="mt-3 space-y-3">
            <div>
              <dt className="system-2xs-medium text-text-tertiary">
                {t(($) => $['newKnowledge.mimeType'])}
              </dt>
              <dd className="mt-1 system-xs-regular break-words text-text-secondary">
                {revision?.mimeType ?? document.active?.mimeType ?? '—'}
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
                {t(($) => $['newKnowledge.updatedAt'])}
              </dt>
              <dd className="mt-1 system-xs-regular text-text-secondary">
                {formatDate(document.updatedAt, locale)}
              </dd>
            </div>
          </dl>
        </section>
      </aside>
    </>
  )
}
