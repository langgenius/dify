import type { GetAppsByAppIdConversationLogExportsPreviewData } from '@dify/contracts/api/console/apps/types.gen'
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
import { isDefinedError } from '@orpc/client'
import { skipToken, useMutation, useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import UpgradeBtn from '@/app/components/billing/upgrade-btn'
import { API_PREFIX } from '@/config'
import { consoleQuery } from '@/service/console'
import { downloadUrl } from '@/utils/download'
import { logDateRange, logIdentityFilters, TIME_PERIOD_MAPPING } from './log-filters'
import { LogIdentityPicker } from './log-identity-picker'

type LogExportFilters = NonNullable<GetAppsByAppIdConversationLogExportsPreviewData['query']>

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

export function LogExportDialog({
  appId,
  appName,
  currentFilters,
  identityOptions,
  planState,
}: {
  appId: string
  appName: string
  currentFilters: LogExportFilters
  identityOptions: LogIdentity[]
  planState: CloudSandboxPlanState
}) {
  const { t } = useTranslation(['appLog', 'common', 'time'])
  const [open, setOpen] = useState(false)
  const [scope, setScope] = useState<'current' | 'all'>('current')
  const [period, setPeriod] = useState<'9' | '2' | '3' | 'custom'>('9')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [identityMode, setIdentityMode] = useState<'all' | 'selected'>('all')
  const [identities, setIdentities] = useState<LogIdentity[]>([])
  const [taskId, setTaskId] = useState<string | null>(null)
  const attemptedDownloadRef = useRef<string | null>(null)
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

  const preview = useQuery(
    exportsApi.preview.get.queryOptions({
      input:
        open && planState === 'unrestricted' && validFilters
          ? { params: { app_id: appId }, query: filters }
          : skipToken,
      context: { silent: true },
      retry: false,
      refetchOnWindowFocus: false,
    }),
  )
  const status = useQuery(
    exportsApi.byTaskId.get.queryOptions({
      input: open && taskId ? { params: { app_id: appId, task_id: taskId } } : skipToken,
      refetchInterval: ({ state }) =>
        state.status === 'error' ||
        state.data?.status === 'ready' ||
        state.data?.status === 'failed'
          ? false
          : 1500,
      context: { silent: true },
      retry: 1,
    }),
  )
  const create = useMutation(
    exportsApi.post.mutationOptions({
      context: { silent: true },
      onSuccess: ({ task_id }) => setTaskId(task_id),
    }),
  )
  const download = useCallback(
    (id: string) => {
      downloadUrl({ url: `${API_PREFIX}/apps/${appId}/conversation-log-exports/${id}/file` })
      setTaskId(null)
      setOpen(false)
    },
    [appId],
  )

  const missingTask =
    isDefinedError(status.error) && status.error.code === 'conversation_log_export_task_not_found'
  const taskFailed = missingTask || status.data?.status === 'failed'
  const retryStatus = status.isError && !taskFailed
  const readyTaskId =
    !status.isError && !taskFailed && status.data?.status === 'ready' ? status.data.task_id : null
  useEffect(() => {
    if (open && readyTaskId && attemptedDownloadRef.current !== readyTaskId) {
      attemptedDownloadRef.current = readyTaskId
      download(readyTaskId)
    }
  }, [download, open, readyTaskId])

  const exporting =
    create.isPending || Boolean(taskId && !taskFailed && !retryStatus && !readyTaskId)
  const busy = exporting || (retryStatus && status.isFetching)
  const filtersLocked = busy || Boolean(readyTaskId) || retryStatus
  const counts = preview.data?.counts
  const noMatches = counts?.message_count === 0
  const canExport = validFilters && !preview.isPending && !noMatches
  const title = t(($) => $['export.title'], { ns: 'appLog' })
  const exportingLabel = t(($) => $['operation.exporting'], { ns: 'common' })
  const closeLabel = t(($) => $['operation.close'], { ns: 'common' })
  const identityLabel = t(($) => $['table.header.endUser'], { ns: 'appLog' })

  let actionLabel: string = t(($) => $['export.submit'], { ns: 'appLog' })
  if (exporting) actionLabel = exportingLabel
  else if (readyTaskId) actionLabel = t(($) => $['operation.download'], { ns: 'common' })
  else if (retryStatus) actionLabel = t(($) => $['operation.retry'], { ns: 'common' })

  let summary
  if (exporting) summary = actionLabel
  else if (readyTaskId) summary = t(($) => $['archives.downloadHint.ready'], { ns: 'appLog' })
  else if (preview.isPending) summary = t(($) => $['detail.loading'], { ns: 'appLog' })
  else if (counts) {
    summary = t(($) => $['export.previewSize'], {
      ns: 'appLog',
      conversations: counts.conversation_count,
      rows: counts.message_count,
    })
  } else summary = t(($) => $['export.previewUnavailable'], { ns: 'appLog' })

  let error
  if (taskFailed || create.isError) error = t(($) => $['export.failed'], { ns: 'appLog' })
  else if (retryStatus) error = t(($) => $['export.statusFailed'], { ns: 'appLog' })
  else if (!validDates) error = t(($) => $['export.dateError'], { ns: 'appLog' })
  else if (!validIdentities) error = t(($) => $['export.identityRequired'], { ns: 'appLog' })
  else if (noMatches && !filtersLocked) error = t(($) => $['export.noMatches'], { ns: 'appLog' })

  if (planState === 'pending') return null

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next && !taskId && !create.isPending) {
          setScope('current')
          setPeriod('9')
          setStartDate('')
          setEndDate('')
          setIdentityMode('all')
          setIdentities([])
          create.reset()
        }
        setOpen(next)
      }}
    >
      <DialogTrigger render={<Button size="small" variant="secondary" />}>
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
          <DialogHeaderCloseButton aria-label={closeLabel} />
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
              if (readyTaskId) {
                download(readyTaskId)
              } else if (retryStatus) {
                void status.refetch()
              } else if (canExport) {
                setTaskId(null)
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
                  onChange={setScope}
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
                      onChange={setIdentityMode}
                      disabled={filtersLocked}
                    />
                    {filterIdentities && (
                      <LogIdentityPicker
                        appId={appId}
                        options={identityOptions}
                        value={identities}
                        onChange={setIdentities}
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
                      onChange={setPeriod}
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
                            onChange={(event) => setStartDate(event.target.value)}
                          />
                        </label>
                        <label className="flex min-w-0 flex-col gap-1.5 system-sm-medium text-text-secondary">
                          {t(($) => $['picker.endDate'], { ns: 'time' })}
                          <Input
                            type="date"
                            value={endDate}
                            min={startDate || undefined}
                            onChange={(event) => setEndDate(event.target.value)}
                          />
                        </label>
                      </div>
                    )}
                  </>
                )}
              </fieldset>
              {validFilters && (
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
            </DialogBody>
            <DialogFooter>
              <DialogClose render={<Button type="button" variant="secondary" />}>
                {t(($) => $[busy ? 'operation.close' : 'operation.cancel'], { ns: 'common' })}
              </DialogClose>
              <Button
                type="submit"
                variant="primary"
                disabled={busy || (!readyTaskId && !retryStatus && !canExport)}
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
