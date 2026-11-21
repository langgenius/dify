import type {
  AgentLogExportLatestResponse,
  AgentLogExportLatestTaskResponse,
  AgentLogSourceGroupResponse,
} from '@dify/contracts/api/console/agent/types.gen'
import type {
  AppDetailWithSite,
  ConversationLogExportLatestResponse,
  ConversationLogExportLatestTaskResponse,
  GetAppsByAppIdConversationLogExportsPreviewData,
  WorkflowLogExportLatestResponse,
  WorkflowLogExportLatestTaskResponse,
} from '@dify/contracts/api/console/apps/types.gen'
import type { QueryState } from '@tanstack/react-query'
import type { ComponentProps } from 'react'
import type { WorkflowLogFilterOptions, WorkflowLogQuery } from '../workflow-log/log-filters'
import type { CloudSandboxPlanState } from './cloud-sandbox-retention'
import type { LogFilterOptions, LogIdentity, QueryParam } from './log-filters'
import type { AgentLogFilters } from '@/features/agent-v2/agent-detail/logs/log-filters'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogHeaderCloseButton,
  DialogTitle,
  DialogTrigger,
} from '@langgenius/dify-ui/dialog'
import { Input } from '@langgenius/dify-ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@langgenius/dify-ui/select'
import {
  keepPreviousData,
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import UpgradeBtn from '@/app/components/billing/upgrade-btn'
import { API_PREFIX } from '@/config'
import { AgentLogSourcePicker } from '@/features/agent-v2/agent-detail/logs/components/source-picker'
import {
  agentLogPeriods,
  defaultAgentLogFilters,
  toAgentLogQuery,
} from '@/features/agent-v2/agent-detail/logs/log-filters'
import useTimestamp from '@/hooks/use-timestamp'
import { consoleQuery } from '@/service/console'
import { downloadUrl } from '@/utils/download'
import { toWorkflowLogFilters } from '../workflow-log/log-filters'
import { logDateRange, logIdentityFilters, TIME_PERIOD_MAPPING, toLogFilters } from './log-filters'
import { LogIdentityField, LogIdentityPicker } from './log-identity-picker'

type LogExportFilters = NonNullable<GetAppsByAppIdConversationLogExportsPreviewData['query']>

type LogExportSelection = {
  scope: 'current' | 'all'
  period: '9' | '2' | '3' | 'custom'
  startDate: string
  endDate: string
  identityMode: 'all' | 'selected'
  identities: LogIdentity[]
}

const defaultSelection: LogExportSelection = {
  scope: 'current',
  period: '2',
  startDate: '',
  endDate: '',
  identityMode: 'all',
  identities: [],
}

const exportsApi = consoleQuery.apps.byAppId.conversationLogExports
const workflowExportsApi = consoleQuery.apps.byAppId.workflowLogExports
const agentExportsApi = consoleQuery.agent.byAgentId.logExports

function ExportSelect<T extends string>({
  label,
  description,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string
  description?: string
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
  disabled: boolean
}) {
  const descriptionId = useId()
  return (
    <Select
      value={value}
      items={options}
      onValueChange={(next) => next && onChange(next)}
      disabled={disabled}
    >
      <div className="flex flex-col gap-1.5">
        <SelectLabel>{label}</SelectLabel>
        <SelectTrigger aria-describedby={description ? descriptionId : undefined}>
          <SelectValue />
        </SelectTrigger>
        {description && (
          <p id={descriptionId} className="system-sm-regular text-text-tertiary">
            {description}
          </p>
        )}
      </div>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            <SelectItemText>{option.label}</SelectItemText>
            <SelectItemIndicator />
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function LastLogExport({
  fileUrl,
  task,
  identityOptions,
  sourceGroups,
}: {
  fileUrl: string
  task:
    | ConversationLogExportLatestTaskResponse
    | WorkflowLogExportLatestTaskResponse
    | AgentLogExportLatestTaskResponse
  identityOptions: LogIdentity[]
  sourceGroups?: AgentLogSourceGroupResponse[]
}) {
  const { t } = useTranslation(['appLog', 'common', 'time'])
  const { formatDate } = useTimestamp()
  const { filters, status } = task
  const title = t(($) => $['export.last'], { ns: 'appLog' })
  const identityLabel = (id: string, source: LogIdentity['source']) =>
    identityOptions.find((identity) => identity.id === id && identity.source === source)?.label ??
    id
  const identities = [
    ...filters.end_user_ids.map((id) => identityLabel(id, 'end-user')),
    ...(filters.account_ids ?? []).map((id) => identityLabel(id, 'account')),
  ]

  const workflow = 'created_at__after' in filters
  const startBound = workflow ? filters.created_at__after : filters.start
  const endBound = workflow ? filters.created_at__before : filters.end
  const start = startBound && formatDate(startBound, 'YYYY-MM-DD HH:mm')
  const end = endBound && formatDate(endBound, 'YYYY-MM-DD HH:mm')
  let range: string | undefined
  if (start && end) range = `${start} – ${end}`
  else if (start) range = `${t(($) => $['picker.startDate'], { ns: 'time' })} ${start}`
  else if (end) range = `${t(($) => $['picker.endDate'], { ns: 'time' })} ${end}`

  let statusLabel
  if (workflow) {
    const status = filters.status
    if (status) statusLabel = t(($) => $[`status.${status}`], { ns: 'appLog' })
  } else if ('annotation_status' in filters) {
    if (filters.annotation_status === 'annotated')
      statusLabel = t(($) => $['export.annotated'], { ns: 'appLog' })
    else if (filters.annotation_status === 'not_annotated')
      statusLabel = t(($) => $['filter.annotation.not_annotated'], { ns: 'appLog' })
  }

  const sourceOptions = sourceGroups?.flatMap((group) => group.sources ?? [])
  const sources =
    'sources' in filters
      ? filters.sources.map(
          (id) => sourceOptions?.find((source) => source.id === id)?.app_name ?? id,
        )
      : []

  const summary = [
    range,
    'keyword' in filters &&
      filters.keyword &&
      `${t(($) => $['operation.search'], { ns: 'common' })} “${filters.keyword}”`,
    statusLabel,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div
      role="group"
      aria-label={title}
      className="flex items-center justify-between gap-3 rounded-lg bg-background-section-burn px-3 py-2.5"
    >
      <div className="min-w-0 space-y-1">
        <p className="system-sm-medium text-text-primary">{title}</p>
        {(summary || (identities.length === 0 && sources.length === 0)) && (
          <p className="system-sm-regular wrap-anywhere text-text-secondary">
            {summary || t(($) => $['export.all'], { ns: 'appLog' })}
          </p>
        )}
        {sources.length > 0 && (
          <p className="truncate system-sm-regular text-text-secondary">{sources.join(', ')}</p>
        )}
        {identities.length > 0 && (
          <p className="truncate system-sm-regular text-text-secondary">{identities.join(', ')}</p>
        )}
        {(status === 'pending' || status === 'processing') && (
          <p role="status" className="system-sm-regular text-text-secondary">
            {t(($) => $['archives.downloadHint.preparing'], { ns: 'appLog' })}
          </p>
        )}
        {status === 'failed' && (
          <p role="alert" className="system-sm-regular text-text-destructive">
            {t(($) => $['export.failed'], { ns: 'appLog' })}
          </p>
        )}
      </div>
      {status === 'ready' && (
        <Button
          type="button"
          size="small"
          variant="secondary"
          className="shrink-0"
          onClick={() => downloadUrl({ url: fileUrl })}
        >
          {t(($) => $['operation.download'], { ns: 'common' })}
        </Button>
      )}
    </div>
  )
}

type LogExportDialogProps = {
  appName: string
  identityOptions: LogIdentity[]
  planState: CloudSandboxPlanState
} & (
  | {
      appId: string
      agent?: never
      workflow?: undefined
      appMode: AppDetailWithSite['mode']
      currentQueryParams: QueryParam
      shareFilters: boolean
      filterOptions: LogFilterOptions
    }
  | {
      appId: string
      agent?: never
      workflow: {
        currentQueryParams: WorkflowLogQuery
        filterOptions: WorkflowLogFilterOptions
        timezone?: string
      }
    }
  | {
      appId?: never
      workflow?: never
      agent: {
        id: string
        currentFilters: AgentLogFilters
        sourcePicker: Pick<
          ComponentProps<typeof AgentLogSourcePicker>,
          'groups' | 'isLoading' | 'isError' | 'onRetry'
        >
      }
    }
)

export function LogExportDialog(props: LogExportDialogProps) {
  const { appId, appName, identityOptions, planState, workflow, agent } = props
  const conversation = props.workflow || props.agent ? null : props
  const appMode = conversation?.appMode
  const shareFilters = !!agent || !!workflow || !!conversation?.shareFilters
  const filterOptions = workflow?.filterOptions ?? conversation?.filterOptions
  const { t } = useTranslation(['appLog', 'common', 'time', 'appAnnotation', 'agentV2'])
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [selection, setSelection] = useState(defaultSelection)
  const [agentSelection, setAgentSelection] = useState(defaultAgentLogFilters)
  const [sharedSelection, setSharedSelection] = useState<
    Pick<QueryParam, 'period' | 'annotation_status' | 'identities' | 'sort_by'> &
      Pick<WorkflowLogQuery, 'status'>
  >({ period: '2' })
  const { scope, period, startDate, endDate, identityMode, identities } = selection
  const isCompletion = appMode === 'completion'
  const customDates = scope === 'all' && period === 'custom'
  const filterIdentities = scope === 'all' && identityMode === 'selected'
  const validDates = !customDates || Boolean(startDate && endDate && startDate <= endDate)
  const validIdentities = !filterIdentities || identities.length > 0
  const validFilters = validDates && validIdentities

  let dates: Pick<LogExportFilters, 'start' | 'end'> = {}
  if (customDates) dates = { start: `${startDate} 00:00`, end: `${endDate} 23:59` }
  else if (scope === 'all' && period !== '9' && period !== 'custom')
    dates = logDateRange(TIME_PERIOD_MAPPING[period]!.value)
  const filters: LogExportFilters = conversation?.shareFilters
    ? toLogFilters(sharedSelection, planState)
    : scope === 'current' && conversation
      ? toLogFilters(conversation.currentQueryParams, planState)
      : {
          sort_by: '-created_at',
          ...dates,
          ...(filterIdentities ? logIdentityFilters(identities) : {}),
        }
  const workflowFilters = workflow
    ? toWorkflowLogFilters(sharedSelection, planState, workflow.timezone)
    : {}
  const agentFilters = agent ? toAgentLogQuery(agentSelection) : {}

  const canQuery = open && planState === 'unrestricted'
  const appParams = appId ? { params: { app_id: appId } } : undefined
  const agentParams = agent ? { params: { agent_id: agent.id } } : undefined
  const latestSettings = {
    staleTime: 0,
    refetchInterval: ({
      state,
    }: {
      state: Pick<
        QueryState<
          | ConversationLogExportLatestResponse
          | WorkflowLogExportLatestResponse
          | AgentLogExportLatestResponse
        >,
        'data' | 'status'
      >
    }) => {
      const phase = state.data?.task?.status
      return state.status !== 'error' && (phase === 'pending' || phase === 'processing')
        ? 1500
        : false
    },
    context: { silent: true },
    retry: 1,
  } as const
  const latestOptions = exportsApi.latest.get.queryOptions({
    ...latestSettings,
    input: appParams && conversation ? appParams : skipToken,
    enabled: canQuery && !!conversation,
  })
  const workflowLatestOptions = workflowExportsApi.latest.get.queryOptions({
    ...latestSettings,
    input: appParams && workflow ? appParams : skipToken,
    enabled: canQuery && !!workflow,
  })
  const agentLatestOptions = agentExportsApi.latest.get.queryOptions({
    ...latestSettings,
    input: agentParams ?? skipToken,
    enabled: canQuery && !!agentParams,
  })
  const conversationLatest = useQuery(latestOptions)
  const workflowLatest = useQuery(workflowLatestOptions)
  const agentLatest = useQuery(agentLatestOptions)
  const latest = agent ? agentLatest : workflow ? workflowLatest : conversationLatest
  const conversationCreate = useMutation(
    exportsApi.post.mutationOptions({
      context: { silent: true },
      onSuccess: () => queryClient.invalidateQueries({ queryKey: latestOptions.queryKey }),
    }),
  )
  const workflowCreate = useMutation(
    workflowExportsApi.post.mutationOptions({
      context: { silent: true },
      onSuccess: () => queryClient.invalidateQueries({ queryKey: workflowLatestOptions.queryKey }),
    }),
  )
  const agentCreate = useMutation(
    agentExportsApi.post.mutationOptions({
      context: { silent: true },
      onSuccess: () => queryClient.invalidateQueries({ queryKey: agentLatestOptions.queryKey }),
    }),
  )
  const create = agent ? agentCreate : workflow ? workflowCreate : conversationCreate

  const retryStatus = latest.isError
  const task = retryStatus ? null : latest.data?.task
  const taskInProgress = task?.status === 'pending' || task?.status === 'processing'
  const exporting = create.isPending || taskInProgress
  const busy = exporting || latest.isPending || (retryStatus && latest.isFetching)
  const filtersLocked = busy || retryStatus

  const canPreview = canQuery && validFilters && !filtersLocked
  const previewSettings = {
    context: { silent: true },
    retry: false,
    refetchOnWindowFocus: false,
  } as const
  const conversationPreview = useQuery({
    ...exportsApi.preview.get.queryOptions({
      ...previewSettings,
      input: canPreview && appParams && conversation ? { ...appParams, query: filters } : skipToken,
    }),
    placeholderData: keepPreviousData,
  })
  const workflowPreview = useQuery({
    ...workflowExportsApi.preview.get.queryOptions({
      ...previewSettings,
      input:
        canPreview && appParams && workflow ? { ...appParams, query: workflowFilters } : skipToken,
    }),
    placeholderData: keepPreviousData,
  })
  const agentPreview = useQuery({
    ...agentExportsApi.preview.get.queryOptions({
      ...previewSettings,
      input: canPreview && agentParams ? { ...agentParams, query: agentFilters } : skipToken,
    }),
    placeholderData: keepPreviousData,
  })
  const preview = agent ? agentPreview : workflow ? workflowPreview : conversationPreview
  const counts = conversationPreview.data?.counts
  const agentCounts = agentPreview.data?.counts
  const rowCount = agent
    ? agentCounts?.row_count
    : workflow
      ? workflowPreview.data?.row_count
      : counts?.message_count
  const previewPending = preview.isPending || preview.isPlaceholderData
  const noMatches = !previewPending && rowCount === 0
  const canExport = validFilters && !previewPending && !noMatches
  const title = t(($) => $['export.title'], { ns: 'appLog' })
  const exportingLabel = t(($) => $['operation.exporting'], { ns: 'common' })
  const closeLabel = t(($) => $['operation.close'], { ns: 'common' })
  const identityLabel = t(($) => $['table.header.endUser'], { ns: 'appLog' })

  let actionLabel: string = t(($) => $['export.submit'], { ns: 'appLog' })
  if (exporting) actionLabel = exportingLabel
  else if (retryStatus) actionLabel = t(($) => $['operation.retry'], { ns: 'common' })

  const descriptionKey = agent
    ? 'export.previewAgentDescription'
    : workflow
      ? 'export.previewWorkflowDescription'
      : isCompletion
        ? 'export.previewCompletionDescription'
        : appMode === 'advanced-chat'
          ? 'export.previewChatflowDescription'
          : 'export.previewConversationDescription'
  const previewDescription =
    !filtersLocked && !noMatches && (previewPending || rowCount != null)
      ? t(($) => $[descriptionKey], { ns: 'appLog' })
      : null
  const countSummary =
    rowCount == null
      ? null
      : agentCounts
        ? t(($) => $['export.previewAgentSize'], {
            ns: 'appLog',
            logs: agentCounts.log_count,
            rows: rowCount,
          })
        : workflow || isCompletion
          ? t(($) => $['export.previewRows'], { ns: 'appLog', rows: rowCount })
          : counts &&
            t(($) => $['export.previewSize'], {
              ns: 'appLog',
              conversations: counts.conversation_count,
              rows: rowCount,
            })

  let summary
  if (exporting) summary = actionLabel
  else if (previewPending) summary = `${t(($) => $['detail.loading'], { ns: 'appLog' })}…`
  else summary = countSummary ?? t(($) => $['export.previewUnavailable'], { ns: 'appLog' })

  let error
  if (create.isError) error = t(($) => $['export.failed'], { ns: 'appLog' })
  else if (retryStatus) error = t(($) => $['export.statusFailed'], { ns: 'appLog' })
  else if (!validDates) error = t(($) => $['export.dateError'], { ns: 'appLog' })
  else if (!validIdentities) error = t(($) => $['export.identityRequired'], { ns: 'appLog' })
  else if (noMatches && !filtersLocked) error = t(($) => $['export.noMatches'], { ns: 'appLog' })

  if (planState === 'pending') return null

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && create.isPending) return
        if (next) {
          if (agent) {
            setAgentSelection(agent.currentFilters)
          } else if (workflow) {
            const { period, status, identities } = workflow.currentQueryParams
            setSharedSelection({ period, status, identities })
          } else if (conversation?.shareFilters) {
            const { period, annotation_status, identities, sort_by } =
              conversation.currentQueryParams
            setSharedSelection({ period, annotation_status, identities, sort_by })
          } else setSelection(defaultSelection)
          create.reset()
        }
        setOpen(next)
      }}
    >
      <DialogTrigger render={<Button variant="secondary" />}>
        <span className="i-ri-download-2-line size-4" aria-hidden />
        {title}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {planState === 'sandbox' ? t(($) => $['export.upgradeTitle'], { ns: 'appLog' }) : title}
          </DialogTitle>
          <DialogDescription>
            {planState === 'sandbox'
              ? t(($) => $['export.upgradeDescription'], { ns: 'appLog' })
              : appName}
          </DialogDescription>
          <DialogHeaderCloseButton aria-label={closeLabel} disabled={create.isPending} />
        </DialogHeader>
        {planState === 'sandbox' ? (
          <DialogFooter>
            <DialogClose render={<Button variant="secondary" />}>
              {t(($) => $['operation.cancel'], { ns: 'common' })}
            </DialogClose>
            <UpgradeBtn isShort className="shrink-0" loc="logs-export" />
          </DialogFooter>
        ) : (
          <form
            className="contents"
            onSubmit={(event) => {
              event.preventDefault()
              if (busy) return
              if (retryStatus) {
                void latest.refetch()
              } else if (canExport) {
                if (agentParams) agentCreate.mutate({ ...agentParams, body: agentFilters })
                else if (appParams && workflow)
                  workflowCreate.mutate({ ...appParams, body: workflowFilters })
                else if (appParams) conversationCreate.mutate({ ...appParams, body: filters })
              }
            }}
          >
            <DialogBody className="space-y-4">
              <fieldset disabled={filtersLocked} className="space-y-4">
                {agent && (
                  <>
                    <ExportSelect
                      label={t(($) => $['export.timeRange'], { ns: 'appLog' })}
                      value={agentSelection.period}
                      options={agentLogPeriods.map((period) => ({
                        value: period,
                        label: t(($) => $[`agentDetail.logs.filters.period.${period}`], {
                          ns: 'agentV2',
                        }),
                      }))}
                      onChange={(period) =>
                        setAgentSelection((previous) => ({ ...previous, period }))
                      }
                      disabled={filtersLocked}
                    />
                    <AgentLogSourcePicker
                      {...agent.sourcePicker}
                      value={agentSelection.sources}
                      onChange={(sources) =>
                        setAgentSelection((previous) => ({ ...previous, sources }))
                      }
                      disabled={filtersLocked}
                      showLabel
                    />
                    <LogIdentityField
                      agentId={agent.id}
                      options={identityOptions}
                      value={agentSelection.identities}
                      onChange={(identities) =>
                        setAgentSelection((previous) => ({ ...previous, identities }))
                      }
                      disabled={filtersLocked}
                      showLabel
                    />
                  </>
                )}
                {shareFilters && filterOptions && appId && (
                  <>
                    <ExportSelect
                      label={t(($) => $['export.timeRange'], { ns: 'appLog' })}
                      value={sharedSelection.period}
                      options={filterOptions.periods}
                      onChange={(period) =>
                        setSharedSelection((previous) => ({ ...previous, period }))
                      }
                      disabled={filtersLocked}
                    />
                    {workflow ? (
                      <ExportSelect
                        label={t(($) => $['table.header.status'], { ns: 'appLog' })}
                        value={sharedSelection.status ?? 'all'}
                        options={workflow.filterOptions.statuses}
                        onChange={(status) =>
                          setSharedSelection((previous) => ({ ...previous, status }))
                        }
                        disabled={filtersLocked}
                      />
                    ) : (
                      conversation && (
                        <ExportSelect
                          label={t(($) => $.title, { ns: 'appAnnotation' })}
                          value={sharedSelection.annotation_status ?? 'all'}
                          options={conversation.filterOptions.annotations}
                          onChange={(annotation_status) =>
                            setSharedSelection((previous) => ({ ...previous, annotation_status }))
                          }
                          disabled={filtersLocked || !conversation.filterOptions.hasAnnotationCount}
                        />
                      )
                    )}
                    <LogIdentityField
                      appId={appId}
                      options={identityOptions}
                      value={sharedSelection.identities ?? []}
                      onChange={(identities) =>
                        setSharedSelection((previous) => ({ ...previous, identities }))
                      }
                      disabled={filtersLocked}
                      workflow={!!workflow}
                      showLabel
                    />
                  </>
                )}
                {!shareFilters && (
                  <ExportSelect
                    label={t(($) => $['export.scope'], { ns: 'appLog' })}
                    description={t(
                      ($) => $[scope === 'current' ? 'export.currentHint' : 'export.allHint'],
                      {
                        ns: 'appLog',
                      },
                    )}
                    value={scope}
                    options={[
                      { value: 'current', label: t(($) => $['export.current'], { ns: 'appLog' }) },
                      { value: 'all', label: t(($) => $['export.all'], { ns: 'appLog' }) },
                    ]}
                    onChange={(scope) => setSelection((previous) => ({ ...previous, scope }))}
                    disabled={filtersLocked}
                  />
                )}
                {!shareFilters && appId && scope === 'all' && (
                  <>
                    <ExportSelect
                      label={identityLabel}
                      value={identityMode}
                      options={[
                        {
                          value: 'all',
                          label: t(($) => $['export.identitiesAll'], { ns: 'appLog' }),
                        },
                        {
                          value: 'selected',
                          label: t(($) => $['export.identitiesSelected'], { ns: 'appLog' }),
                        },
                      ]}
                      onChange={(identityMode) =>
                        setSelection((previous) => ({ ...previous, identityMode }))
                      }
                      disabled={filtersLocked}
                    />
                    {filterIdentities && (
                      <LogIdentityPicker
                        appId={appId}
                        options={identityOptions}
                        value={identities}
                        onChange={(identities) =>
                          setSelection((previous) => ({ ...previous, identities }))
                        }
                        disabled={filtersLocked}
                      />
                    )}
                    <ExportSelect
                      label={t(($) => $['export.timeRange'], { ns: 'appLog' })}
                      value={period}
                      options={(['9', '2', '3', 'custom'] as const).map((value) => ({
                        value,
                        label: t(
                          ($) =>
                            $[
                              `filter.period.${value === 'custom' ? 'custom' : TIME_PERIOD_MAPPING[value]!.name}`
                            ],
                          { ns: 'appLog' },
                        ),
                      }))}
                      onChange={(period) => setSelection((previous) => ({ ...previous, period }))}
                      disabled={filtersLocked}
                    />
                    {customDates && (
                      <div className="grid grid-cols-2 gap-2">
                        <label className="flex min-w-0 flex-col gap-1.5 system-sm-medium text-text-secondary">
                          {t(($) => $['picker.startDate'], { ns: 'time' })}
                          <Input
                            type="date"
                            value={startDate}
                            max={endDate || undefined}
                            onChange={({ target: { value: startDate } }) =>
                              setSelection((previous) => ({ ...previous, startDate }))
                            }
                          />
                        </label>
                        <label className="flex min-w-0 flex-col gap-1.5 system-sm-medium text-text-secondary">
                          {t(($) => $['picker.endDate'], { ns: 'time' })}
                          <Input
                            type="date"
                            value={endDate}
                            min={startDate || undefined}
                            onChange={({ target: { value: endDate } }) =>
                              setSelection((previous) => ({ ...previous, endDate }))
                            }
                          />
                        </label>
                      </div>
                    )}
                  </>
                )}
              </fieldset>
              {!taskInProgress && (busy || (validFilters && !retryStatus)) && (
                <div className="grid rounded-lg bg-background-section-burn px-3 py-2.5 system-sm-regular text-text-secondary">
                  {preview.isPlaceholderData && countSummary && previewDescription && (
                    <p aria-hidden className="invisible col-start-1 row-start-1">
                      {countSummary} {previewDescription}
                    </p>
                  )}
                  <p className="col-start-1 row-start-1">
                    <span role="status">{summary}</span>
                    {previewDescription && (
                      <>
                        {' '}
                        <span>{previewDescription}</span>
                      </>
                    )}
                  </p>
                </div>
              )}
              {error && (
                <p role="alert" className="system-sm-regular text-text-destructive">
                  {error}
                </p>
              )}
              {task && (
                <LastLogExport
                  fileUrl={
                    agent
                      ? `${API_PREFIX}/agent/${agent.id}/log-exports/${task.task_id}/file`
                      : `${API_PREFIX}/apps/${appId}/${workflow ? 'workflow' : 'conversation'}-log-exports/${task.task_id}/file`
                  }
                  task={task}
                  identityOptions={
                    agent ? [...agentSelection.identities, ...identityOptions] : identityOptions
                  }
                  sourceGroups={agent?.sourcePicker.groups}
                />
              )}
            </DialogBody>
            <DialogFooter>
              <DialogClose
                disabled={create.isPending}
                render={<Button type="button" variant="secondary" />}
              >
                {t(($) => $[busy ? 'operation.close' : 'operation.cancel'], { ns: 'common' })}
              </DialogClose>
              <Button
                type="submit"
                variant="primary"
                disabled={busy || (!retryStatus && !canExport)}
                loading={busy}
              >
                {actionLabel}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
