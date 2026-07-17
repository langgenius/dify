'use client'

import type { ContactImIntegrationView, ContactImSyncRunView } from './types'
import { Button } from '@langgenius/dify-ui/button'
import { useTranslation } from 'react-i18next'
import { useContactImActiveSync, useContactImSyncRun, useStartContactImSync } from './hooks'
import {
  ContactImConnectionStatus,
  ContactImSafeReason,
  ContactImSyncResult,
  ContactImSyncStatus,
} from './types'

const isActiveRun = (run: ContactImSyncRunView | null | undefined) =>
  run?.status === ContactImSyncStatus.Queued || run?.status === ContactImSyncStatus.Running

export function ContactImDirectorySyncSection({
  formatDate,
  integration,
  onViewDetails,
}: {
  formatDate: (value: string) => string
  integration: ContactImIntegrationView
  onViewDetails: (runId: string) => void
}) {
  const { t } = useTranslation('contacts')
  const activeSyncQuery = useContactImActiveSync()
  const startSync = useStartContactImSync()
  const activeRunId = startSync.data?.id ?? activeSyncQuery.data?.id ?? null
  const activeRunQuery = useContactImSyncRun(activeRunId)
  const currentRun = activeRunQuery.data ?? startSync.data ?? activeSyncQuery.data
  const displayedRun = currentRun ?? integration.lastSync
  const syncIsActive = isActiveRun(currentRun)
  const canStart =
    integration.canManage &&
    integration.status === ContactImConnectionStatus.Connected &&
    integration.capabilities.directorySync
  const isSyncing = startSync.isPending || syncIsActive
  const buttonDisabled = activeSyncQuery.isPending || !canStart || isSyncing
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
  const countLabels = {
    [ContactImSyncResult.CreatedBinding]: t(($) => $['imPlatform.sync.count.created_binding']),
    [ContactImSyncResult.Failed]: t(($) => $['imPlatform.sync.count.failed']),
    [ContactImSyncResult.Matched]: t(($) => $['imPlatform.sync.count.matched']),
    [ContactImSyncResult.Skipped]: t(($) => $['imPlatform.sync.count.skipped']),
    [ContactImSyncResult.Unmatched]: t(($) => $['imPlatform.sync.count.unmatched']),
    [ContactImSyncResult.UpdatedBinding]: t(($) => $['imPlatform.sync.count.updated_binding']),
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
    <div className="mt-5 rounded-xl border border-divider-subtle bg-components-panel-bg p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="system-sm-semibold text-text-primary">
            {t(($) => $['imPlatform.sync.title'])}
          </div>
          <div className="mt-1 system-xs-regular text-text-tertiary">
            {t(($) => $['imPlatform.sync.description'])}
          </div>
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
            if (buttonDisabled) return
            startSync.mutate()
          }}
        >
          {isSyncing
            ? t(($) => $['imPlatform.action.syncing'])
            : t(($) => $['imPlatform.action.syncNow'])}
        </Button>
      </div>

      {disabledReason && (
        <div className="mt-3 rounded-lg bg-background-default-subtle px-3 py-2 system-xs-regular text-text-tertiary">
          {disabledReason}
        </div>
      )}

      {(activeSyncQuery.isError || startSync.isError || activeRunQuery.isError) && (
        <div role="alert" className="mt-3 system-xs-regular text-text-destructive">
          {t(($) => $['imPlatform.sync.startFailed'])}
        </div>
      )}

      {displayedRun ? (
        <div className="mt-4 border-t border-divider-subtle pt-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div aria-live="polite" className="system-sm-medium text-text-primary">
                {statusLabels[displayedRun.status]}
              </div>
              <div className="mt-1 system-xs-regular text-text-tertiary">
                {t(($) => $['imPlatform.sync.lastSynced'], {
                  date: formatDate(displayedRun.completedAt ?? displayedRun.startedAt),
                  user: displayedRun.startedBy,
                })}
              </div>
            </div>
            {!isActiveRun(displayedRun) && (
              <Button onClick={() => onViewDetails(displayedRun.id)}>
                {t(($) => $['imPlatform.action.viewDetails'])}
              </Button>
            )}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {Object.values(ContactImSyncResult).map((result) => (
              <div
                key={result}
                className="rounded-lg border border-divider-subtle bg-background-default-subtle px-2 py-1 system-xs-regular text-text-secondary"
              >
                {countLabels[result]}{' '}
                <span className="font-semibold">{displayedRun.counts[result]}</span>
              </div>
            ))}
          </div>
          {displayedRun.safeError && (
            <div className="mt-3 system-xs-regular text-text-destructive">
              {safeErrorLabels[displayedRun.safeError]}
            </div>
          )}
        </div>
      ) : (
        <div className="mt-4 border-t border-divider-subtle pt-4 system-xs-regular text-text-tertiary">
          {activeSyncQuery.isPending
            ? t(($) => $['imPlatform.sync.loading'])
            : t(($) => $['imPlatform.sync.noRuns'])}
        </div>
      )}
    </div>
  )
}
