import type {
  LogicalDocument,
  LogicalDocumentRevision,
} from '@dify/contracts/knowledge-fs/types.gen'
import type { RefObject } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectLabel,
  SelectTrigger,
} from '@langgenius/dify-ui/select'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import Link from '@/next/link'
import { sourceName } from './document-model'

export function DocumentDetailHeader({
  backPath,
  document,
  effectiveRevision,
  fetchNextRevisionPage,
  hasNextRevisionPage,
  isFetchNextRevisionPageError,
  isFetchingNextRevisionPage,
  onReindex,
  onRevisionChange,
  reindexDisabled,
  reindexing,
  revisions,
  taskIsActive,
  titleRef,
}: {
  backPath: string
  document: LogicalDocument
  effectiveRevision?: number
  fetchNextRevisionPage: () => void
  hasNextRevisionPage: boolean
  isFetchNextRevisionPageError: boolean
  isFetchingNextRevisionPage: boolean
  onReindex: () => void
  onRevisionChange: (revision: number) => void
  reindexDisabled: boolean
  reindexing: boolean
  revisions: Array<Exclude<LogicalDocumentRevision, null>>
  taskIsActive: boolean
  titleRef: RefObject<HTMLHeadingElement | null>
}) {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const revisionTriggerRef = useRef<HTMLButtonElement>(null)
  const loadMoreRequestedRef = useRef(false)
  const wasFetchingNextPageRef = useRef(false)

  useEffect(() => {
    if (isFetchingNextRevisionPage) wasFetchingNextPageRef.current = true
    if (
      isFetchingNextRevisionPage ||
      !wasFetchingNextPageRef.current ||
      !loadMoreRequestedRef.current
    )
      return
    wasFetchingNextPageRef.current = false
    loadMoreRequestedRef.current = false
    if (!isFetchNextRevisionPageError && !hasNextRevisionPage) revisionTriggerRef.current?.focus()
  }, [hasNextRevisionPage, isFetchNextRevisionPageError, isFetchingNextRevisionPage])

  return (
    <>
      <Link
        className="inline-flex w-fit items-center gap-1 system-xs-medium text-text-tertiary hover:text-text-secondary focus-visible:rounded focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
        href={backPath}
      >
        <span aria-hidden className="i-ri-arrow-left-line size-4" />
        {t(($) => $['newKnowledge.documents'])}
      </Link>
      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1
            ref={titleRef}
            className="truncate title-2xl-semi-bold text-text-primary outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid"
            tabIndex={-1}
          >
            {document.title}
          </h1>
          <p className="mt-1 system-xs-regular text-text-tertiary">
            {sourceName(document) ?? t(($) => $['newKnowledge.manualUpload'])}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {revisions.length > 0 && effectiveRevision !== undefined && (
            <Select
              value={String(effectiveRevision)}
              onValueChange={(value) => {
                if (value) onRevisionChange(Number(value))
              }}
            >
              <SelectLabel>{t(($) => $['newKnowledge.documentRevision'])}</SelectLabel>
              <SelectTrigger ref={revisionTriggerRef} className="h-8 w-fit min-w-28">
                v{effectiveRevision}
              </SelectTrigger>
              <SelectContent>
                {revisions.map((revision) => (
                  <SelectItem key={revision.revision} value={String(revision.revision)}>
                    <SelectItemText>
                      v{revision.revision} ·{' '}
                      {t(($) => $[`newKnowledge.revisionState.${revision.state}`])}
                    </SelectItemText>
                    <SelectItemIndicator />
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {(hasNextRevisionPage || isFetchNextRevisionPageError) && (
            <Button
              disabled={isFetchingNextRevisionPage}
              loading={isFetchingNextRevisionPage}
              onClick={() => {
                loadMoreRequestedRef.current = true
                fetchNextRevisionPage()
              }}
            >
              {isFetchNextRevisionPageError
                ? tCommon(($) => $['operation.retry'])
                : t(($) => $['newKnowledge.loadMoreRevisions'])}
            </Button>
          )}
          <Button
            aria-busy={reindexing || taskIsActive}
            disabled={reindexDisabled}
            loading={reindexing}
            onClick={onReindex}
          >
            <span aria-hidden className="i-ri-refresh-line size-4" />
            {t(($) => $['newKnowledge.reindexDocument'])}
          </Button>
        </div>
      </div>
      {isFetchNextRevisionPageError && (
        <p className="mt-2 system-xs-regular text-text-destructive" role="alert">
          {t(($) => $['newKnowledge.documentRevisionsLoadError'])}
        </p>
      )}
    </>
  )
}
