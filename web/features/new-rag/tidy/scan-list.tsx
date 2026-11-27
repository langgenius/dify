'use client'

import type { KnowledgeFsTidyScanResponse } from '@dify/contracts/api/console/knowledge-fs/types.gen'
import type { I18nKeysWithoutVariables } from '@/types/i18n'
import { Button } from '@langgenius/dify-ui/button'
import { useTranslation } from 'react-i18next'
import { useOwnedQueryError } from '@/service/use-owned-query-error'
import { useTidyScans } from './use-tidy'

const SCAN_STATES = {
  pending: 'tidy.pending',
  scanning: 'tidy.scanning',
  complete: 'tidy.complete',
  failed: 'tidy.failed',
} as const satisfies Record<
  KnowledgeFsTidyScanResponse['state'],
  I18nKeysWithoutVariables<'knowledgeSpace'>
>

/** Per-document scan progress, folded away by default, with a retry for scans that failed. */
export function ScanList({
  canManage,
  live,
  onRetry,
  retrying,
  scanning,
  spaceId,
}: {
  canManage: boolean
  /** A scan is running or waiting, so the list changes on its own. */
  live: boolean
  onRetry: () => void
  retrying: boolean
  /** Tidy is on; with it off there is nothing to retry. */
  scanning: boolean
  spaceId: string
}) {
  const { t } = useTranslation(['knowledgeSpace'])
  const { t: common } = useTranslation(['common'])
  const { scans, paged, previousPage, nextPage } = useTidyScans(spaceId, live)
  // A failed first load is shown in place of the list; a failed refresh keeps the scans.
  const scansLoad = useOwnedQueryError(scans)
  return (
    <details className="mb-5 rounded-xl border border-divider-regular p-4">
      <summary className="cursor-pointer system-sm-semibold text-text-primary">
        {t(($) => $['tidy.progress'])}
      </summary>
      {scans.isPending && <p role="status">{common(($) => $.loading)}</p>}
      {scansLoad && <p role="alert">{t(($) => $['tidy.error'])}</p>}
      <ul className="my-3 space-y-2">
        {scans.data?.items.map((scan) => (
          <li
            key={scan.documentId}
            className="flex flex-wrap justify-between gap-2 body-sm-regular"
          >
            <span>{scan.title}</span>
            <span>
              {t(($) => $[SCAN_STATES[scan.state]])} ·{' '}
              {t(($) => $['tidy.usage'], { windows: scan.windows, calls: scan.modelCalls })}
            </span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        {canManage && (
          <Button disabled={!scanning} loading={retrying} onClick={onRetry}>
            {common(($) => $['operation.retry'])}
          </Button>
        )}
        {paged && <Button onClick={previousPage}>{common(($) => $['operation.back'])}</Button>}
        {scans.data?.nextCursor && (
          <Button onClick={nextPage}>{common(($) => $['pagination.next'])}</Button>
        )}
      </div>
    </details>
  )
}
