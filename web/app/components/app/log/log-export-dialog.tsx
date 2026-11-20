import type {
  ConversationLogExportLatestTaskResponse,
  GetAppsByAppIdConversationLogExportsPreviewData,
} from '@dify/contracts/api/console/apps/types.gen'
import type { CloudSandboxPlanState } from './cloud-sandbox-retention'
import type { LogIdentity } from './log-filters'
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
import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import UpgradeBtn from '@/app/components/billing/upgrade-btn'
import { API_PREFIX } from '@/config'
import useTimestamp from '@/hooks/use-timestamp'
import { consoleQuery } from '@/service/console'
import { downloadUrl } from '@/utils/download'
import { logDateRange, logIdentityFilters, TIME_PERIOD_MAPPING } from './log-filters'
import { LogIdentityPicker } from './log-identity-picker'

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

function ExportSelect<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
  disabled: boolean
}) {
  return (
    <Select
      value={value}
      items={options}
      onValueChange={(next) => next && onChange(next)}
      disabled={disabled}
    >
      <div className="flex flex-col gap-1.5">
        <SelectLabel>{label}</SelectLabel>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
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
  appId,
  task,
  identityOptions,
}: {
  appId: string
  task: ConversationLogExportLatestTaskResponse
  identityOptions: LogIdentity[]
}) {
  const { t } = useTranslation(['appLog', 'common', 'time'])
  const { formatDate } = useTimestamp()
  const { filters, status, task_id: taskId } = task
  const title = t(($) => $['export.last'], { ns: 'appLog' })
  const identityLabel = (id: string, source: LogIdentity['source']) =>
    identityOptions.find((identity) => identity.id === id && identity.source === source)?.label ??
    id
  const identities = [
    ...filters.end_user_ids.map((id) => identityLabel(id, 'end-user')),
    ...filters.account_ids.map((id) => identityLabel(id, 'account')),
  ]

  const start = filters.start && formatDate(filters.start, 'YYYY-MM-DD HH:mm')
  const end = filters.end && formatDate(filters.end, 'YYYY-MM-DD HH:mm')
  let range: string | undefined
  if (start && end) range = `${start} – ${end}`
  else if (start) range = `${t(($) => $['picker.startDate'], { ns: 'time' })} ${start}`
  else if (end) range = `${t(($) => $['picker.endDate'], { ns: 'time' })} ${end}`

  const summary = [
    range,
    filters.keyword && `${t(($) => $['operation.search'], { ns: 'common' })} “${filters.keyword}”`,
    filters.annotation_status === 'annotated' && t(($) => $['export.annotated'], { ns: 'appLog' }),
    filters.annotation_status === 'not_annotated' &&
      t(($) => $['filter.annotation.not_annotated'], { ns: 'appLog' }),
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
        {(summary || identities.length === 0) && (
          <p className="system-sm-regular wrap-anywhere text-text-secondary">
            {summary || t(($) => $['export.all'], { ns: 'appLog' })}
          </p>
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
          onClick={() =>
            downloadUrl({
              url: `${API_PREFIX}/apps/${appId}/conversation-log-exports/${taskId}/file`,
            })
          }
        >
          {t(($) => $['operation.download'], { ns: 'common' })}
        </Button>
      )}
    </div>
  )
}

export function LogExportDialog({
  appId,
  appName,
  isCompletion,
  currentFilters,
  identityOptions,
  planState,
}: {
  appId: string
  appName: string
  isCompletion: boolean
  currentFilters: LogExportFilters
  identityOptions: LogIdentity[]
  planState: CloudSandboxPlanState
}) {
  const { t } = useTranslation(['appLog', 'common', 'time'])
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [selection, setSelection] = useState(defaultSelection)
  const { scope, period, startDate, endDate, identityMode, identities } = selection
  const customDates = scope === 'all' && period === 'custom'
  const filterIdentities = scope === 'all' && identityMode === 'selected'
  const validDates = !customDates || Boolean(startDate && endDate && startDate <= endDate)
  const validIdentities = !filterIdentities || identities.length > 0
  const validFilters = validDates && validIdentities

  let dates: Pick<LogExportFilters, 'start' | 'end'> = {}
  if (customDates) dates = { start: `${startDate} 00:00`, end: `${endDate} 23:59` }
  else if (scope === 'all' && period !== '9' && period !== 'custom')
    dates = logDateRange(TIME_PERIOD_MAPPING[period]!.value)
  const filters: LogExportFilters =
    scope === 'current'
      ? currentFilters
      : {
          sort_by: '-created_at',
          ...dates,
          ...(filterIdentities ? logIdentityFilters(identities) : {}),
        }

  const latestOptions = exportsApi.latest.get.queryOptions({
    input: { params: { app_id: appId } },
    enabled: open && planState === 'unrestricted',
    staleTime: 0,
    refetchInterval: ({ state }) => {
      const phase = state.data?.task?.status
      return state.status !== 'error' && (phase === 'pending' || phase === 'processing')
        ? 1500
        : false
    },
    context: { silent: true },
    retry: 1,
  })
  const latest = useQuery(latestOptions)
  const create = useMutation(
    exportsApi.post.mutationOptions({
      context: { silent: true },
      onSuccess: () => queryClient.invalidateQueries({ queryKey: latestOptions.queryKey }),
    }),
  )

  const retryStatus = latest.isError
  const task = retryStatus ? null : latest.data?.task
  const taskInProgress = task?.status === 'pending' || task?.status === 'processing'
  const exporting = create.isPending || taskInProgress
  const busy = exporting || latest.isPending || (retryStatus && latest.isFetching)
  const filtersLocked = busy || retryStatus

  const preview = useQuery(
    exportsApi.preview.get.queryOptions({
      input:
        open && planState === 'unrestricted' && validFilters && !filtersLocked
          ? { params: { app_id: appId }, query: filters }
          : skipToken,
      context: { silent: true },
      retry: false,
      refetchOnWindowFocus: false,
    }),
  )
  const counts = preview.data?.counts
  const noMatches = counts?.message_count === 0
  const canExport = validFilters && !preview.isPending && !noMatches
  const title = t(($) => $['export.title'], { ns: 'appLog' })
  const exportingLabel = t(($) => $['operation.exporting'], { ns: 'common' })
  const closeLabel = t(($) => $['operation.close'], { ns: 'common' })
  const identityLabel = t(($) => $['table.header.endUser'], { ns: 'appLog' })

  let actionLabel: string = t(($) => $['export.submit'], { ns: 'appLog' })
  if (exporting) actionLabel = exportingLabel
  else if (retryStatus) actionLabel = t(($) => $['operation.retry'], { ns: 'common' })

  let summary
  if (exporting) summary = actionLabel
  else if (preview.isPending) summary = t(($) => $['detail.loading'], { ns: 'appLog' })
  else if (counts) {
    summary = isCompletion
      ? t(($) => $['export.previewRows'], { ns: 'appLog', rows: counts.message_count })
      : t(($) => $['export.previewSize'], {
          ns: 'appLog',
          conversations: counts.conversation_count,
          rows: counts.message_count,
        })
  } else summary = t(($) => $['export.previewUnavailable'], { ns: 'appLog' })

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
          setSelection(defaultSelection)
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
                create.mutate({ params: { app_id: appId }, body: filters })
              }
            }}
          >
            <DialogBody className="space-y-4">
              <fieldset disabled={filtersLocked} className="space-y-4">
                <ExportSelect
                  label={t(($) => $['export.scope'], { ns: 'appLog' })}
                  value={scope}
                  options={[
                    { value: 'current', label: t(($) => $['export.current'], { ns: 'appLog' }) },
                    { value: 'all', label: t(($) => $['export.all'], { ns: 'appLog' }) },
                  ]}
                  onChange={(scope) => setSelection((previous) => ({ ...previous, scope }))}
                  disabled={filtersLocked}
                />
                {scope === 'all' && (
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
                <p
                  role="status"
                  className="rounded-lg bg-background-section-burn px-3 py-2.5 system-sm-regular text-text-secondary"
                >
                  {summary}
                </p>
              )}
              {error && (
                <p role="alert" className="system-sm-regular text-text-destructive">
                  {error}
                </p>
              )}
              {task && (
                <LastLogExport appId={appId} task={task} identityOptions={identityOptions} />
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
