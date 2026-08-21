'use client'

import type { KnowledgeFsBackgroundTaskResponse } from '@dify/contracts/api/console/knowledge-fs/types.gen'
import type { ActivityDateRange, ActivityOperator, ActivityRange } from './overview-activity-types'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { SegmentedControl, SegmentedControlItem } from '@langgenius/dify-ui/segmented-control'
import { skipToken, useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { parseAsStringLiteral, useQueryState } from 'nuqs'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  datasetDefaultPermissionKeysAtom,
  workspacePermissionKeysAtom,
} from '@/context/permission-state'
import { knowledgeFsUploadEnabledAtom } from '@/features/system-features/state'
import { consoleQuery } from '@/service/client'
import { useMembers } from '@/service/use-common'
import { DatasetACLPermission, hasPermission } from '@/utils/permission'
import { KnowledgeModelReadinessBanner } from '../components/knowledge-model-readiness-banner'
import { ActivityDrawer, RecentActivity } from './overview-activity'
import { activityDatesForRange } from './overview-activity-types'
import { AttentionPanel } from './overview-attention'
import {
  changeLabel,
  compactNumber,
  formatDuration,
  OVERVIEW_REFRESH_INTERVAL,
  overviewRefreshInterval,
} from './overview-format'
import { InventoryPanel } from './overview-inventory'
import { MetricCard, QueryOutcomesChart } from './overview-metrics'
import { FirstSourceTaskFailureBanner, Onboarding } from './overview-onboarding'

type OverviewWindow = '24h' | '7d' | '30d'

const WINDOWS: OverviewWindow[] = ['24h', '7d', '30d']
const ACTIVE_TASK_STATES = new Set<KnowledgeFsBackgroundTaskResponse['state']>([
  'queued',
  'running',
])
const TASK_PAGE_SIZE = 20
const ACTIVITY_PAGE_SIZE = 20
const overviewWindowParser = parseAsStringLiteral(WINDOWS)
  .withDefault('24h')
  .withOptions({ history: 'push' })

function isFirstSourceTask(task: KnowledgeFsBackgroundTaskResponse) {
  return (
    task.operation === 'document_processing' ||
    task.operation === 'document_upload' ||
    task.operation.includes('import')
  )
}

export function KnowledgeOverviewPage({ knowledgeSpaceId }: { knowledgeSpaceId: string }) {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const datasetDefaultPermissionKeys = useAtomValue(datasetDefaultPermissionKeysAtom)
  const uploadAvailable = useAtomValue(knowledgeFsUploadEnabledAtom)
  const canConnectSource = hasPermission(workspacePermissionKeys, 'dataset.external.connect')
  const canUpload =
    uploadAvailable && hasPermission(datasetDefaultPermissionKeys, DatasetACLPermission.Edit)
  const [window, setWindow] = useQueryState('window', overviewWindowParser)
  const [activityOpen, setActivityOpen] = useState(false)
  const [activityRange, setActivityRange] = useState<ActivityRange>('today')
  const [activityDates, setActivityDates] = useState<ActivityDateRange>(() =>
    activityDatesForRange('today'),
  )
  const [activityOperator, setActivityOperator] = useState<ActivityOperator>('all')
  const activityFrom = activityRange === 'all' ? undefined : activityDates.start.toISOString()
  const activityTo = activityRange === 'all' ? undefined : activityDates.end.toISOString()
  const activityActorType =
    activityOperator === 'all' ? undefined : activityOperator === 'system' ? 'system' : 'member'
  const activityActorId = activityOperator.startsWith('member:')
    ? `dify-account:${activityOperator.slice(7)}`
    : undefined
  const handleActivityRangeChange = (range: ActivityRange) => {
    setActivityRange(range)
    if (range !== 'custom') setActivityDates(activityDatesForRange(range))
  }
  const handleActivityDatesChange = (dates: ActivityDateRange) => {
    setActivityDates(dates)
    setActivityRange('custom')
  }
  const membersQuery = useMembers()
  const tasksQuery = useInfiniteQuery(
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.backgroundTasks.get.infiniteOptions({
      getNextPageParam: (lastPage) => lastPage.next_cursor,
      initialPageParam: null as string | null,
      input: (pageParam) => ({
        params: { control_space_id: knowledgeSpaceId },
        query: {
          ...(typeof pageParam === 'string' ? { cursor: pageParam } : {}),
          limit: TASK_PAGE_SIZE,
        },
      }),
      refetchInterval: (query) =>
        query.state.data?.pages.some((page) =>
          page.data.some((task) => ACTIVE_TASK_STATES.has(task.state)),
        )
          ? OVERVIEW_REFRESH_INTERVAL
          : false,
    }),
  )
  const tasks = tasksQuery.data?.pages.flatMap((page) => page.data) ?? []
  const hasActiveTasks = tasks.some((task) => ACTIVE_TASK_STATES.has(task.state))
  const latestTaskUpdatedAt = tasks.reduce<number | undefined>((latest, task) => {
    const updatedAt = Date.parse(task.updated_at)
    if (!Number.isFinite(updatedAt)) return latest
    return latest === undefined || updatedAt > latest ? updatedAt : latest
  }, undefined)
  const statsQuery = useQuery(
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.overview.stats.get.queryOptions({
      input: {
        params: { control_space_id: knowledgeSpaceId },
        query: { window },
      },
      refetchInterval: (query) =>
        overviewRefreshInterval({
          generatedAt: query.state.data?.generated_at,
          hasActiveTasks,
          latestTaskUpdatedAt,
        }),
    }),
  )
  const outcomesQuery = useQuery(
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.overview.queryOutcomes.get.queryOptions({
      input: {
        params: { control_space_id: knowledgeSpaceId },
        query: { window },
      },
      refetchInterval: (query) =>
        overviewRefreshInterval({
          generatedAt: query.state.data?.generated_at,
          hasActiveTasks,
          latestTaskUpdatedAt,
        }),
    }),
  )
  const inventoryQuery = useQuery(
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.overview.inventory.get.queryOptions({
      input: { params: { control_space_id: knowledgeSpaceId } },
      refetchInterval: (query) =>
        overviewRefreshInterval({
          generatedAt: query.state.data?.generated_at,
          hasActiveTasks,
          latestTaskUpdatedAt,
        }),
    }),
  )
  const attentionQuery = useQuery(
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.overview.attention.get.queryOptions({
      input: {
        params: { control_space_id: knowledgeSpaceId },
        query: { include_dismissed: false, limit: 100 },
      },
      refetchInterval: hasActiveTasks ? OVERVIEW_REFRESH_INTERVAL : false,
    }),
  )
  const activityPreviewQuery = useQuery(
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.overview.activity.get.queryOptions({
      input: {
        params: { control_space_id: knowledgeSpaceId },
        query: { limit: 5 },
      },
      refetchInterval: hasActiveTasks ? OVERVIEW_REFRESH_INTERVAL : false,
    }),
  )
  const activityDrawerQuery = useInfiniteQuery(
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.overview.activity.get.infiniteOptions({
      enabled: activityOpen,
      getNextPageParam: (lastPage) => lastPage.next_cursor,
      initialPageParam: null as string | null,
      queryKey: [
        'knowledge-fs-overview-activity',
        knowledgeSpaceId,
        activityFrom,
        activityTo,
        activityOperator,
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
  const activities = activityDrawerQuery.data?.pages.flatMap((page) => page.data) ?? []
  const members = membersQuery.data?.accounts ?? []
  const indexingTask = tasks.find(
    (task) => ACTIVE_TASK_STATES.has(task.state) && isFirstSourceTask(task),
  )
  const indexingSourceQuery = useQuery(
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.sources.bySourceId.get.queryOptions({
      input: indexingTask?.source_id
        ? {
            params: {
              control_space_id: knowledgeSpaceId,
              source_id: indexingTask.source_id,
            },
          }
        : skipToken,
    }),
  )
  const latestFirstSourceTask = tasks
    .filter(isFirstSourceTask)
    .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))[0]
  const failedTask = latestFirstSourceTask?.state === 'failed' ? latestFirstSourceTask : undefined
  const pageLoading =
    tasksQuery.isPending ||
    statsQuery.isPending ||
    outcomesQuery.isPending ||
    inventoryQuery.isPending ||
    attentionQuery.isPending ||
    activityPreviewQuery.isPending ||
    (indexingTask?.source_id != null && indexingSourceQuery.isPending)
  const firstLoadFailed =
    !pageLoading &&
    (statsQuery.isError ||
      outcomesQuery.isError ||
      inventoryQuery.isError ||
      attentionQuery.isError ||
      activityPreviewQuery.isError)
  const hasContent =
    (statsQuery.data?.source_count ?? 0) > 0 || (statsQuery.data?.documents ?? 0) > 0
  const showIndexing =
    !pageLoading &&
    !inventoryQuery.isError &&
    (inventoryQuery.data?.index_coverage.indexed ?? 0) === 0 &&
    indexingTask !== undefined
  const empty = !pageLoading && !statsQuery.isError && !hasContent && !showIndexing
  const showEmptyModules = empty || showIndexing
  const retry = () =>
    void Promise.all([
      statsQuery.refetch(),
      outcomesQuery.refetch(),
      inventoryQuery.refetch(),
      attentionQuery.refetch(),
      activityPreviewQuery.refetch(),
      tasksQuery.refetch(),
    ])

  return (
    <main className="min-h-0 min-w-0 flex-1 overflow-y-auto bg-components-panel-bg">
      <div className="w-full px-6 pt-3 pb-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="title-3xl-bold text-text-primary">
            {t(($) => $['newKnowledge.overviewTitle'])}
          </h1>
          {!empty && !showIndexing && (
            <SegmentedControl<OverviewWindow>
              aria-label={t(($) => $['newKnowledge.overview.timeRange'])}
              value={window}
              onValueChange={(value) => void setWindow(value)}
            >
              {WINDOWS.map((value) => (
                <SegmentedControlItem<OverviewWindow>
                  key={value}
                  className="h-6.5 px-2.5"
                  value={value}
                >
                  {value === '24h'
                    ? value
                    : value === '7d'
                      ? t(($) => $['newKnowledge.overview.sevenDays'])
                      : t(($) => $['newKnowledge.overview.thirtyDays'])}
                </SegmentedControlItem>
              ))}
            </SegmentedControl>
          )}
        </header>
        {!pageLoading && failedTask && (
          <FirstSourceTaskFailureBanner
            failedTask={failedTask}
            knowledgeSpaceId={knowledgeSpaceId}
            onRetryTask={tasksQuery.refetch}
          />
        )}
        <KnowledgeModelReadinessBanner
          capability="query"
          className="mt-4"
          knowledgeSpaceId={knowledgeSpaceId}
        />

        {pageLoading && (
          <p className="sr-only" role="status">
            {tCommon(($) => $.loading)}
          </p>
        )}

        {firstLoadFailed && (
          <div
            role="alert"
            className="mt-4 flex items-center justify-between gap-4 rounded-xl border border-divider-regular bg-background-section p-4"
          >
            <p className="system-sm-regular text-text-destructive">
              {t(($) => $['newKnowledge.detailErrorDescription'])}
            </p>
            <Button size="small" variant="secondary" onClick={retry}>
              {tCommon(($) => $['operation.retry'])}
            </Button>
          </div>
        )}

        {showIndexing && (
          <div className="mt-3">
            <Onboarding
              canConnectSource={canConnectSource}
              canUpload={canUpload}
              knowledgeSpaceId={knowledgeSpaceId}
              indexingTask={indexingTask}
              indexingSourceName={indexingSourceQuery.data?.name}
            />
          </div>
        )}
        {empty && (
          <div className="mt-3">
            <Onboarding
              canConnectSource={canConnectSource}
              canUpload={canUpload}
              knowledgeSpaceId={knowledgeSpaceId}
            />
          </div>
        )}
        <div
          className={cn(
            'grid gap-3 sm:grid-cols-2 xl:grid-cols-5',
            showEmptyModules ? 'mt-3 pt-6' : 'mt-3',
          )}
        >
          <MetricCard
            empty={showEmptyModules}
            loading={pageLoading}
            title={t(($) => $['newKnowledge.overview.queries'])}
            help={t(($) => $['newKnowledge.overview.queriesHelp'])}
            value={statsQuery.data ? compactNumber(statsQuery.data.queries.value) : '—'}
            change={
              statsQuery.data
                ? changeLabel(
                    statsQuery.data.queries.change_rate === null
                      ? null
                      : statsQuery.data.queries.change_rate * 100,
                  )
                : undefined
            }
          />
          <MetricCard
            empty={showEmptyModules}
            loading={pageLoading}
            title={t(($) => $['newKnowledge.overview.answerRate'])}
            help={t(($) => $['newKnowledge.overview.answerRateHelp'])}
            value={
              statsQuery.data ? `${Math.round(statsQuery.data.answer_rate.value * 100)}%` : '—'
            }
            change={
              statsQuery.data
                ? changeLabel(statsQuery.data.answer_rate.change_percentage_points, 'pp')
                : undefined
            }
          />
          <MetricCard
            empty={showEmptyModules}
            loading={pageLoading}
            title={t(($) => $['newKnowledge.overview.documents'])}
            value={statsQuery.data ? compactNumber(statsQuery.data.documents) : '—'}
          />
          <MetricCard
            empty={showEmptyModules}
            loading={pageLoading}
            title={t(($) => $['newKnowledge.overview.linkedApps'])}
            value={statsQuery.data ? compactNumber(statsQuery.data.linked_apps) : '—'}
          />
          <MetricCard
            empty={showEmptyModules}
            loading={pageLoading}
            title={t(($) => $['newKnowledge.overview.freshness'])}
            help={t(($) => $['newKnowledge.overview.freshnessHelp'])}
            value={formatDuration(statsQuery.data?.freshness_seconds)}
          />
        </div>
        <div
          className={cn(
            'grid lg:grid-cols-2',
            showIndexing ? 'mt-3 gap-2.5' : showEmptyModules ? 'mt-2 gap-2.5' : 'mt-3 gap-2.5',
          )}
        >
          <AttentionPanel
            attention={attentionQuery.data?.data ?? []}
            empty={showEmptyModules}
            error={attentionQuery.isError}
            knowledgeSpaceId={knowledgeSpaceId}
            loading={pageLoading}
          />
          <QueryOutcomesChart
            buckets={outcomesQuery.data?.buckets ?? []}
            empty={showEmptyModules}
            error={outcomesQuery.isError}
            loading={pageLoading}
          />
        </div>
        <div className="mt-3">
          <RecentActivity
            activities={activityPreviewQuery.data?.data ?? []}
            empty={showEmptyModules}
            error={activityPreviewQuery.isError}
            indexing={showIndexing}
            loading={pageLoading}
            members={members}
            retrying={activityPreviewQuery.isRefetching}
            onOpenAll={() => {
              setActivityOpen(true)
              void activityDrawerQuery.refetch()
            }}
            onRetry={() => void activityPreviewQuery.refetch()}
          />
        </div>
        <div className="mt-3">
          <InventoryPanel
            empty={showEmptyModules}
            error={inventoryQuery.isError}
            indexing={showIndexing}
            inventory={inventoryQuery.data}
            loading={pageLoading}
          />
        </div>
      </div>
      <ActivityDrawer
        activities={activities}
        dates={activityDates}
        hasNextPage={Boolean(activityDrawerQuery.hasNextPage)}
        isFetchingNextPage={activityDrawerQuery.isFetchingNextPage}
        loading={activityDrawerQuery.isPending || activityDrawerQuery.isRefetching}
        members={members}
        open={activityOpen}
        operator={activityOperator}
        range={activityRange}
        onDatesChange={handleActivityDatesChange}
        onFetchNextPage={() => void activityDrawerQuery.fetchNextPage()}
        onOpenChange={setActivityOpen}
        onOperatorChange={setActivityOperator}
        onRangeChange={handleActivityRangeChange}
      />
    </main>
  )
}
