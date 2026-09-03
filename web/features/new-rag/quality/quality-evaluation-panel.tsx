'use client'

import type {
  KnowledgeFsQualityReplayEvidenceItem,
  KnowledgeFsQualityReplayResponse,
} from '@dify/contracts/api/console/knowledge-fs/types.gen'
import type { RetrievalMode } from '../components/retrieval-mode-segmented-control'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { toast } from '@langgenius/dify-ui/toast'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import { consoleQuery } from '@/service/client'
import { RetrievalModeSegmentedControl } from '../components/retrieval-mode-segmented-control'
import { useKnowledgeSpace, useKnowledgeSpacePermission } from '../space/context'
import { formatQualityEvaluationCreatedAt, formatQualityReportCreatedAt } from './quality-model'

type ReplayState = KnowledgeFsQualityReplayResponse['state']
type ReplayItem = KnowledgeFsQualityReplayResponse['items'][number]

const pageSize = 20
const activeQuestionCountLimit = 100
const replayRefreshInterval = 1000
const activeReplayStates = new Set<ReplayState>(['queued', 'running'])

function evaluationStateClassName(state: ReplayState) {
  if (state === 'passed') return 'border-state-success-solid text-text-success'
  if (state === 'failed') return 'border-state-destructive-solid text-text-destructive'
  if (state === 'canceled') return 'border-divider-deep text-text-tertiary'
  return 'border-state-accent-solid text-text-accent'
}

function percent(value: number, locale: string) {
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: 0,
    style: 'percent',
  }).format(value)
}

function formatDuration(milliseconds: number | null | undefined, locale: string) {
  if (milliseconds === undefined || milliseconds === null) return '—'
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: milliseconds < 10_000 ? 1 : 0,
    style: 'unit',
    unit: milliseconds < 1000 ? 'millisecond' : 'second',
    unitDisplay: 'narrow',
  }).format(milliseconds < 1000 ? Math.round(milliseconds) : milliseconds / 1000)
}

function keepLatestReplay(
  current: KnowledgeFsQualityReplayResponse | undefined,
  candidate: KnowledgeFsQualityReplayResponse,
) {
  return current && current.revision >= candidate.revision ? current : candidate
}

function EvaluationState({ state }: { state: ReplayState }) {
  const { t } = useTranslation('knowledgeSpace')
  return (
    <span
      className={cn(
        'inline-flex w-fit items-center rounded-[5px] border bg-components-badge-bg-dimm px-1.25 py-0.75 system-2xs-medium-uppercase',
        evaluationStateClassName(state),
      )}
    >
      {t(($) => $[`qualityPage.evaluation.state.${state}`])}
    </span>
  )
}

export function EvaluationReport({
  onBack,
  onRunStarted,
  runId,
}: {
  onBack: () => void
  onRunStarted: (runId: string) => void
  runId: string
}) {
  const { i18n, t } = useTranslation('knowledgeSpace')
  const { t: tWorkflow } = useTranslation('workflow')
  const { space } = useKnowledgeSpace()
  const knowledgeSpaceId = space.control_space_id
  const [runDialogOpen, setRunDialogOpen] = useState(false)
  const [selectedEvidenceItemId, setSelectedEvidenceItemId] = useState<string>()
  const detailOptions =
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.quality.replayRuns.byRunId.get.queryOptions({
      input: { params: { control_space_id: knowledgeSpaceId, run_id: runId } },
    })
  const detailQuery = useQuery({
    ...detailOptions,
    refetchOnMount: 'always',
    refetchInterval: (query) =>
      query.state.data && activeReplayStates.has(query.state.data.state)
        ? replayRefreshInterval
        : false,
  })

  if (detailQuery.isLoading)
    return (
      <div className="flex min-h-105 items-center justify-center">
        <Loading />
      </div>
    )

  if (!detailQuery.data || detailQuery.isError)
    return (
      <div className="flex min-h-105 flex-col items-center justify-center gap-3 text-center">
        <span aria-hidden className="i-ri-error-warning-line size-8 text-text-warning" />
        <p role="alert" className="system-sm-medium text-text-primary">
          {t(($) => $['qualityPage.evaluation.loadError'])}
        </p>
        <div className="flex gap-2">
          <Button onClick={onBack}>{t(($) => $['qualityPage.evaluation.back'])}</Button>
          <Button variant="primary" onClick={() => void detailQuery.refetch()}>
            {t(($) => $['qualityPage.evaluation.retryLoad'])}
          </Button>
        </div>
      </div>
    )

  const run = detailQuery.data
  const progress = run.summary.total === 0 ? 0 : run.summary.completed / run.summary.total
  return (
    <section className="min-w-0">
      <div className="flex h-6 items-center">
        <button
          type="button"
          className="flex items-center gap-1 rounded-md system-sm-medium text-text-tertiary outline-hidden hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid"
          onClick={onBack}
        >
          <span aria-hidden className="i-ri-arrow-left-line size-4" />
          {t(($) => $['qualityPage.evaluationTab'])}
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="system-xl-semibold text-text-primary">
              {t(($) => $['qualityPage.evaluation.reportTitle'])}
            </h1>
            <EvaluationState state={run.state} />
          </div>
          <p className="mt-1 system-xs-regular text-text-primary">
            {formatQualityReportCreatedAt(run.created_at, i18n.language)}
          </p>
        </div>
        <Button onClick={() => setRunDialogOpen(true)}>
          {tWorkflow(($) => $['singleRun.reRun'])}
        </Button>
      </div>

      {run.error && (
        <div className="mt-4 rounded-lg border border-state-destructive-border bg-state-destructive-hover p-3 system-xs-regular text-text-destructive">
          {t(($) => $['qualityPage.evaluation.executionFailed'])}
        </div>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          {
            label: t(($) => $['qualityPage.evaluation.hitRate']),
            value: percent(run.summary.hit_rate, i18n.language),
          },
          {
            label: t(($) => $['qualityPage.evaluation.passed']),
            value: new Intl.NumberFormat(i18n.language).format(run.summary.passed),
          },
          {
            label: t(($) => $['qualityPage.evaluation.missed']),
            value: new Intl.NumberFormat(i18n.language).format(run.summary.failed),
          },
          {
            label: t(($) => $['qualityPage.evaluation.progress']),
            value: `${new Intl.NumberFormat(i18n.language).format(run.summary.completed)} / ${new Intl.NumberFormat(i18n.language).format(run.summary.total)}`,
          },
        ].map((metric) => (
          <div key={metric.label} className="rounded-lg bg-background-section-burn px-4 py-3">
            <p className="system-xs-regular text-text-tertiary">{metric.label}</p>
            <p className="mt-1 system-md-semibold text-text-primary">{metric.value}</p>
          </div>
        ))}
      </div>

      {activeReplayStates.has(run.state) && (
        <div className="mt-4">
          <div className="h-1.5 overflow-hidden rounded-full bg-background-section-burn">
            <div
              className="h-full rounded-full bg-components-progress-brand-progress transition-[width]"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
          <p className="mt-2 system-xs-regular text-text-tertiary">
            {t(($) => $['qualityPage.evaluation.runningDescription'])}
          </p>
        </div>
      )}

      <div className="mt-4 overflow-x-auto">
        <div className="grid min-w-190 grid-cols-[minmax(320px,1fr)_90px_130px_76px] gap-3 py-2.5 system-2xs-medium-uppercase text-text-tertiary">
          <span>{t(($) => $['qualityPage.question'])}</span>
          <span>{t(($) => $['qualityPage.statusLabel'])}</span>
          <span>{t(($) => $['qualityPage.evaluation.evidenceHit'])}</span>
          <span>{t(($) => $['qualityPage.evaluation.duration'])}</span>
        </div>
        {run.items.map((item) => {
          const diff = item.result?.evidence_diff
          return (
            <div
              key={item.id}
              className="grid h-12 min-w-190 grid-cols-[minmax(320px,1fr)_90px_130px_76px] items-center gap-3 border-t border-divider-subtle"
            >
              <span className="truncate system-sm-medium text-text-primary">{item.question}</span>
              <EvaluationState state={item.state} />
              {diff ? (
                <Button
                  variant="ghost"
                  size="small"
                  className="-ml-2 w-fit px-2 text-text-accent"
                  aria-label={t(($) => $['qualityPage.evaluation.openEvidenceDetails'], {
                    expected: diff.expected_count,
                    matched: diff.matched_count,
                    question: item.question,
                  })}
                  onClick={() => setSelectedEvidenceItemId(item.id)}
                >
                  {new Intl.NumberFormat(i18n.language).format(diff.matched_count)} /{' '}
                  {new Intl.NumberFormat(i18n.language).format(diff.expected_count)}
                  <span aria-hidden className="i-ri-arrow-right-s-line size-4" />
                </Button>
              ) : (
                <span className="system-xs-medium text-text-secondary">—</span>
              )}
              <span className="system-xs-regular text-text-secondary">
                {formatDuration(item.result?.metrics.total_ms, i18n.language)}
              </span>
            </div>
          )
        })}
      </div>

      <EvidenceDetailsDialog
        item={run.items.find((item) => item.id === selectedEvidenceItemId)}
        runId={runId}
        onOpenChange={(open) => {
          if (!open) setSelectedEvidenceItemId(undefined)
        }}
      />
      <RunEvaluationDialog
        open={runDialogOpen}
        onOpenChange={setRunDialogOpen}
        onRunStarted={onRunStarted}
      />
    </section>
  )
}

function EvidenceDetailsDialog({
  item,
  onOpenChange,
  runId,
}: {
  item?: ReplayItem
  onOpenChange: (open: boolean) => void
  runId: string
}) {
  return (
    <Dialog open={Boolean(item)} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] w-160! max-w-[calc(100vw-2rem)]! flex-col overflow-hidden! p-0!">
        {item && <EvidenceDetailsContent item={item} runId={runId} />}
      </DialogContent>
    </Dialog>
  )
}

function EvidenceDetailsContent({ item, runId }: { item: ReplayItem; runId: string }) {
  const { t } = useTranslation('knowledgeSpace')
  const { space } = useKnowledgeSpace()
  const evidenceDetailQuery = useQuery(
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.quality.replayRuns.byRunId.get.queryOptions({
      input: {
        params: { control_space_id: space.control_space_id, run_id: runId },
        query: { evidence_item_id: item.id },
      },
    }),
  )
  const selectedEvidenceItem = evidenceDetailQuery.data?.items.find(
    (evidenceItem) => evidenceItem.id === item.id,
  )
  const evidenceItems = selectedEvidenceItem?.result?.evidence_diff.evidence_items ?? []
  const evidenceGroups = [
    {
      items: evidenceItems.filter((evidence) => evidence.matched),
      matched: true,
      title: t(($) => $['qualityPage.evaluation.passed']),
    },
    {
      items: evidenceItems.filter((evidence) => !evidence.matched),
      matched: false,
      title: t(($) => $['qualityPage.evaluation.missed']),
    },
  ]

  return (
    <>
      <div className="relative px-6 pt-6">
        <DialogTitle className="system-lg-semibold pr-10 text-text-primary">
          {t(($) => $['qualityPage.evaluation.evidenceDetailsTitle'])}
        </DialogTitle>
        <DialogDescription className="mt-3 pr-10 system-sm-regular text-text-tertiary">
          {t(($) => $['qualityPage.evaluation.evidenceDetailsDescription'])}
        </DialogDescription>
        <p className="mt-3 rounded-lg bg-background-section-burn px-3 py-2.5 system-sm-medium text-text-primary">
          {item.question}
        </p>
        <DialogClose
          render={
            <IconButton
              aria-label={t(($) => $['qualityPage.closeDialog'])}
              className="absolute inset-e-6 top-6 z-10"
              size="sm"
            >
              <span aria-hidden className="i-ri-close-line size-4" />
            </IconButton>
          }
        />
      </div>
      <div className="min-h-40 flex-1 overflow-y-auto px-6 pt-5 pb-6">
        {evidenceDetailQuery.isLoading ? (
          <div className="flex min-h-40 items-center justify-center" role="status">
            <Loading />
          </div>
        ) : evidenceDetailQuery.isError ? (
          <div className="flex min-h-40 flex-col items-center justify-center gap-3 text-center">
            <p role="alert" className="system-sm-medium text-text-primary">
              {t(($) => $['qualityPage.evaluation.evidenceDetailsLoadError'])}
            </p>
            <Button onClick={() => void evidenceDetailQuery.refetch()}>
              {t(($) => $['qualityPage.evaluation.retryLoad'])}
            </Button>
          </div>
        ) : (
          <div className="space-y-5">
            {evidenceGroups.map((group) => (
              <section key={String(group.matched)} aria-label={group.title}>
                <div className="mb-2 flex items-center gap-2">
                  <h3 className="system-sm-semibold text-text-primary">{group.title}</h3>
                  <span
                    className={cn(
                      'inline-flex min-w-4 items-center justify-center rounded-[5px] border bg-components-badge-bg-dimm px-1 py-0.5 system-2xs-medium',
                      group.matched
                        ? 'border-state-success-solid text-text-success'
                        : 'border-state-destructive-solid text-text-destructive',
                    )}
                  >
                    {group.items.length}
                  </span>
                </div>
                {group.items.length === 0 ? (
                  <p className="rounded-lg border border-divider-subtle px-3 py-3 system-sm-regular text-text-tertiary">
                    {t(($) => $['qualityPage.evaluation.noEvidenceInGroup'])}
                  </p>
                ) : (
                  <div className="space-y-2">
                    {group.items.map((evidence) => (
                      <EvidenceDetailCard key={evidence.ordinal} evidence={evidence} />
                    ))}
                  </div>
                )}
              </section>
            ))}
          </div>
        )}
      </div>
    </>
  )
}

function EvidenceDetailCard({ evidence }: { evidence: KnowledgeFsQualityReplayEvidenceItem }) {
  const { t } = useTranslation('knowledgeSpace')
  const source = [
    evidence.document_name,
    evidence.section_path?.join(' / '),
    evidence.page_number
      ? t(($) => $['qualityPage.evaluation.evidencePage'], {
          page: evidence.page_number,
        })
      : undefined,
  ].filter(Boolean)

  return (
    <article className="rounded-lg border border-divider-subtle bg-background-default p-3">
      {source.length > 0 && (
        <p className="mb-1 system-xs-regular text-text-tertiary">{source.join(' · ')}</p>
      )}
      <p
        className={cn(
          'system-sm-regular wrap-break-word whitespace-pre-wrap',
          evidence.available && evidence.text ? 'text-text-secondary' : 'text-text-quaternary',
        )}
      >
        {evidence.available && evidence.text
          ? evidence.text
          : t(($) => $['qualityPage.evaluation.evidenceUnavailable'])}
      </p>
    </article>
  )
}

function RunEvaluationButton({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation('knowledgeSpace')

  return (
    <Button variant="primary" onClick={onClick}>
      <span aria-hidden className="i-ri-play-circle-line size-4" />
      {t(($) => $['qualityPage.evaluation.run'])}
    </Button>
  )
}

function RunEvaluationDialog({
  onOpenChange,
  onRunStarted,
  open,
}: {
  onOpenChange: (open: boolean) => void
  onRunStarted: (runId: string) => void
  open: boolean
}) {
  const canEdit = useKnowledgeSpacePermission('knowledge_space_edit')

  return (
    <Dialog open={canEdit && open} onOpenChange={onOpenChange}>
      {canEdit && open && (
        <RunEvaluationDialogContent
          onClose={() => onOpenChange(false)}
          onRunStarted={onRunStarted}
        />
      )}
    </Dialog>
  )
}

function RunEvaluationDialogContent({
  onClose,
  onRunStarted,
}: {
  onClose: () => void
  onRunStarted: (runId: string) => void
}) {
  const { t } = useTranslation('knowledgeSpace')
  const { space } = useKnowledgeSpace()
  const knowledgeSpaceId = space.control_space_id
  const queryClient = useQueryClient()
  const [mode, setMode] = useState<RetrievalMode>('fast')
  const goldenQuestionsQuery = useQuery(
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.goldenQuestions.get.queryOptions({
      input: {
        params: { control_space_id: knowledgeSpaceId },
        query: { limit: activeQuestionCountLimit },
      },
    }),
  )
  const createMutation = useMutation(
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.quality.replayRuns.post.mutationOptions(),
  )
  const activeGoldenQuestionCount =
    goldenQuestionsQuery.data?.data.filter((question) => question.status === 'active').length ?? 0

  const startEvaluation = async () => {
    try {
      const run = await createMutation.mutateAsync({
        body: {
          mode,
          selection: 'all-active',
        },
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        params: { control_space_id: knowledgeSpaceId },
      })
      const detailOptions =
        consoleQuery.knowledgeFs.spaces.byControlSpaceId.quality.replayRuns.byRunId.get.queryOptions(
          {
            input: { params: { control_space_id: knowledgeSpaceId, run_id: run.id } },
          },
        )
      queryClient.setQueryData(detailOptions.queryKey, (current) => keepLatestReplay(current, run))
      void queryClient.invalidateQueries({
        queryKey: consoleQuery.knowledgeFs.spaces.byControlSpaceId.quality.replayRuns.get.key({
          input: { params: { control_space_id: knowledgeSpaceId } },
          type: 'infinite',
        }),
        refetchType: 'none',
      })
      onClose()
      onRunStarted(run.id)
      toast.success(t(($) => $['qualityPage.evaluation.startedToast']))
    } catch {
      toast.error(t(($) => $['qualityPage.evaluation.startError']))
    }
  }

  return (
    <DialogContent className="w-120! max-w-[calc(100vw-2rem)]! overflow-hidden! p-0!">
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void startEvaluation()
        }}
      >
        <div className="relative px-6 pt-6">
          <DialogTitle className="system-lg-semibold pr-10 text-text-primary">
            {t(($) => $['qualityPage.evaluation.dialogTitle'])}
          </DialogTitle>
          <DialogDescription className="mt-2 pr-8 system-sm-regular text-text-tertiary">
            {t(
              ($) =>
                $[
                  activeGoldenQuestionCount === 1
                    ? 'qualityPage.evaluation.dialogDescription_one'
                    : 'qualityPage.evaluation.dialogDescription_other'
                ],
              { count: activeGoldenQuestionCount },
            )}
          </DialogDescription>
          <DialogClose
            render={
              <IconButton
                aria-label={t(($) => $['qualityPage.closeDialog'])}
                className="absolute inset-e-6 top-6"
                size="sm"
              >
                <span aria-hidden className="i-ri-close-line size-4" />
              </IconButton>
            }
          />
        </div>
        <div className="px-6 py-3">
          <p className="system-xs-medium text-text-secondary">
            {t(($) => $['qualityPage.evaluation.modeLabel'])}
          </p>
          <RetrievalModeSegmentedControl
            aria-label={t(($) => $['qualityPage.evaluation.modeLabel'])}
            appearance="composer"
            className="mt-2 w-full min-w-0"
            value={mode}
            onChange={setMode}
          />
        </div>
        <div className="flex justify-end gap-2 px-6 py-4">
          <Button type="button" disabled={createMutation.isPending} onClick={onClose}>
            {t(($) => $['qualityPage.cancel'])}
          </Button>
          <Button type="submit" variant="primary" loading={createMutation.isPending}>
            {t(($) => $['qualityPage.evaluation.start'])}
          </Button>
        </div>
      </form>
    </DialogContent>
  )
}

export function QualityEvaluationPanel({
  actionSlot,
  onOpenReport,
}: {
  actionSlot?: HTMLElement | null
  onOpenReport: (runId: string) => void
}) {
  const { i18n, t } = useTranslation('knowledgeSpace')
  const { space } = useKnowledgeSpace()
  const canEdit = useKnowledgeSpacePermission('knowledge_space_edit')
  const knowledgeSpaceId = space.control_space_id
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const listOptions =
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.quality.replayRuns.get.infiniteOptions({
      input: (pageParam) => ({
        params: { control_space_id: knowledgeSpaceId },
        query: {
          limit: pageSize,
          ...(typeof pageParam === 'string' ? { cursor: pageParam } : {}),
        },
      }),
      getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
      initialPageParam: null as string | null,
    })
  const listQuery = useInfiniteQuery({
    ...listOptions,
    refetchOnMount: 'always',
    refetchInterval: (query) =>
      query.state.data?.pages.some((page) =>
        page.data.some((run) => activeReplayStates.has(run.state)),
      )
        ? replayRefreshInterval
        : false,
  })
  const runs = listQuery.data?.pages.flatMap((page) => page.data) ?? []

  const openReport = (run: KnowledgeFsQualityReplayResponse) => {
    const detailOptions =
      consoleQuery.knowledgeFs.spaces.byControlSpaceId.quality.replayRuns.byRunId.get.queryOptions({
        input: { params: { control_space_id: knowledgeSpaceId, run_id: run.id } },
      })
    queryClient.setQueryData(detailOptions.queryKey, (current) => keepLatestReplay(current, run))
    onOpenReport(run.id)
  }

  return (
    <>
      <section className="min-w-0">
        {canEdit && runs.length > 0 && !actionSlot && (
          <div className="flex justify-end">
            <RunEvaluationButton onClick={() => setDialogOpen(true)} />
          </div>
        )}

        {listQuery.isLoading ? (
          <div className="flex min-h-105 items-center justify-center">
            <Loading />
          </div>
        ) : listQuery.isError ? (
          <div className="flex min-h-105 flex-col items-center justify-center gap-3 text-center">
            <span aria-hidden className="i-ri-error-warning-line size-8 text-text-warning" />
            <p role="alert" className="system-sm-medium text-text-primary">
              {t(($) => $['qualityPage.evaluation.loadError'])}
            </p>
            <Button onClick={() => void listQuery.refetch()}>
              {t(($) => $['qualityPage.evaluation.retryLoad'])}
            </Button>
          </div>
        ) : runs.length === 0 ? (
          <div className="flex h-140 flex-col items-center justify-center text-center">
            <span aria-hidden className="i-ri-play-circle-line size-7 text-text-tertiary" />
            <h3 className="mt-3 system-md-semibold text-text-primary">
              {t(($) => $['qualityPage.evaluation.emptyTitle'])}
            </h3>
            <p className="mt-1 max-w-136 system-xs-regular text-text-tertiary">
              {t(($) => $['qualityPage.evaluation.emptyDescription'])}
            </p>
            {canEdit && (
              <div className="mt-3">
                <RunEvaluationButton onClick={() => setDialogOpen(true)} />
              </div>
            )}
          </div>
        ) : (
          <div className="mt-2.5 overflow-x-auto pt-3">
            <div className="grid min-w-185 grid-cols-[150px_110px_140px_160px_110px_1fr] gap-3 py-2.5 system-2xs-medium-uppercase text-text-tertiary">
              <span>{t(($) => $['qualityPage.evaluation.createdAt'])}</span>
              <span>{t(($) => $['qualityPage.statusLabel'])}</span>
              <span>{t(($) => $['qualityPage.evaluation.modeLabel'])}</span>
              <span>{t(($) => $['qualityPage.evaluation.hitRate'])}</span>
              <span>{t(($) => $['qualityPage.evaluation.progress'])}</span>
              <span />
            </div>
            {runs.map((run) => (
              <div
                key={run.id}
                className="grid h-12 min-w-185 grid-cols-[150px_110px_140px_160px_110px_1fr] items-center gap-3 border-t border-divider-subtle"
              >
                <span className="system-xs-regular text-text-secondary">
                  {formatQualityEvaluationCreatedAt(
                    run.created_at,
                    t(($) => $['retrievalTest.justNow']),
                    i18n.language,
                  )}
                </span>
                <EvaluationState state={run.state} />
                <span className="system-xs-regular text-text-secondary">
                  {t(($) => $[`qualityPage.evaluation.mode.${run.mode}`])}
                </span>
                <span className="system-sm-medium text-text-primary">
                  {run.summary.completed > 0 ? percent(run.summary.hit_rate, i18n.language) : '—'}
                </span>
                <span className="system-xs-regular text-text-secondary">
                  {new Intl.NumberFormat(i18n.language).format(run.summary.completed)} /{' '}
                  {new Intl.NumberFormat(i18n.language).format(run.summary.total)}
                </span>
                <Button
                  variant="secondary"
                  size="small"
                  className="ml-auto"
                  onClick={() => openReport(run)}
                >
                  {t(($) => $['qualityPage.evaluation.viewReport'])}
                </Button>
              </div>
            ))}
            {listQuery.hasNextPage && (
              <div className="flex justify-center border-t border-divider-subtle py-4">
                <Button
                  loading={listQuery.isFetchingNextPage}
                  disabled={listQuery.isFetchingNextPage}
                  onClick={() => void listQuery.fetchNextPage()}
                >
                  {t(($) => $.loadMore)}
                </Button>
              </div>
            )}
          </div>
        )}
      </section>

      {canEdit && runs.length > 0 && actionSlot
        ? createPortal(<RunEvaluationButton onClick={() => setDialogOpen(true)} />, actionSlot)
        : null}

      <RunEvaluationDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onRunStarted={onOpenReport}
      />
    </>
  )
}
