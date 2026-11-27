'use client'

import type {
  KnowledgeFsTidySettingsResponse,
  KnowledgeFsTidySummaryResponse,
} from '@dify/contracts/api/console/knowledge-fs/types.gen'
import type { UseQueryResult } from '@tanstack/react-query'
import type { I18nKeysWithoutVariables } from '@/types/i18n'
import { Button } from '@langgenius/dify-ui/button'
import { Switch } from '@langgenius/dify-ui/switch'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { useOwnedQueryError } from '@/service/use-owned-query-error'
import { scanIsActive } from './use-tidy'

const PAUSE_REASONS = {
  authorization_failed: 'tidy.pausedAuthorization',
  model_unavailable: 'tidy.pausedModel',
  scan_failed: 'tidy.pausedScan',
} as const satisfies Record<
  NonNullable<KnowledgeFsTidySettingsResponse['lastError']>,
  I18nKeysWithoutVariables<'knowledgeSpace'>
>

/** Documents finished (scanned or given up) out of all current documents, and what it cost. */
function progressOf(summary: KnowledgeFsTidySummaryResponse) {
  const docs = summary.documents
  const total = docs.pending + docs.scanning + docs.complete + docs.failed
  const done = docs.complete + docs.failed
  const current = summary.current ?? null
  // A long document is most of the work: count its scanned passages too.
  const partial =
    current && current.passagesTotal > 0
      ? Math.min(1, current.passagesDone / current.passagesTotal)
      : 0
  return {
    total,
    done,
    percent: total ? Math.min(100, Math.round(((done + partial) / total) * 100)) : 0,
    current,
    active: scanIsActive(summary),
    failed: docs.failed,
    modelCalls: summary.modelCalls,
  }
}

/** The Tidy switch and, once it is on, conflict detection, scan progress and why a scan paused. */
export function SettingsCard({
  busy,
  canManage,
  onRetry,
  onToggle,
  onToggleConflicts,
  retrying,
  saving,
  settings,
  summary,
}: {
  /** Some action of the page is in flight. */
  busy: boolean
  canManage: boolean
  onRetry: () => void
  onToggle: (enabled: boolean) => void
  onToggleConflicts: (conflicts: boolean) => void
  retrying: boolean
  /** The switch itself is being saved (not a choice made in a dialog). */
  saving: boolean
  settings: UseQueryResult<KnowledgeFsTidySettingsResponse>
  summary: KnowledgeFsTidySummaryResponse | undefined
}) {
  const { t } = useTranslation(['knowledgeSpace'])
  const { t: common } = useTranslation(['common'])
  const enabledLabelId = useId()
  const conflictsLabelId = useId()
  // A failed first load is shown in the card; a failed refresh keeps the settings.
  const settingsLoad = useOwnedQueryError(settings)
  const progress = summary && progressOf(summary)
  const lastError = settings.data?.enabled ? settings.data.lastError : null
  return (
    <div className="my-5 rounded-xl border border-divider-regular p-4">
      <div className="flex items-center justify-between gap-4">
        <span id={enabledLabelId} className="system-md-semibold text-text-primary">
          {t(($) => $['tidy.enabled'])}
        </span>
        <Switch
          aria-labelledby={enabledLabelId}
          checked={settings.data?.enabled ?? false}
          loading={saving}
          disabled={!canManage || !settings.data}
          onCheckedChange={onToggle}
        />
      </div>
      <p className="mt-2 body-sm-regular text-text-tertiary">{t(($) => $['tidy.schedule'])}</p>
      {settings.isPending && <p role="status">{common(($) => $.loading)}</p>}
      {settingsLoad && <p role="alert">{t(($) => $['tidy.error'])}</p>}
      {settings.data?.enabled && (
        <div className="mt-4 flex flex-col gap-3 border-t border-divider-subtle pt-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <span id={conflictsLabelId} className="system-sm-semibold text-text-secondary">
                {t(($) => $['tidy.conflicts'])}
              </span>
              <p className="mt-1 body-sm-regular text-text-tertiary">
                {t(($) => $['tidy.conflictsHint'])}
              </p>
            </div>
            <Switch
              aria-labelledby={conflictsLabelId}
              checked={settings.data.conflicts}
              disabled={!canManage || busy}
              onCheckedChange={onToggleConflicts}
            />
          </div>
          {progress && (
            <div className="flex flex-col gap-1.5">
              <p role="status" className="body-sm-regular text-text-secondary">
                {t(($) => $['tidy.progressSummary'], {
                  done: progress.done,
                  total: progress.total,
                })}
                {progress.modelCalls > 0 && (
                  <span className="text-text-tertiary">
                    {' · '}
                    {t(($) => $['tidy.modelCalls'], { count: progress.modelCalls })}
                  </span>
                )}
              </p>
              {progress.active && (
                <div
                  role="progressbar"
                  aria-label={t(($) => $['tidy.progress'])}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={progress.percent}
                  className="h-1 overflow-hidden rounded-full bg-components-progress-bar-bg"
                >
                  <div
                    className="h-full rounded-full bg-components-progress-bar-progress-solid"
                    style={{ width: `${progress.percent}%` }}
                  />
                </div>
              )}
              {progress.active && progress.current && progress.current.passagesTotal > 0 && (
                <p className="truncate body-xs-regular text-text-tertiary tabular-nums">
                  {t(($) => $['tidy.progressCurrent'], {
                    title: progress.current.title,
                    done: progress.current.passagesDone,
                    total: progress.current.passagesTotal,
                  })}
                </p>
              )}
            </div>
          )}
          {lastError && (
            <div
              role="alert"
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-background-section p-3 text-text-warning"
            >
              <span className="body-sm-regular">{t(($) => $[PAUSE_REASONS[lastError]])}</span>
              {canManage && (
                <Button size="small" loading={retrying} onClick={onRetry}>
                  {common(($) => $['operation.retry'])}
                </Button>
              )}
            </div>
          )}
          {progress && progress.failed > 0 && (
            <p className="body-sm-regular text-text-warning">
              {t(($) => $['tidy.failedCount'], { count: progress.failed })}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
