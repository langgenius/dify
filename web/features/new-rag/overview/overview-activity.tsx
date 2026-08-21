'use client'

import type { KnowledgeFsOverviewActivityResponse } from '@dify/contracts/api/console/knowledge-fs/types.gen'
import type { ActivityDateRange, ActivityOperator, ActivityRange } from './overview-activity-types'
import type { DatePickerProps } from '@/app/components/base/date-and-time-picker/types'
import type { Member } from '@/models/common'
import { Avatar } from '@langgenius/dify-ui/avatar'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Drawer,
  DrawerBackdrop,
  DrawerCloseButton,
  DrawerContent,
  DrawerPopup,
  DrawerPortal,
  DrawerTitle,
  DrawerViewport,
} from '@langgenius/dify-ui/drawer'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectTrigger,
} from '@langgenius/dify-ui/select'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import DatePicker from '@/app/components/base/date-and-time-picker/date-picker'
import { consoleQuery } from '@/service/client'
import { useMembers } from '@/service/use-common'
import { activityDatesForRange } from './overview-activity-types'
import { OVERVIEW_REFRESH_INTERVAL } from './overview-format'
import { EmptyInline, Panel, Skeleton } from './overview-panel'

const ACTIVITY_RANGES: ActivityRange[] = ['today', '7d', '30d', '90d', 'all', 'custom']
const ACTIVITY_PAGE_SIZE = 20

function activityOperationLabel(
  activity: KnowledgeFsOverviewActivityResponse,
  t: ReturnType<typeof useTranslation<'dataset'>>['t'],
) {
  if (activity.action.startsWith('source.'))
    return t(($) => $['newKnowledge.overview.operation.source_sync'])
  if (activity.action.startsWith('document.'))
    return t(($) => $['newKnowledge.overview.operation.document_processing'])
  if (activity.action.startsWith('query.'))
    return t(($) => $['newKnowledge.overview.queryOutcomes'])
  if (activity.action === 'permission.updated') return t(($) => $['newKnowledge.permission'])
  if (activity.action === 'settings.updated')
    return t(($) => $['newKnowledge.overview.updateEvidence'])
  return t(($) => $['newKnowledge.backgroundTasks'])
}

function activityLabel(
  activity: KnowledgeFsOverviewActivityResponse,
  t: ReturnType<typeof useTranslation<'dataset'>>['t'],
) {
  if (activity.action === 'query.requested') {
    const question = activity.details.question
    const mode = activity.details.mode
    const label =
      typeof question === 'string' && question.trim()
        ? `${t(($) => $['newKnowledge.qualityPage.question'])}: ${question}`
        : activityOperationLabel(activity, t)
    return typeof mode === 'string' && mode.trim() ? `${label} — ${mode}` : label
  }

  const operation = activityOperationLabel(activity, t)
  let label: string
  if (activity.result === 'success')
    label = t(($) => $['newKnowledge.overview.activityCompleted'], { operation })
  else if (activity.result === 'failure')
    label = t(($) => $['newKnowledge.overview.activityFailed'], { operation })
  else if (activity.result === 'canceled')
    label = t(($) => $['newKnowledge.overview.activityCanceled'], { operation })
  else label = t(($) => $['newKnowledge.overview.activityRunning'], { operation })

  const detail = [
    activity.details.reasonCode,
    activity.details.statusCode,
    activity.details.documentType,
    activity.details.providerId,
    activity.details.mode,
  ].find((value): value is string => typeof value === 'string' && Boolean(value.trim()))
  if (!detail) return label

  const readableDetail = /^[A-Z0-9_]+$/.test(detail)
    ? detail
        .toLocaleLowerCase()
        .replaceAll('_', ' ')
        .replace(/^./, (character) => character.toLocaleUpperCase())
    : detail
  return `${label} — ${readableDetail}`
}

function compactIdentifier(value: string) {
  const normalized = value.replace(/^dify-account:/, '')
  return normalized.length > 16 ? `${normalized.slice(0, 8)}…${normalized.slice(-4)}` : normalized
}

function activityActor(
  activity: KnowledgeFsOverviewActivityResponse,
  members: Member[],
  systemLabel: string,
) {
  if (activity.actor.type === 'system') return { avatar: null, name: systemLabel, system: true }

  const accountId = activity.actor.id?.replace(/^dify-account:/, '')
  const member = members.find((candidate) => candidate.id === accountId)
  return {
    avatar: member?.avatar_url ?? null,
    name: member?.name || compactIdentifier(activity.actor.id || systemLabel),
    system: false,
  }
}

function ActivityActor({
  activity,
  members,
  showName = true,
  size = 'xxs',
}: {
  activity: KnowledgeFsOverviewActivityResponse
  members: Member[]
  showName?: boolean
  size?: 'xxs' | 'xs'
}) {
  const { t } = useTranslation('dataset')
  const actor = activityActor(
    activity,
    members,
    t(($) => $['newKnowledge.overview.system']),
  )

  return (
    <>
      {actor.system ? (
        <span className="system-2xs-semibold flex size-5 shrink-0 items-center justify-center rounded-full bg-util-colors-gray-gray-300 text-text-secondary">
          S
        </span>
      ) : (
        <Avatar avatar={actor.avatar} name={actor.name} size={size} />
      )}
      {showName && <span className="truncate text-text-secondary">{actor.name}</span>}
    </>
  )
}

function RecentActivity({
  activities,
  empty,
  error,
  indexing = false,
  loading,
  members,
  onOpenAll,
  onRetry,
  retrying,
}: {
  activities: KnowledgeFsOverviewActivityResponse[]
  empty: boolean
  error: boolean
  indexing?: boolean
  loading: boolean
  onOpenAll: () => void
  onRetry: () => void
  retrying: boolean
  members: Member[]
}) {
  const { t, i18n } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const formatWhen = (value: string) => {
    const timestamp = new Date(value)
    const elapsedMinutes = Math.max(0, Math.floor((Date.now() - timestamp.getTime()) / 60_000))
    const relativeTime = new Intl.RelativeTimeFormat(i18n.language, { numeric: 'auto' })
    if (elapsedMinutes < 60) return relativeTime.format(-elapsedMinutes, 'minute')
    const elapsedHours = Math.floor(elapsedMinutes / 60)
    if (elapsedHours < 24) return relativeTime.format(-elapsedHours, 'hour')
    const elapsedDays = Math.floor(elapsedHours / 24)
    if (elapsedDays < 7) return relativeTime.format(-elapsedDays, 'day')
    return new Intl.DateTimeFormat(i18n.language, { day: 'numeric', month: 'short' }).format(
      timestamp,
    )
  }

  if (error)
    return (
      <section className="flex min-w-0 flex-col gap-2 pt-6">
        <h2 className="system-md-medium text-text-secondary">
          {t(($) => $['newKnowledge.overview.recentActivity'])}
        </h2>
        <Panel className="flex h-50 border border-components-panel-border p-4 shadow-none">
          <div
            role="alert"
            className="flex min-h-0 flex-1 flex-col items-center justify-center text-center"
          >
            <span aria-hidden className="i-ri-error-warning-line size-6 text-text-tertiary" />
            <p className="mt-3 body-sm-regular text-text-tertiary">
              {t(($) => $['newKnowledge.tasksErrorDescription'])}
            </p>
            <Button
              className="mt-4"
              loading={retrying}
              size="small"
              variant="secondary"
              onClick={onRetry}
            >
              {tCommon(($) => $['operation.retry'])}
            </Button>
          </div>
        </Panel>
      </section>
    )

  if (empty)
    return (
      <section className={cn('flex min-w-0 flex-col gap-2 pt-6', indexing ? 'h-67.75' : 'h-63')}>
        <h2 className="text-[15px] leading-6 font-medium text-text-secondary">
          {t(($) => $['newKnowledge.overview.recentActivity'])}
        </h2>
        <Panel
          className={cn(
            'flex border border-components-panel-border p-4 shadow-none',
            indexing ? 'h-53.75' : 'h-50',
          )}
        >
          <EmptyInline
            icon="i-ri-time-line"
            title={
              indexing
                ? t(($) => $['newKnowledge.overview.syncInProgress'])
                : t(($) => $['newKnowledge.overview.noActivity'])
            }
            description={
              indexing
                ? t(($) => $['newKnowledge.overview.syncInProgressDescription'])
                : t(($) => $['newKnowledge.overview.noActivityDescription'])
            }
          />
        </Panel>
      </section>
    )

  return (
    <section className="flex min-w-0 flex-col gap-2 pt-6">
      <header className="flex h-6 items-center justify-between">
        <h2 className="text-[15px] leading-6 font-medium text-text-secondary">
          {t(($) => $['newKnowledge.overview.recentActivity'])}
        </h2>
        <Button size="small" variant="secondary" onClick={onOpenAll}>
          {t(($) => $['newKnowledge.overview.allActivity'])}
        </Button>
      </header>
      <Panel className="flex h-63.5 flex-col overflow-hidden border border-divider-subtle px-4 pt-4 pb-3 shadow-none">
        {loading || activities.length ? (
          <div
            role="table"
            aria-label={t(($) => $['newKnowledge.overview.recentActivity'])}
            className="min-w-151"
          >
            <div
              role="row"
              className="grid grid-cols-[100px_minmax(280px,1fr)_200px] items-center gap-3 pb-2 system-2xs-medium-uppercase text-text-tertiary"
            >
              <span role="columnheader">
                <span className="sr-only">{t(($) => $['newKnowledge.overview.when'])}</span>
              </span>
              <span role="columnheader">{t(($) => $['newKnowledge.overview.activity'])}</span>
              <span role="columnheader">{t(($) => $['newKnowledge.overview.operator'])}</span>
            </div>
            <div className="h-px bg-divider-subtle" />
            {loading
              ? [
                  ['activity-1', 55],
                  ['activity-2', 55],
                  ['activity-3', 55],
                  ['activity-4', 55],
                  ['activity-5', 41],
                ].map(([key, width]) => (
                  <div key={key} role="row" className="flex h-9 items-center py-2">
                    <Skeleton className="h-3.5" style={{ width: `${width}%` }} />
                  </div>
                ))
              : activities.slice(0, 5).map((activity) => (
                  <div
                    key={activity.id}
                    role="row"
                    className="-mx-3 grid h-9 grid-cols-[100px_minmax(280px,1fr)_200px] items-center gap-3 rounded-lg px-3 system-xs-regular transition-colors hover:bg-state-base-hover motion-reduce:transition-none"
                  >
                    <span role="cell" className="whitespace-nowrap text-text-tertiary">
                      {formatWhen(activity.occurred_at)}
                    </span>
                    <span role="cell" className="min-w-0 truncate text-text-secondary">
                      {activityLabel(activity, t)}
                    </span>
                    <span role="cell" className="flex min-w-0 items-center gap-2">
                      <ActivityActor activity={activity} members={members} />
                    </span>
                  </div>
                ))}
          </div>
        ) : (
          <EmptyInline
            icon="i-ri-history-line"
            title={t(($) => $['newKnowledge.overview.noActivity'])}
            description={t(($) => $['newKnowledge.overview.noActivityDescription'])}
          />
        )}
      </Panel>
    </section>
  )
}

export function OverviewActivity({
  empty,
  hasActiveTasks,
  indexing,
  knowledgeSpaceId,
}: {
  empty: boolean
  hasActiveTasks: boolean
  indexing: boolean
  knowledgeSpaceId: string
}) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const membersQuery = useMembers()
  const previewQuery = useQuery(
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.overview.activity.get.queryOptions({
      input: {
        params: { control_space_id: knowledgeSpaceId },
        query: { limit: 5 },
      },
      refetchInterval: hasActiveTasks ? OVERVIEW_REFRESH_INTERVAL : false,
    }),
  )
  const members = membersQuery.data?.accounts ?? []

  return (
    <>
      <div className="mt-3">
        <RecentActivity
          activities={previewQuery.data?.data ?? []}
          empty={empty}
          error={previewQuery.isError}
          indexing={indexing}
          loading={previewQuery.isPending}
          members={members}
          retrying={previewQuery.isRefetching}
          onOpenAll={() => setDrawerOpen(true)}
          onRetry={() => void previewQuery.refetch()}
        />
      </div>
      <ActivityDrawer
        knowledgeSpaceId={knowledgeSpaceId}
        members={members}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
      />
    </>
  )
}

function ActivityDateRangePicker({
  dates,
  onChange,
}: {
  dates: ActivityDateRange
  onChange: (dates: ActivityDateRange) => void
}) {
  const { t, i18n } = useTranslation('dataset')
  const today = dayjs()
  const formatter = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { day: 'numeric', month: 'short' }),
    [i18n.language],
  )
  const renderTrigger =
    (edge: 'start' | 'end'): NonNullable<DatePickerProps['renderTrigger']> =>
    (props, state, { handleClickTrigger, value }) => (
      <div
        {...props}
        role="button"
        tabIndex={0}
        aria-label={`${t(($) => $['newKnowledge.overview.timeRange'])} ${edge}`}
        className={cn(
          'min-w-0 flex-1 truncate rounded px-1 py-0.5 text-left system-xs-regular text-components-input-text-filled outline-hidden hover:bg-state-base-hover focus-visible:ring-1 focus-visible:ring-components-input-border-active',
          props.className,
          state.open && 'bg-state-base-hover',
        )}
        onClick={(event) => {
          handleClickTrigger(event)
          props.onClick?.(event)
        }}
        onKeyDown={(event) => {
          props.onKeyDown?.(event)
          if (event.defaultPrevented) return
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          event.currentTarget.click()
        }}
      >
        {value ? formatter.format(value.toDate()) : '—'}
      </div>
    )

  return (
    <div
      role="group"
      aria-label={t(($) => $['newKnowledge.overview.timeRange'])}
      className="flex h-6 w-35 shrink-0 items-center rounded-lg bg-background-section px-1"
    >
      <DatePicker
        noConfirm
        needTimePicker={false}
        value={dates.start}
        onChange={(start) => start && onChange({ end: dates.end, start: start.startOf('day') })}
        onClear={() => undefined}
        renderTrigger={renderTrigger('start')}
        getIsDateDisabled={(date) => date.isAfter(today, 'day') || date.isAfter(dates.end, 'day')}
      />
      <span aria-hidden className="text-text-quaternary">
        –
      </span>
      <DatePicker
        noConfirm
        needTimePicker={false}
        value={dates.end}
        onChange={(end) => end && onChange({ end: end.endOf('day'), start: dates.start })}
        onClear={() => undefined}
        renderTrigger={renderTrigger('end')}
        getIsDateDisabled={(date) =>
          date.isAfter(today, 'day') || date.isBefore(dates.start, 'day')
        }
      />
    </div>
  )
}

function ActivityDrawer({
  knowledgeSpaceId,
  members,
  onOpenChange,
  open,
}: {
  knowledgeSpaceId: string
  members: Member[]
  onOpenChange: (open: boolean) => void
  open: boolean
}) {
  const { t, i18n } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const { t: tActivityLog } = useTranslation('appLog')
  const [range, setRange] = useState<ActivityRange>('today')
  const [dates, setDates] = useState<ActivityDateRange>(() => activityDatesForRange('today'))
  const [operator, setOperator] = useState<ActivityOperator>('all')
  const activityFrom = range === 'all' ? undefined : dates.start.toISOString()
  const activityTo = range === 'all' ? undefined : dates.end.toISOString()
  const activityActorType =
    operator === 'all' ? undefined : operator === 'system' ? 'system' : 'member'
  const activityActorId = operator.startsWith('member:')
    ? `dify-account:${operator.slice(7)}`
    : undefined
  const activityQuery = useInfiniteQuery(
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.overview.activity.get.infiniteOptions({
      enabled: open,
      getNextPageParam: (lastPage) => lastPage.next_cursor,
      initialPageParam: null as string | null,
      queryKey: [
        'knowledge-fs-overview-activity',
        knowledgeSpaceId,
        activityFrom,
        activityTo,
        operator,
      ],
      input: (pageParam) => ({
        params: { control_space_id: knowledgeSpaceId },
        query: {
          ...(activityActorId ? { actor_id: activityActorId } : {}),
          ...(activityActorType ? { actor_type: activityActorType } : {}),
          ...(typeof pageParam === 'string' ? { cursor: pageParam } : {}),
          ...(activityFrom ? { from_at: activityFrom } : {}),
          limit: ACTIVITY_PAGE_SIZE,
          ...(activityTo ? { to_at: activityTo } : {}),
        },
      }),
    }),
  )
  const activities = activityQuery.data?.pages.flatMap((page) => page.data) ?? []
  const loading = activityQuery.isPending || activityQuery.isRefetching
  const rangeTriggerRef = useRef<HTMLButtonElement>(null)
  const restoreFilterFocusRef = useRef(false)
  const now = dayjs()
  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language, {
        day: 'numeric',
        month: 'short',
        weekday: 'short',
      }),
    [i18n.language],
  )
  const timeFormatter = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { hour: 'numeric', minute: '2-digit' }),
    [i18n.language],
  )
  const relativeTimeFormatter = useMemo(
    () => new Intl.RelativeTimeFormat(i18n.language, { numeric: 'auto', style: 'narrow' }),
    [i18n.language],
  )
  const groups = activities.reduce<Record<string, KnowledgeFsOverviewActivityResponse[]>>(
    (result, task) => {
      const key = dayjs(task.occurred_at).format('YYYY-MM-DD')
      result[key] ??= []
      result[key].push(task)
      return result
    },
    {},
  )
  const groupLabel = (key: string) => {
    const date = dayjs(key)
    if (date.isSame(now, 'day')) return t(($) => $['newKnowledge.overview.today'])
    if (date.isSame(now.subtract(1, 'day'), 'day'))
      return t(($) => $['newKnowledge.overview.yesterday'])
    return dateFormatter.format(date.toDate())
  }
  const activityTime = (occurredAt: string) => {
    const occurred = dayjs(occurredAt)
    if (!occurred.isSame(now, 'day')) return timeFormatter.format(occurred.toDate())
    const elapsedMinutes = Math.max(0, now.diff(occurred, 'minute'))
    if (elapsedMinutes < 60) return relativeTimeFormatter.format(-elapsedMinutes, 'minute')
    return relativeTimeFormatter.format(-Math.floor(elapsedMinutes / 60), 'hour')
  }
  const rangeLabel: Record<ActivityRange, string> = {
    '30d': t(($) => $['newKnowledge.overview.last30Days']),
    '7d': t(($) => $['newKnowledge.overview.last7Days']),
    '90d': t(($) => $['newKnowledge.overview.last90Days']),
    all: t(($) => $['newKnowledge.overview.allTime']),
    custom: tActivityLog(($) => $['filter.period.custom']),
    today: t(($) => $['newKnowledge.overview.today']),
  }
  const rangeTriggerLabel: Record<ActivityRange, string> = {
    ...rangeLabel,
    '30d': t(($) => $['newKnowledge.overview.thirtyDays']),
    '7d': t(($) => $['newKnowledge.overview.sevenDays']),
    '90d': '90d',
  }
  const operatorLabel =
    operator === 'all'
      ? tActivityLog(($) => $['filter.annotation.all'])
      : operator === 'system'
        ? t(($) => $['newKnowledge.overview.system'])
        : members.find((member) => `member:${member.id}` === operator)?.name || operator.slice(7)
  const clearFilters = () => {
    restoreFilterFocusRef.current = true
    setRange('today')
    setDates(activityDatesForRange('today'))
    setOperator('all')
  }

  const handleRangeChange = (nextRange: ActivityRange) => {
    setRange(nextRange)
    if (nextRange !== 'custom') setDates(activityDatesForRange(nextRange))
  }

  const handleDatesChange = (nextDates: ActivityDateRange) => {
    setDates(nextDates)
    setRange('custom')
  }

  useEffect(() => {
    if (!restoreFilterFocusRef.current) return
    restoreFilterFocusRef.current = false
    rangeTriggerRef.current?.focus({ preventScroll: true })
  }, [range])

  return (
    <Drawer open={open} swipeDirection="right" onOpenChange={onOpenChange}>
      <DrawerPortal>
        <DrawerBackdrop className="bg-transparent" />
        <DrawerViewport>
          <DrawerPopup className="data-[swipe-direction=right]:w-120 data-[swipe-direction=right]:max-w-[calc(100vw-1rem)]">
            <DrawerContent className="flex min-h-0 flex-1 flex-col bg-components-panel-bg p-0 pb-0">
              <header className="flex h-16 shrink-0 items-center px-5">
                <div className="flex w-full items-center justify-between gap-3">
                  <DrawerTitle className="system-lg-semibold text-text-primary">
                    {t(($) => $['newKnowledge.overview.allActivity'])}
                  </DrawerTitle>
                  <DrawerCloseButton />
                </div>
              </header>
              <div className="flex h-9 shrink-0 items-start gap-1 border-b border-divider-subtle px-5">
                <Select
                  value={range}
                  onValueChange={(value) => handleRangeChange(value as ActivityRange)}
                >
                  <SelectTrigger
                    ref={rangeTriggerRef}
                    aria-label={t(($) => $['newKnowledge.overview.timeRange'])}
                    className="h-6 w-20 min-w-0 shrink-0 border-0 bg-background-section shadow-none"
                  >
                    <span className="truncate">{rangeTriggerLabel[range]}</span>
                  </SelectTrigger>
                  <SelectContent>
                    {ACTIVITY_RANGES.map((value) => (
                      <SelectItem key={value} value={value}>
                        <SelectItemText>{rangeLabel[value]}</SelectItemText>
                        <SelectItemIndicator />
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {range === 'all' ? (
                  <div className="flex h-6 w-35 shrink-0 items-center rounded-lg bg-background-section px-2 system-xs-regular text-text-tertiary">
                    {rangeLabel.all}
                  </div>
                ) : (
                  <ActivityDateRangePicker dates={dates} onChange={handleDatesChange} />
                )}
                <Select
                  value={operator}
                  onValueChange={(value) => setOperator(value as ActivityOperator)}
                >
                  <SelectTrigger
                    aria-label={t(($) => $['newKnowledge.overview.operator'])}
                    className="h-6 w-50 min-w-0 shrink-0 border-0 bg-background-section shadow-none"
                  >
                    <span className="truncate">{operatorLabel}</span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">
                      <SelectItemText>
                        {tActivityLog(($) => $['filter.annotation.all'])}
                      </SelectItemText>
                      <SelectItemIndicator />
                    </SelectItem>
                    <SelectItem value="system">
                      <SelectItemText>{t(($) => $['newKnowledge.overview.system'])}</SelectItemText>
                      <SelectItemIndicator />
                    </SelectItem>
                    {members.map((member) => (
                      <SelectItem key={member.id} value={`member:${member.id}`}>
                        <SelectItemText>{member.name || member.email}</SelectItemText>
                        <SelectItemIndicator />
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {loading ? (
                  <div className="px-5 pt-3">
                    <Skeleton className="ml-5 h-3 w-14" />
                    <div className="mt-2 space-y-0">
                      {[248, 300, 210, 280, 236, 264].map((width) => (
                        <div key={width} className="flex h-13.5 items-center px-5">
                          <Skeleton className="size-6 shrink-0 rounded-full" />
                          <div className="ml-3 min-w-0 flex-1">
                            <Skeleton className="h-3" style={{ width }} />
                            <Skeleton className="mt-1.5 h-2.5 w-37" />
                          </div>
                          <Skeleton className="h-2.5 w-10" />
                        </div>
                      ))}
                    </div>
                  </div>
                ) : activities.length ? (
                  <>
                    {Object.entries(groups).map(([key, group]) => (
                      <section key={key}>
                        <h3 className="sticky top-0 z-10 flex h-11 items-end bg-components-panel-bg px-5 pb-2 system-xs-regular text-text-tertiary">
                          {groupLabel(key)}
                        </h3>
                        <ul>
                          {group.map((activity) => (
                            <li
                              key={activity.id}
                              className="flex min-h-13.5 items-start gap-3 px-5 py-2.5"
                            >
                              <span className="flex size-6 shrink-0 items-center">
                                <ActivityActor
                                  activity={activity}
                                  members={members}
                                  showName={false}
                                  size="xs"
                                />
                              </span>
                              <div className="min-w-0 flex-1 leading-4">
                                <p className="line-clamp-2 system-sm-regular text-text-secondary">
                                  {activityLabel(activity, t)}
                                </p>
                                <p className="system-xs-regular text-text-tertiary">
                                  {
                                    activityActor(
                                      activity,
                                      members,
                                      t(($) => $['newKnowledge.overview.system']),
                                    ).name
                                  }
                                </p>
                              </div>
                              <time
                                className="shrink-0 system-xs-regular text-text-tertiary"
                                dateTime={activity.occurred_at}
                              >
                                {activityTime(activity.occurred_at)}
                              </time>
                            </li>
                          ))}
                        </ul>
                      </section>
                    ))}
                    <div className="flex h-11 items-start justify-center pt-4">
                      {activityQuery.hasNextPage && (
                        <Button
                          disabled={activityQuery.isFetchingNextPage}
                          loading={activityQuery.isFetchingNextPage}
                          size="small"
                          variant="secondary"
                          onClick={() => void activityQuery.fetchNextPage()}
                        >
                          {t(($) => $['newKnowledge.overview.loadMore'])}
                          <span aria-hidden className="ml-1 i-ri-arrow-down-s-line size-4" />
                        </Button>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="flex h-72.25 flex-col items-center justify-end pb-0 text-center">
                    <span className="flex size-11 items-center justify-center rounded-xl bg-background-section text-text-tertiary">
                      <span aria-hidden className="i-ri-search-line size-5" />
                    </span>
                    <p className="mt-4 system-md-medium text-text-primary">
                      {t(($) => $['newKnowledge.overview.noMatchingActivity'])}
                    </p>
                    <p className="mt-1 body-xs-regular text-text-tertiary">
                      {t(($) => $['newKnowledge.overview.noMatchingActivityDescription'])}
                    </p>
                    <button
                      type="button"
                      className="mt-3 system-xs-medium text-text-accent outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid"
                      onClick={clearFilters}
                    >
                      {tCommon(($) => $['operation.clear'])}
                    </button>
                  </div>
                )}
              </div>
            </DrawerContent>
          </DrawerPopup>
        </DrawerViewport>
      </DrawerPortal>
    </Drawer>
  )
}
