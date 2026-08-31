'use client'

import type { StatusDotStatus } from '@langgenius/dify-ui/status-dot'
import type { SourceAction, SourceEditValues } from './source-list-model'
import type { Source, SourceDisplayStatus } from './source-models'
import { Button } from '@langgenius/dify-ui/button'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import { cn } from '@langgenius/dify-ui/cn'
import { StatusDot } from '@langgenius/dify-ui/status-dot'
import { toast } from '@langgenius/dify-ui/toast'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Infotip } from '@/app/components/base/infotip'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'
import { consoleClient, consoleQuery } from '@/service/client'
import { knowledgeFsTaskFailureMessageKey } from '../knowledge-fs-task-error'
import { SourceProviderIcon } from './setup/fields'
import { SourceActions } from './source-actions'
import { sourceTableGridClass } from './source-list-layout'
import {
  createIdempotencyKey,
  metadataString,
  sourceLastSyncAt,
  sourceProviderDetails,
  sourceSyncPolicyTranslationKey,
} from './source-list-model'
import {
  initialSourceWorkflowId,
  sourceAsyncImportWorkflowId,
  sourceDisplayStatus,
  sourceFromApi,
  sourceStatusWithSyncWorkflow,
  sourceWorkflowFromApi,
  sourceWorkflowIsActive,
} from './source-models'

const statusDotStatus: Record<SourceDisplayStatus, StatusDotStatus> = {
  active: 'success',
  syncing: 'normal',
  initializing: 'normal',
  disabled: 'disabled',
  error: 'error',
}

function TruncatedSourceValue({ children, className }: { children: string; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<span className={cn('block truncate', className)}>{children}</span>}
      />
      <TooltipContent>{children}</TooltipContent>
    </Tooltip>
  )
}

export function SourceRow({
  canEdit,
  canSync,
  checked,
  ensureModelSetupReady,
  knowledgeSpaceId,
  onCheckedChange,
  onRemoved,
  onSourceChange,
  source,
}: {
  canEdit: boolean
  canSync: boolean
  checked: boolean
  ensureModelSetupReady: () => Promise<boolean>
  knowledgeSpaceId: string
  onCheckedChange: (checked: boolean) => void
  onRemoved: () => void
  onSourceChange: (source: Source) => void
  source: Source
}) {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const { formatTimeFromNow } = useFormatTimeFromNow()
  const queryClient = useQueryClient()
  const [pendingAction, setPendingAction] = useState<SourceAction>()
  const syncWorkflow = source.syncWorkflow
  const displayStatus = sourceDisplayStatus(source)
  const initializing = displayStatus === 'initializing'
  const initialWorkflowId = initialSourceWorkflowId(source)
  const initialImportRetrying = Boolean(initialWorkflowId) && displayStatus === 'syncing'

  const provider = sourceProviderDetails(source)
  const providerName = provider.name
  const providerKind = metadataString(source.metadata, 'providerKind')
  const sourceSyncPolicy = source.syncPolicy
  const syncPolicy = sourceSyncPolicy
    ? t(($) => $[sourceSyncPolicyTranslationKey(sourceSyncPolicy)])
    : metadataString(source.metadata, 'syncPolicy')
  const lastSyncAt = sourceLastSyncAt(source)
  const lastSyncTimestamp = lastSyncAt ? Date.parse(lastSyncAt) : Number.NaN
  const lastSync = Number.isNaN(lastSyncTimestamp)
    ? undefined
    : formatTimeFromNow(lastSyncTimestamp)
  const syncFailureMessageKey = knowledgeFsTaskFailureMessageKey(
    undefined,
    syncWorkflow?.lastErrorCode,
  )
  const typeLabel =
    source.type === 'connector' &&
    (providerKind === 'online-document' ||
      providerName === 'Notion' ||
      providerName === 'Google Docs' ||
      providerName === 'Confluence')
      ? t(($) => $['newKnowledge.onlineDocuments'])
      : source.type === 'connector' &&
          (providerKind === 'online-drive' ||
            providerName === 'Google Drive' ||
            providerName === 'OneDrive' ||
            providerName === 'Amazon S3')
        ? t(($) => $['newKnowledge.onlineDrive'])
        : t(($) => $[`newKnowledge.sourceType.${source.type}`])
  const sourceIcon =
    provider.iconClass ?? (source.type === 'web' ? 'i-ri-global-line' : 'i-ri-links-line')

  const runAction = async <Result,>(
    action: SourceAction,
    mutation: () => Promise<Result>,
    onAccepted?: (result: Result) => void,
    beforeAction?: () => Promise<boolean>,
  ) => {
    if (pendingAction) return false
    setPendingAction(action)
    try {
      if (beforeAction && !(await beforeAction())) return false
      let result: Result
      try {
        result = await mutation()
      } catch {
        toast.error(t(($) => $['newKnowledge.sourcesErrorDescription']))
        try {
          await queryClient.invalidateQueries({
            queryKey: consoleQuery.knowledgeFs.spaces.byControlSpaceId.sources.get.key(),
          })
        } catch {
          return false
        }
        return false
      }
      onAccepted?.(result)

      try {
        await queryClient.invalidateQueries(
          {
            queryKey: consoleQuery.knowledgeFs.spaces.byControlSpaceId.sources.get.key(),
          },
          {
            throwOnError: true,
          },
        )
      } catch {
        // The accepted mutation is already reflected by the list-owner state.
      }
      return true
    } finally {
      setPendingAction(undefined)
    }
  }

  const applyAcceptedWorkflow = (workflow: Parameters<typeof sourceWorkflowFromApi>[0]) => {
    const run = sourceWorkflowFromApi(workflow)
    onSourceChange({
      ...source,
      syncWorkflow: run,
      status: sourceStatusWithSyncWorkflow(source.status, run),
    })
  }

  const syncSource = () =>
    runAction(
      'sync',
      () =>
        consoleClient.knowledgeFs.spaces.byControlSpaceId.sources.bySourceId.sync.post({
          headers: { 'Idempotency-Key': createIdempotencyKey() },
          params: { control_space_id: knowledgeSpaceId, source_id: source.id },
        }),
      applyAcceptedWorkflow,
      ensureModelSetupReady,
    )

  const retrySource = () => {
    const retryWorkflowId =
      initialWorkflowId ?? sourceAsyncImportWorkflowId(source) ?? syncWorkflow?.id
    if (!retryWorkflowId) return syncSource()

    return runAction(
      'sync',
      () =>
        consoleClient.knowledgeFs.spaces.byControlSpaceId.sourceWorkflows.byRunId.retry.post({
          params: { control_space_id: knowledgeSpaceId, run_id: retryWorkflowId },
        }),
      applyAcceptedWorkflow,
      ensureModelSetupReady,
    )
  }

  const toggleSource = () =>
    runAction(
      'toggle',
      async () =>
        sourceFromApi(
          await consoleClient.knowledgeFs.spaces.byControlSpaceId.sources.bySourceId.patch({
            body: {
              ...(source.version === undefined ? {} : { expectedVersion: source.version }),
              status: source.status === 'disabled' ? 'active' : 'disabled',
            },
            params: { control_space_id: knowledgeSpaceId, source_id: source.id },
          }),
        ),
      (updatedSource) => {
        const syncWorkflow =
          updatedSource.syncWorkflow ??
          (sourceWorkflowIsActive(source.syncWorkflow) ? source.syncWorkflow : undefined)
        onSourceChange({
          ...updatedSource,
          lastSyncedAt: updatedSource.lastSyncedAt ?? source.lastSyncedAt,
          status: sourceStatusWithSyncWorkflow(updatedSource.status, syncWorkflow),
          syncWorkflow,
          syncPolicy: updatedSource.syncPolicy ?? source.syncPolicy,
        })
      },
    )

  const editSource = (values: SourceEditValues) =>
    runAction(
      'edit',
      async () =>
        sourceFromApi(
          await consoleClient.knowledgeFs.spaces.byControlSpaceId.sources.bySourceId.patch({
            body: values,
            params: { control_space_id: knowledgeSpaceId, source_id: source.id },
          }),
          { useResponseStatus: true },
        ),
      onSourceChange,
    )

  const removeSource = () =>
    runAction(
      'remove',
      async () => {
        if (source.version === undefined) throw new Error('Source version is required')
        return consoleClient.knowledgeFs.spaces.byControlSpaceId.sources.bySourceId.delete({
          body: { expectedRevision: source.version },
          headers: { 'Idempotency-Key': createIdempotencyKey() },
          params: { control_space_id: knowledgeSpaceId, source_id: source.id },
          query: { documents: 'keep' },
        })
      },
      onRemoved,
    )

  return (
    <tr
      className={cn(
        sourceTableGridClass,
        'relative rounded-lg border border-divider-subtle p-4 text-left @min-[768px]/knowledge-content:min-h-12.5 @min-[768px]/knowledge-content:rounded-none @min-[768px]/knowledge-content:border-x-0 @min-[768px]/knowledge-content:border-b-0 @min-[768px]/knowledge-content:px-0 @min-[768px]/knowledge-content:py-2',
        displayStatus === 'disabled' && '[&>td:not(:first-child)]:opacity-60',
      )}
    >
      <td className="absolute top-4 left-4 @min-[768px]/knowledge-content:static @min-[768px]/knowledge-content:row-span-2 @min-[768px]/knowledge-content:flex @min-[768px]/knowledge-content:items-center @min-[960px]/knowledge-content:row-span-1">
        <Checkbox aria-label={source.name} checked={checked} onCheckedChange={onCheckedChange} />
      </td>
      <td className="col-span-2 min-w-0 pr-8 pl-7 @min-[768px]/knowledge-content:col-span-1 @min-[768px]/knowledge-content:col-start-2 @min-[768px]/knowledge-content:row-start-1 @min-[768px]/knowledge-content:flex @min-[768px]/knowledge-content:items-center @min-[768px]/knowledge-content:p-0">
        <div className="flex min-w-0 items-center gap-2.5">
          <SourceProviderIcon className="size-4.5" fallbackIcon={sourceIcon} />
          <TruncatedSourceValue className="text-[13px] leading-4.25 font-medium text-text-primary">
            {source.name}
          </TruncatedSourceValue>
        </div>
      </td>
      <td className="min-w-0 @min-[768px]/knowledge-content:col-start-2 @min-[768px]/knowledge-content:row-start-2 @min-[960px]/knowledge-content:col-start-auto @min-[960px]/knowledge-content:row-start-auto @min-[960px]/knowledge-content:flex @min-[960px]/knowledge-content:items-center">
        <p className="mb-1 text-[11px] leading-4 font-medium tracking-[0.3px] text-text-tertiary uppercase @min-[768px]/knowledge-content:hidden">
          {t(($) => $['metadata.createMetadata.type'])}
        </p>
        <div className="min-w-0 text-xs leading-4 font-normal">
          <TruncatedSourceValue className="text-text-primary">
            {providerName ?? typeLabel}
          </TruncatedSourceValue>
          {providerName && (
            <TruncatedSourceValue className="mt-0.5 text-text-tertiary">
              {typeLabel}
            </TruncatedSourceValue>
          )}
        </div>
      </td>
      <td className="min-w-0 @min-[768px]/knowledge-content:col-start-3 @min-[768px]/knowledge-content:row-span-2 @min-[768px]/knowledge-content:row-start-1 @min-[768px]/knowledge-content:flex @min-[768px]/knowledge-content:items-center @min-[960px]/knowledge-content:col-start-auto @min-[960px]/knowledge-content:row-span-1 @min-[960px]/knowledge-content:row-start-auto">
        <p className="mb-1 text-[11px] leading-4 font-medium tracking-[0.3px] text-text-tertiary uppercase @min-[768px]/knowledge-content:hidden">
          {t(($) => $['newKnowledge.statusColumn'])}
        </p>
        <span
          role="status"
          className={cn(
            'inline-flex min-w-0 items-center gap-1.5 text-xs leading-4 font-medium text-text-primary',
            (displayStatus === 'syncing' || initializing) && 'text-text-accent',
          )}
        >
          {initializing ? (
            <span
              aria-hidden
              className="i-ri-loader-4-line size-3.5 shrink-0 animate-spin motion-reduce:animate-none"
            />
          ) : (
            <StatusDot
              status={statusDotStatus[displayStatus]}
              className={cn(
                'shrink-0',
                displayStatus === 'syncing' && 'animate-pulse motion-reduce:animate-none',
              )}
            />
          )}
          <span className="sr-only">{source.name}: </span>
          {t(($) => $[`newKnowledge.sourceStatus.${displayStatus}`])}
          {displayStatus === 'error' && syncFailureMessageKey && (
            <Infotip
              aria-label={t(($) => $[syncFailureMessageKey])}
              iconVariant="information"
              popupClassName="max-w-80"
            >
              {t(($) => $[syncFailureMessageKey])}
            </Infotip>
          )}
        </span>
      </td>
      <td className="min-w-0 @min-[768px]/knowledge-content:hidden @min-[960px]/knowledge-content:flex @min-[960px]/knowledge-content:items-center">
        <p className="mb-1 text-[11px] leading-4 font-medium tracking-[0.3px] text-text-tertiary uppercase @min-[768px]/knowledge-content:hidden">
          {t(($) => $['newKnowledge.syncPolicyColumn'])}
        </p>
        <TruncatedSourceValue className="text-xs leading-4 font-normal text-text-secondary">
          {syncPolicy ?? '—'}
        </TruncatedSourceValue>
      </td>
      <td className="min-w-0 text-xs leading-4 font-normal text-text-secondary @min-[768px]/knowledge-content:col-start-4 @min-[768px]/knowledge-content:row-span-2 @min-[768px]/knowledge-content:row-start-1 @min-[768px]/knowledge-content:flex @min-[768px]/knowledge-content:items-center @min-[960px]/knowledge-content:col-start-auto @min-[960px]/knowledge-content:row-span-1 @min-[960px]/knowledge-content:row-start-auto">
        <p className="mb-1 text-[11px] leading-4 font-medium tracking-[0.3px] text-text-tertiary uppercase @min-[768px]/knowledge-content:hidden">
          {t(($) => $['newKnowledge.lastSyncColumn'])}
        </p>
        {displayStatus === 'syncing' && syncWorkflow ? (
          <span className="inline-flex min-w-0 items-center gap-1.5 text-text-accent">
            <span
              aria-hidden
              className="i-ri-loader-4-line size-3.5 animate-spin motion-reduce:animate-none"
            />
            {t(($) => $['newKnowledge.sourceSyncProgress'], {
              completed:
                syncWorkflow.progressCompleted +
                syncWorkflow.progressFailed +
                syncWorkflow.progressSkipped,
              total: syncWorkflow.progressTotal ?? '—',
            })}
          </span>
        ) : (
          <TruncatedSourceValue>{lastSync ?? '—'}</TruncatedSourceValue>
        )}
      </td>
      <td className="absolute top-2.5 right-2.5 text-right @min-[768px]/knowledge-content:static @min-[768px]/knowledge-content:col-start-5 @min-[768px]/knowledge-content:row-span-2 @min-[768px]/knowledge-content:row-start-1 @min-[768px]/knowledge-content:flex @min-[768px]/knowledge-content:items-center @min-[960px]/knowledge-content:col-start-auto @min-[960px]/knowledge-content:row-span-1 @min-[960px]/knowledge-content:row-start-auto">
        <div className="flex items-center justify-end gap-0.5">
          {canSync && displayStatus === 'error' && (
            <Button
              className="@min-[768px]/knowledge-content:hidden @min-[1280px]/knowledge-content:inline-flex"
              size="small"
              variant="secondary"
              loading={pendingAction === 'sync'}
              disabled={Boolean(pendingAction)}
              onClick={() => void retrySource()}
            >
              {tCommon(($) => $['operation.retry'])}
            </Button>
          )}
          <SourceActions
            canEdit={canEdit && !initializing && !initialWorkflowId}
            canRemove={canEdit && !initializing && !initialImportRetrying}
            canSync={canSync && !initializing && displayStatus !== 'syncing'}
            canToggle={canEdit && !initializing && !initialWorkflowId}
            source={source}
            pendingAction={pendingAction}
            onEdit={editSource}
            onSync={displayStatus === 'error' ? retrySource : syncSource}
            onToggle={toggleSource}
            onRemove={removeSource}
            syncAction={displayStatus === 'error' ? 'retry' : 'sync'}
          />
        </div>
      </td>
    </tr>
  )
}
