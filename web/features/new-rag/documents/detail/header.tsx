import type { RefObject } from 'react'
import type { LogicalDocument } from '../models'
import { Button } from '@langgenius/dify-ui/button'
import { useTranslation } from 'react-i18next'
import Link from '@/next/link'

export function DocumentDetailHeader({
  backPath,
  canCancelReindex,
  cancelReindexBusy,
  document,
  onCancelReindex,
  onReindex,
  reindexDisabled,
  reindexDisabledReasonId,
  reindexFailed,
  reindexInProgress,
  reindexing,
  titleRef,
}: {
  backPath: string
  canCancelReindex: boolean
  cancelReindexBusy: boolean
  document: LogicalDocument
  onCancelReindex: () => void
  onReindex: () => void
  reindexDisabled: boolean
  reindexDisabledReasonId?: string
  reindexFailed: boolean
  reindexInProgress: boolean
  reindexing: boolean
  titleRef: RefObject<HTMLHeadingElement | null>
}) {
  const { t } = useTranslation('dataset')

  return (
    <>
      <div className="flex h-6 items-center">
        <Link
          className="inline-flex w-fit items-center gap-1 system-xs-medium text-text-tertiary hover:text-text-secondary focus-visible:rounded focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
          href={backPath}
        >
          <span aria-hidden className="i-ri-arrow-left-line size-4" />
          {t(($) => $['newKnowledge.documents'])}
        </Link>
      </div>
      <div className="mt-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1
            ref={titleRef}
            className="truncate title-2xl-semi-bold text-text-primary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
            tabIndex={-1}
          >
            {document.title}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            aria-busy={reindexing || cancelReindexBusy}
            aria-describedby={reindexDisabledReasonId}
            className="gap-1 pl-3"
            disabled={reindexInProgress ? !canCancelReindex : reindexDisabled}
            loading={reindexInProgress ? cancelReindexBusy : reindexing}
            onClick={reindexInProgress ? onCancelReindex : onReindex}
          >
            {!reindexInProgress && <span aria-hidden className="i-ri-refresh-line size-4" />}
            {t(($) =>
              reindexInProgress
                ? $['newKnowledge.cancelDocumentReindex']
                : reindexFailed
                  ? $['newKnowledge.retryReindexDocument']
                  : $['newKnowledge.reindexDocument'],
            )}
          </Button>
        </div>
      </div>
    </>
  )
}
