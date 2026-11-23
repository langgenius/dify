import type { AppDetailWithSite } from '@dify/contracts/api/console/apps/types.gen'
import type { LogFilterOptions, QueryParam } from './log-filters'
import type { CloudSandboxPlanState } from '@/features/log-export/cloud-sandbox-retention'
import type { LogIdentity } from '@/features/log-export/log-identity'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { API_PREFIX } from '@/config'
import { LogExportDialog, LogExportSelect } from '@/features/log-export/dialog'
import { logIdentityLabels } from '@/features/log-export/log-identity'
import { LogIdentityField } from '@/features/log-export/log-identity-picker'
import { logExportRequest, useLogExport } from '@/features/log-export/use-log-export'
import { consoleQuery } from '@/service/console'
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
  const { t } = useTranslation(['appLog', 'appAnnotation'])
  const [open, setOpen] = useState(false)
  const [selection, setSelection] = useState(currentQueryParams)
  const { period, annotation_status, identities, sort_by } = selection
  const params = { app_id: appId }
  const query = toLogFilters(
    { period, annotation_status, identities, sort_by },
    planState,
    timezone,
  )
  const { create, reset, latest, preview, dialogState } = useLogExport({
    enabled: open && planState === 'unrestricted',
    latestOptions: exportsApi.latest.get.queryOptions({ ...logExportRequest, input: { params } }),
    previewOptions: exportsApi.preview.get.queryOptions({
      ...logExportRequest,
      input: { params, query },
    }),
    createOptions: exportsApi.post.mutationOptions(logExportRequest),
  })
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
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setSelection(currentQueryParams)
          reset()
        }
        setOpen(next)
      }}
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
          fileUrl: `${API_PREFIX}/apps/${appId}/conversation-log-exports/${task.task_id}/file`,
          start: task.filters.start,
          end: task.filters.end,
          keyword: task.filters.keyword,
          statusLabel,
          identities: logIdentityLabels(task.filters, identityOptions),
        }
      }
      onExport={() => create({ params, body: query })}
    >
      <LogExportSelect
        label={t(($) => $['export.timeRange'], { ns: 'appLog' })}
        value={period}
        options={filterOptions.periods}
        onChange={(period) => setSelection((previous) => ({ ...previous, period }))}
        disabled={disabled}
      />
      <LogExportSelect
        label={t(($) => $.title, { ns: 'appAnnotation' })}
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
