import type { ComponentProps } from 'react'
import type { AgentLogFilters } from './log-filters'
import type { LogIdentity } from '@/features/log-export/log-identity'
import { skipToken, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { API_PREFIX } from '@/config'
import { useCloudSandboxPlanStatus } from '@/features/log-export/cloud-sandbox-retention'
import { LogExportDialog } from '@/features/log-export/dialog'
import { logIdentityLabels } from '@/features/log-export/log-identity'
import { LogIdentityField } from '@/features/log-export/log-identity-picker'
import { LogTimeRangePicker } from '@/features/log-export/log-time-range-picker'
import { logExportRequest, useLogExport } from '@/features/log-export/use-log-export'
import { consoleClient, consoleQuery } from '@/service/console'
import { AgentLogSourcePicker } from './components/source-picker'
import { agentLogPeriods, toAgentLogQuery } from './log-filters'

const exportsApi = consoleQuery.agent.byAgentId.logExports

export function AgentLogExportDialog({
  agentId,
  currentFilters,
  sourcePicker,
  identityOptions,
  timezone,
}: {
  agentId: string
  currentFilters: AgentLogFilters
  sourcePicker: Pick<
    ComponentProps<typeof AgentLogSourcePicker>,
    'groups' | 'isLoading' | 'isError' | 'onRetry'
  >
  identityOptions: LogIdentity[]
  timezone: string
}) {
  const { t } = useTranslation(['appLog', 'agentV2'])
  const [selection, setSelection] = useState(currentFilters)
  const planState = useCloudSandboxPlanStatus()
  const params = { agent_id: agentId }
  const { data: name } = useQuery(
    consoleQuery.agent.byAgentId.get.queryOptions({
      input: { params },
      select: (agent) => agent.name,
    }),
  )
  const query = toAgentLogQuery(selection, timezone)
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
      consoleClient.agent.byAgentId.logExports.byTaskId.cancel.post(
        { params: { ...params, task_id: taskId } },
        logExportRequest,
      ),
    updateEmailNotification: (taskId, enabled) =>
      consoleClient.agent.byAgentId.logExports.byTaskId.put(
        { params: { ...params, task_id: taskId }, body: { enabled } },
        logExportRequest,
      ),
  })
  const fileUrl = (taskId: string) => `${API_PREFIX}/agent/${agentId}/log-exports/${taskId}/file`
  const task = latest?.task
  const counts = preview?.counts
  const disabled = dialogState.phase !== 'selecting'
  if (!name) return null
  const sourceOptions = sourcePicker.groups.flatMap((group) => group.sources ?? [])

  return (
    <LogExportDialog
      {...dialogState}
      appName={name}
      planState={planState}
      timezone={timezone}
      onOpenChange={(next) => {
        if (next) setSelection(currentFilters)
        dialogState.onOpenChange(next)
      }}
      progress={progressState && { ...progressState, fileUrl: fileUrl(progressState.taskId) }}
      counts={counts ? { rows: counts.row_count, logs: counts.log_count } : undefined}
      previewDescription={t(($) => $['export.previewAgentDescription'], { ns: 'appLog' })}
      lastExport={
        task && {
          status: task.status,
          fileUrl: fileUrl(task.task_id),
          expiresAt: task.expires_at,
          onViewProgress,
          start: task.filters.start,
          end: task.filters.end,
          sources: task.filters.sources.map(
            (id) => sourceOptions.find((source) => source.id === id)?.app_name ?? id,
          ),
          identities: logIdentityLabels(task.filters, task.identity_labels ?? []),
        }
      }
      onExport={() =>
        create({
          params,
          body: {
            ...query,
            estimated_rows: counts?.row_count,
            identity_labels: selection.identities.length ? selection.identities : undefined,
          },
        })
      }
    >
      <LogTimeRangePicker
        value={selection}
        options={agentLogPeriods.map((period) => ({
          value: period,
          label: t(($) => $[`agentDetail.logs.filters.period.${period}`], { ns: 'agentV2' }),
        }))}
        timezone={timezone}
        onChange={({ period, customRange }) =>
          setSelection((previous) => ({ ...previous, period, customRange }))
        }
        disabled={disabled}
      />
      <AgentLogSourcePicker
        {...sourcePicker}
        value={selection.sources}
        onChange={(sources) => setSelection((previous) => ({ ...previous, sources }))}
        disabled={disabled}
        showLabel
      />
      <LogIdentityField
        agentId={agentId}
        options={identityOptions}
        value={selection.identities}
        onChange={(identities) => setSelection((previous) => ({ ...previous, identities }))}
        disabled={disabled}
        showLabel
      />
    </LogExportDialog>
  )
}
