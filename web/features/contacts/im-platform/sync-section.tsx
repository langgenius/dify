'use client'

import type { ContactImIntegrationView, ContactImSyncRunView } from './types'
import { Button } from '@langgenius/dify-ui/button'
import { useTranslation } from 'react-i18next'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'
import { useContactImActiveSync, useStartContactImSync } from './hooks'
import { ContactImConnectionStatus, ContactImSafeReason, ContactImSyncStatus } from './types'

const isActiveRun = (run: ContactImSyncRunView | null | undefined) =>
  run?.status === ContactImSyncStatus.Queued || run?.status === ContactImSyncStatus.Running

export function ContactImDirectorySyncSection({
  integration,
  onViewDetails,
}: {
  integration: ContactImIntegrationView
  onViewDetails: (runId: string) => void
}) {
  const { t } = useTranslation('contacts')
  const { formatTimeFromNow } = useFormatTimeFromNow()
  const activeSyncQuery = useContactImActiveSync()
  const startSync = useStartContactImSync()
  const currentRun = activeSyncQuery.data
  const displayedRun = currentRun ?? integration.lastSync
  const displayedRunDate = displayedRun?.completedAt ?? displayedRun?.startedAt
  const displayedRunIsActive = isActiveRun(displayedRun)
  const syncIsActive = isActiveRun(currentRun)
  const canStart =
    integration.canManage &&
    integration.status === ContactImConnectionStatus.Connected &&
    integration.capabilities.directorySync
  const isSyncing = startSync.isPending || syncIsActive
  const buttonDisabled =
    activeSyncQuery.isPending || activeSyncQuery.isError || !canStart || syncIsActive
  const disabledReason = !integration.canManage
    ? t(($) => $['imPlatform.sync.noPermission'])
    : integration.status !== ContactImConnectionStatus.Connected
      ? t(($) => $['imPlatform.sync.notConnected'])
      : !integration.capabilities.directorySync
        ? t(($) => $['imPlatform.sync.unsupported'])
        : null
  const statusLabels = {
    [ContactImSyncStatus.Failure]: t(($) => $['imPlatform.sync.status.failure']),
    [ContactImSyncStatus.PartialSuccess]: t(($) => $['imPlatform.sync.status.partial_success']),
    [ContactImSyncStatus.Queued]: t(($) => $['imPlatform.sync.status.queued']),
    [ContactImSyncStatus.Running]: t(($) => $['imPlatform.sync.status.running']),
    [ContactImSyncStatus.Success]: t(($) => $['imPlatform.sync.status.success']),
  }
  const safeErrorLabels = {
    [ContactImSafeReason.ContactUpdateFailed]: t(
      ($) => $['imPlatform.details.safeReason.contact_update_failed'],
    ),
    [ContactImSafeReason.DuplicateIdentity]: t(
      ($) => $['imPlatform.details.safeReason.duplicate_identity'],
    ),
    [ContactImSafeReason.MissingEmail]: t(($) => $['imPlatform.details.safeReason.missing_email']),
    [ContactImSafeReason.NoMatchingContact]: t(
      ($) => $['imPlatform.details.safeReason.no_matching_contact'],
    ),
    [ContactImSafeReason.ProviderRequestFailed]: t(
      ($) => $['imPlatform.details.safeReason.provider_request_failed'],
    ),
  }

  return (
    <div className="mt-2 rounded-xl bg-background-section-burn px-4 py-3">
      <div className="flex items-center gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 system-xs-regular text-text-tertiary">
          <span aria-hidden className="i-ri-loop-left-line size-3 shrink-0" />
          {displayedRun ? (
            displayedRunIsActive ? (
              <span aria-live="polite">{statusLabels[displayedRun.status]}</span>
            ) : (
              <>
                <span>
                  {t(($) => $['imPlatform.sync.latestSynced'], {
                    date: displayedRunDate
                      ? formatTimeFromNow(new Date(displayedRunDate).getTime())
                      : t(($) => $['imPlatform.details.missing']),
                  })}
                </span>
                <span aria-hidden className="flex shrink-0 px-1">
                  <span className="h-3 w-px bg-divider-regular" />
                </span>
                <Button
                  className="h-auto shrink-0 rounded-none px-0 font-normal hover:bg-transparent hover:underline"
                  onClick={() => onViewDetails(displayedRun.id)}
                  size="small"
                  variant="ghost-accent"
                >
                  {t(($) => $['imPlatform.action.viewDetails'])}
                </Button>
              </>
            )
          ) : (
            <span>
              {activeSyncQuery.isPending
                ? t(($) => $['imPlatform.sync.loading'])
                : t(($) => $['imPlatform.sync.noRuns'])}
            </span>
          )}
        </div>
        <Button
          aria-label={
            isSyncing
              ? t(($) => $['imPlatform.action.syncing'])
              : t(($) => $['imPlatform.action.syncNow'])
          }
          disabled={buttonDisabled}
          loading={startSync.isPending}
          onClick={() => {
            if (buttonDisabled || startSync.isPending) return
            startSync.mutate()
          }}
          size="small"
        >
          {isSyncing
            ? t(($) => $['imPlatform.action.syncing'])
            : t(($) => $['imPlatform.action.syncNow'])}
        </Button>
      </div>

      {disabledReason && (
        <div className="mt-2 system-xs-regular text-text-tertiary">{disabledReason}</div>
      )}

      {(activeSyncQuery.isError || startSync.isError) && (
        <div role="alert" className="mt-2 system-xs-regular text-text-destructive">
          {t(($) => $['imPlatform.sync.startFailed'])}
          {activeSyncQuery.isError && (
            <Button className="ml-3" onClick={() => activeSyncQuery.refetch()} size="small">
              {t(($) => $['imPlatform.action.retry'])}
            </Button>
          )}
        </div>
      )}

      {displayedRun && !displayedRunIsActive && (
        <>
          <div
            aria-live="polite"
            className={
              displayedRun.status === ContactImSyncStatus.Success
                ? 'sr-only'
                : 'mt-2 system-xs-medium text-text-destructive'
            }
          >
            {statusLabels[displayedRun.status]}
          </div>
          {(displayedRun.errorMessage || displayedRun.safeError) && (
            <div className="mt-2 system-xs-regular text-text-destructive">
              {displayedRun.errorMessage ??
                (displayedRun.safeError ? safeErrorLabels[displayedRun.safeError] : null)}
            </div>
          )}
        </>
      )}
    </div>
  )
}
