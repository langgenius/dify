import type { WorkflowLogFilterOptions, WorkflowLogQuery } from './log-filters'
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
import { toWorkflowLogFilters } from './log-filters'

const exportsApi = consoleQuery.apps.byAppId.workflowLogExports

export function WorkflowLogExportDialog({
  appId,
  appName,
  currentQueryParams,
  filterOptions,
  identityOptions,
  planState,
  timezone,
}: {
  appId: string
  appName: string
  currentQueryParams: WorkflowLogQuery
  filterOptions: WorkflowLogFilterOptions
  identityOptions: LogIdentity[]
  planState: CloudSandboxPlanState
  timezone: string
}) {
  const { t } = useTranslation(['appLog'])
  const [open, setOpen] = useState(false)
  const [selection, setSelection] = useState(currentQueryParams)
  const { period, status, identities } = selection
  const params = { app_id: appId }
  const query = toWorkflowLogFilters({ period, status, identities }, planState, timezone)
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
  const disabled = dialogState.phase !== 'selecting'
  const latestStatus = task?.filters.status

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
      counts={preview?.row_count != null ? { rows: preview.row_count } : undefined}
      previewDescription={t(($) => $['export.previewWorkflowDescription'], { ns: 'appLog' })}
      lastExport={
        task && {
          status: task.status,
          fileUrl: `${API_PREFIX}/apps/${appId}/workflow-log-exports/${task.task_id}/file`,
          start: task.filters.created_at__after,
          end: task.filters.created_at__before,
          keyword: task.filters.keyword,
          statusLabel: latestStatus
            ? t(($) => $[`status.${latestStatus}`], { ns: 'appLog' })
            : undefined,
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
        label={t(($) => $['table.header.status'], { ns: 'appLog' })}
        value={status ?? 'all'}
        options={filterOptions.statuses}
        onChange={(status) => setSelection((previous) => ({ ...previous, status }))}
        disabled={disabled}
      />
      <LogIdentityField
        appId={appId}
        options={identityOptions}
        value={identities ?? []}
        onChange={(identities) => setSelection((previous) => ({ ...previous, identities }))}
        disabled={disabled}
        workflow
        showLabel
      />
    </LogExportDialog>
  )
}
