import type { AppDetailWithSite } from '@dify/contracts/api/console/apps/types.gen'
import type { LogFilterOptions, QueryParam } from './log-filters'
import type { CloudSandboxPlanState } from '@/features/log-export/cloud-sandbox-retention'
import type { LogIdentity } from '@/features/log-export/log-identity'
import { skipToken } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { API_PREFIX } from '@/config'
import { LogExportDialog, LogExportSelect } from '@/features/log-export/dialog'
import { logIdentityLabels } from '@/features/log-export/log-identity'
import { LogIdentityField } from '@/features/log-export/log-identity-picker'
import { LogTimeRangePicker } from '@/features/log-export/log-time-range-picker'
import { logExportRequest, useLogExport } from '@/features/log-export/use-log-export'
import { consoleClient, consoleQuery } from '@/service/console'
import { toLogFilters } from './log-filters'

const exportsApi = consoleQuery.apps.byAppId.conversationLogExports

export function ConversationLogExportDialog({
  appId,
  appName,
  appMode,
  currentQueryParams,
  filterOptions,
  identityOptions,
  planState,
  timezone,
}: {
  appId: string
  appName: string
  appMode: AppDetailWithSite['mode']
  currentQueryParams: QueryParam
  filterOptions: LogFilterOptions
  identityOptions: LogIdentity[]
  planState: CloudSandboxPlanState
  timezone: string
}) {
  const { t } = useTranslation(['appLog'])
  const [selection, setSelection] = useState(currentQueryParams)
  const { period, customRange, annotation_status, identities, sort_by } = selection
  const params = { app_id: appId }
  const query = toLogFilters(
    { period, customRange, annotation_status, identities, sort_by },
    planState,
    timezone,
  )
  const { create, latest, preview, dialogState, progressState, onViewProgress } = useLogExport({
    enabled: planState === 'unrestricted',
    latestOptions: exportsApi.latest.get.queryOptions({ ...logExportRequest, input: { params } }),
    previewOptions: exportsApi.preview.get.queryOptions({
      ...logExportRequest,
      input: { params, query },
    }),
    createOptions: exportsApi.post.mutationOptions(logExportRequest),
    statusOptions: (taskId) =>
      exportsApi.byTaskId.get.queryOptions({
        ...logExportRequest,
        input: taskId ? { params: { ...params, task_id: taskId } } : skipToken,
      }),
    cancelExport: (taskId) =>
      consoleClient.apps.byAppId.conversationLogExports.byTaskId.cancel.post(
        { params: { ...params, task_id: taskId } },
        logExportRequest,
      ),
    updateEmailNotification: (taskId, enabled) =>
      consoleClient.apps.byAppId.conversationLogExports.byTaskId.put(
        { params: { ...params, task_id: taskId }, body: { enabled } },
        logExportRequest,
      ),
  })
  const fileUrl = (taskId: string) =>
    `${API_PREFIX}/apps/${appId}/conversation-log-exports/${taskId}/file`
  const task = latest?.task
  const counts = preview?.counts
  const disabled = dialogState.phase !== 'selecting'
  const completion = appMode === 'completion'
  const description = completion
    ? 'export.previewCompletionDescription'
    : appMode === 'advanced-chat'
      ? 'export.previewChatflowDescription'
      : 'export.previewConversationDescription'
  const status = task?.filters.annotation_status
  const statusLabel =
    status === 'annotated'
      ? t(($) => $['export.annotated'], { ns: 'appLog' })
      : status === 'not_annotated'
        ? t(($) => $['filter.annotation.not_annotated'], { ns: 'appLog' })
        : undefined

  return (
    <LogExportDialog
      {...dialogState}
      appName={appName}
      planState={planState}
      timezone={timezone}
      onOpenChange={(next) => {
        if (next) setSelection(currentQueryParams)
        dialogState.onOpenChange(next)
      }}
      progress={progressState && { ...progressState, fileUrl: fileUrl(progressState.taskId) }}
      counts={
        counts
          ? {
              rows: counts.message_count,
              conversations: completion ? undefined : counts.conversation_count,
            }
          : undefined
      }
      previewDescription={t(($) => $[description], { ns: 'appLog' })}
      lastExport={
        task && {
          status: task.status,
          fileUrl: fileUrl(task.task_id),
          expiresAt: task.expires_at,
          onViewProgress,
          start: task.filters.start,
          end: task.filters.end,
          keyword: task.filters.keyword,
          statusLabel,
          identities: logIdentityLabels(task.filters, task.identity_labels ?? []),
        }
      }
      onExport={() =>
        create({
          params,
          body: {
            ...query,
            estimated_rows: counts?.message_count,
            identity_labels: identities?.length ? identities : undefined,
          },
        })
      }
    >
      <LogTimeRangePicker
        value={selection}
        options={filterOptions.periods}
        onChange={(timeRange) => setSelection((previous) => ({ ...previous, ...timeRange }))}
        timezone={timezone}
        disabled={disabled}
      />
      <LogExportSelect
        label={t(($) => $['table.header.status'], { ns: 'appLog' })}
        value={annotation_status ?? 'all'}
        options={filterOptions.annotations}
        onChange={(annotation_status) =>
          setSelection((previous) => ({ ...previous, annotation_status }))
        }
        disabled={disabled || !filterOptions.hasAnnotationCount}
      />
      <LogIdentityField
        appId={appId}
        options={identityOptions}
        value={identities ?? []}
        onChange={(identities) => setSelection((previous) => ({ ...previous, identities }))}
        disabled={disabled}
        showLabel
      />
    </LogExportDialog>
  )
}
