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

type ReplayState = KnowledgeFsQualityReplayResponse['state']

const pageSize = 20
const activeReplayStates = new Set<ReplayState>(['queued', 'running'])

function evaluationStateClassName(state: ReplayState) {
  if (state === 'passed') return 'border-state-success-solid text-text-success'
  if (state === 'failed') return 'border-state-destructive-solid text-text-destructive'
  if (state === 'canceled') return 'border-divider-deep text-text-tertiary'
  return 'border-state-accent-solid text-text-accent'
}

function percent(value: number) {
  return `${Math.round(value * 100)}%`
}

function formatDuration(milliseconds?: number | null) {
  if (milliseconds === undefined || milliseconds === null) return '—'
  if (milliseconds < 1000) return `${Math.round(milliseconds)} ms`
  return `${(milliseconds / 1000).toFixed(milliseconds < 10_000 ? 1 : 0)} s`
}

function EvaluationState({ state }: { state: ReplayState }) {
  const { t } = useTranslation('dataset')
  return (
    <span
      className={cn(
        'inline-flex w-fit items-center rounded-[5px] border bg-components-badge-bg-dimm px-1.25 py-0.75 system-2xs-medium-uppercase',
        evaluationStateClassName(state),
      )}
    >
      {t(($) => $[`newKnowledge.qualityPage.evaluation.state.${state}`])}
    </span>
  )
}

function EvaluationReport({
  knowledgeSpaceId,
  onBack,
  onRerun,
  runId,
}: {
  knowledgeSpaceId: string
  onBack: () => void
  onRerun: () => void
  runId: string
}) {
  const { t } = useTranslation('dataset')
  const { t: tWorkflow } = useTranslation('workflow')
  const [selectedEvidenceItemId, setSelectedEvidenceItemId] = useState<string>()
  const detailOptions =
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.quality.replayRuns.byRunId.get.queryOptions({
      input: { params: { control_space_id: knowledgeSpaceId, run_id: runId } },
    })
  const detailQuery = useQuery({
    ...detailOptions,
    refetchInterval: (query) =>
      query.state.data && activeReplayStates.has(query.state.data.state) ? 1500 : false,
  })
  const evidenceDetailOptions =
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.quality.replayRuns.byRunId.get.queryOptions({
      input: {
        params: { control_space_id: knowledgeSpaceId, run_id: runId },
        query: selectedEvidenceItemId ? { evidence_item_id: selectedEvidenceItemId } : {},
      },
    })
  const evidenceDetailQuery = useQuery({
    ...evidenceDetailOptions,
    enabled: Boolean(selectedEvidenceItemId),
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
          {t(($) => $['newKnowledge.qualityPage.evaluation.loadError'])}
        </p>
        <div className="flex gap-2">
          <Button onClick={onBack}>
            {t(($) => $['newKnowledge.qualityPage.evaluation.back'])}
          </Button>
          <Button variant="primary" onClick={() => void detailQuery.refetch()}>
            {t(($) => $['newKnowledge.qualityPage.evaluation.retryLoad'])}
          </Button>
        </div>
      </div>
    )

  const run = detailQuery.data
  const progress = run.summary.total === 0 ? 0 : run.summary.completed / run.summary.total
  const selectedReportItem = run.items.find((item) => item.id === selectedEvidenceItemId)
  const selectedEvidenceItem = evidenceDetailQuery.data?.items.find(
    (item) => item.id === selectedEvidenceItemId,
  )
  const evidenceItems = selectedEvidenceItem?.result?.evidence_diff.evidence_items ?? []
  const evidenceGroups = [
    {
      items: evidenceItems.filter((item) => item.matched),
      matched: true,
      title: t(($) => $['newKnowledge.qualityPage.evaluation.passed']),
    },
    {
      items: evidenceItems.filter((item) => !item.matched),
      matched: false,
      title: t(($) => $['newKnowledge.qualityPage.evaluation.missed']),
    },
  ]
  return (
    <section className="min-w-0 pt-3">
      <button
        type="button"
        className="flex items-center gap-1 rounded-md system-sm-medium text-text-tertiary outline-hidden hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid"
        onClick={onBack}
      >
        <span aria-hidden className="i-ri-arrow-left-line size-4" />
        {t(($) => $['newKnowledge.qualityPage.evaluationTab'])}
      </button>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="system-xl-semibold text-text-primary">
              {t(($) => $['newKnowledge.qualityPage.evaluation.reportTitle'])}
            </h1>
            <EvaluationState state={run.state} />
          </div>
          <p className="mt-1 system-xs-regular text-text-primary">
            {new Intl.DateTimeFormat(undefined, {
              dateStyle: 'medium',
              timeStyle: 'short',
            }).format(new Date(run.created_at))}
          </p>
        </div>
        <Button onClick={onRerun}>{tWorkflow(($) => $['singleRun.reRun'])}</Button>
      </div>

      {run.error && (
        <div className="mt-4 rounded-lg border border-state-destructive-border bg-state-destructive-hover p-3 system-xs-regular text-text-destructive">
          {t(($) => $['newKnowledge.qualityPage.evaluation.executionFailed'])}
        </div>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          {
            label: t(($) => $['newKnowledge.qualityPage.evaluation.hitRate']),
            value: percent(run.summary.hit_rate),
          },
          {
            label: t(($) => $['newKnowledge.qualityPage.evaluation.passed']),
            value: String(run.summary.passed),
          },
          {
            label: t(($) => $['newKnowledge.qualityPage.evaluation.missed']),
            value: String(run.summary.failed),
          },
          {
            label: t(($) => $['newKnowledge.qualityPage.evaluation.progress']),
            value: `${run.summary.completed}/${run.summary.total}`,
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
            {t(($) => $['newKnowledge.qualityPage.evaluation.runningDescription'])}
          </p>
        </div>
      )}

      <div className="mt-4 overflow-x-auto">
        <div className="grid min-w-190 grid-cols-[minmax(320px,1fr)_90px_130px_76px] gap-3 py-2.5 system-2xs-medium-uppercase text-text-tertiary">
          <span>{t(($) => $['newKnowledge.qualityPage.question'])}</span>
          <span>{t(($) => $['newKnowledge.qualityPage.statusLabel'])}</span>
          <span>{t(($) => $['newKnowledge.qualityPage.evaluation.evidenceHit'])}</span>
          <span>{t(($) => $['newKnowledge.qualityPage.evaluation.duration'])}</span>
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
                  aria-label={t(
                    ($) => $['newKnowledge.qualityPage.evaluation.openEvidenceDetails'],
                    {
                      expected: diff.expected_count,
                      matched: diff.matched_count,
                      question: item.question,
                    },
                  )}
                  onClick={() => setSelectedEvidenceItemId(item.id)}
                >
                  {diff.matched_count} of {diff.expected_count}
                  <span aria-hidden className="i-ri-arrow-right-s-line size-4" />
                </Button>
              ) : (
                <span className="system-xs-medium text-text-secondary">—</span>
              )}
              <span className="system-xs-regular text-text-secondary">
                {formatDuration(item.result?.metrics.total_ms)}
              </span>
            </div>
          )
        })}
      </div>

      <Dialog
        open={Boolean(selectedEvidenceItemId)}
        onOpenChange={(open) => {
          if (!open) setSelectedEvidenceItemId(undefined)
        }}
      >
        <DialogContent className="flex max-h-[calc(100dvh-2rem)] w-160! max-w-[calc(100vw-2rem)]! flex-col overflow-hidden! p-0!">
          <div className="relative px-6 pt-6">
            <DialogTitle className="system-lg-semibold pr-10 text-text-primary">
              {t(($) => $['newKnowledge.qualityPage.evaluation.evidenceDetailsTitle'])}
            </DialogTitle>
            <DialogDescription className="mt-3 pr-10 system-sm-regular text-text-tertiary">
              {t(($) => $['newKnowledge.qualityPage.evaluation.evidenceDetailsDescription'])}
            </DialogDescription>
            {selectedReportItem && (
              <p className="mt-3 rounded-lg bg-background-section-burn px-3 py-2.5 system-sm-medium text-text-primary">
                {selectedReportItem.question}
              </p>
            )}
            <DialogClose
              render={
                <IconButton
                  aria-label={t(($) => $['newKnowledge.qualityPage.closeDialog'])}
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
                  {t(($) => $['newKnowledge.qualityPage.evaluation.evidenceDetailsLoadError'])}
                </p>
                <Button onClick={() => void evidenceDetailQuery.refetch()}>
                  {t(($) => $['newKnowledge.qualityPage.evaluation.retryLoad'])}
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
                        {t(($) => $['newKnowledge.qualityPage.evaluation.noEvidenceInGroup'])}
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
        </DialogContent>
      </Dialog>
    </section>
  )
}

function EvidenceDetailCard({ evidence }: { evidence: KnowledgeFsQualityReplayEvidenceItem }) {
  const { t } = useTranslation('dataset')
  const source = [
    evidence.document_name,
    evidence.section_path?.join(' / '),
    evidence.page_number
      ? t(($) => $['newKnowledge.qualityPage.evaluation.evidencePage'], {
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
          'system-sm-regular break-words whitespace-pre-wrap',
          evidence.available && evidence.text ? 'text-text-secondary' : 'text-text-quaternary',
        )}
      >
        {evidence.available && evidence.text
          ? evidence.text
          : t(($) => $['newKnowledge.qualityPage.evaluation.evidenceUnavailable'])}
      </p>
    </article>
  )
}

function RunEvaluationButton({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation('dataset')

  return (
    <Button variant="primary" onClick={onClick}>
      <span aria-hidden className="i-ri-play-circle-line size-4" />
      {t(($) => $['newKnowledge.qualityPage.evaluation.run'])}
    </Button>
  )
}

export function QualityEvaluationPanel({
  actionSlot,
  canEdit,
  knowledgeSpaceId,
  onSelectedRunIdChange,
  selectedRunId: controlledSelectedRunId,
}: {
  actionSlot?: HTMLElement | null
  canEdit: boolean
  knowledgeSpaceId: string
  onSelectedRunIdChange?: (runId: string | undefined) => void
  selectedRunId?: string
}) {
  const { t } = useTranslation('dataset')
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [mode, setMode] = useState<RetrievalMode>('fast')
  const [internalSelectedRunId, setInternalSelectedRunId] = useState<string>()
  const selectedRunId = onSelectedRunIdChange ? controlledSelectedRunId : internalSelectedRunId
  const setSelectedRunId = (runId: string | undefined) => {
    setInternalSelectedRunId(runId)
    onSelectedRunIdChange?.(runId)
  }
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
    refetchInterval: (query) =>
      query.state.data?.pages.some((page) =>
        page.data.some((run) => activeReplayStates.has(run.state)),
      )
        ? 1500
        : false,
  })
  const createMutation = useMutation(
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.quality.replayRuns.post.mutationOptions(),
  )
  const runs = listQuery.data?.pages.flatMap((page) => page.data) ?? []

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
      setDialogOpen(false)
      await queryClient.invalidateQueries({ queryKey: listOptions.queryKey })
      setSelectedRunId(run.id)
      toast.success(t(($) => $['newKnowledge.qualityPage.evaluation.startedToast']))
    } catch {
      toast.error(t(($) => $['newKnowledge.qualityPage.evaluation.startError']))
    }
  }

  return (
    <>
      {selectedRunId ? (
        <EvaluationReport
          knowledgeSpaceId={knowledgeSpaceId}
          runId={selectedRunId}
          onBack={() => setSelectedRunId(undefined)}
          onRerun={() => setDialogOpen(true)}
        />
      ) : (
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
                {t(($) => $['newKnowledge.qualityPage.evaluation.loadError'])}
              </p>
              <Button onClick={() => void listQuery.refetch()}>
                {t(($) => $['newKnowledge.qualityPage.evaluation.retryLoad'])}
              </Button>
            </div>
          ) : runs.length === 0 ? (
            <div className="flex h-140 flex-col items-center justify-center text-center">
              <span aria-hidden className="i-ri-play-circle-line size-7 text-text-tertiary" />
              <h3 className="mt-3 system-md-semibold text-text-primary">
                {t(($) => $['newKnowledge.qualityPage.evaluation.emptyTitle'])}
              </h3>
              <p className="mt-1 max-w-136 system-xs-regular text-text-tertiary">
                {t(($) => $['newKnowledge.qualityPage.evaluation.emptyDescription'])}
              </p>
              {canEdit && (
                <div className="mt-3">
                  <RunEvaluationButton onClick={() => setDialogOpen(true)} />
                </div>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <div className="grid min-w-185 grid-cols-[150px_110px_140px_160px_110px_1fr] gap-3 py-2.5 system-2xs-medium-uppercase text-text-tertiary">
                <span>{t(($) => $['newKnowledge.qualityPage.evaluation.createdAt'])}</span>
                <span>{t(($) => $['newKnowledge.qualityPage.statusLabel'])}</span>
                <span>{t(($) => $['newKnowledge.qualityPage.evaluation.modeLabel'])}</span>
                <span>{t(($) => $['newKnowledge.qualityPage.evaluation.hitRate'])}</span>
                <span>{t(($) => $['newKnowledge.qualityPage.evaluation.progress'])}</span>
                <span />
              </div>
              {runs.map((run) => (
                <div
                  key={run.id}
                  className="grid h-12 min-w-185 grid-cols-[150px_110px_140px_160px_110px_1fr] items-center gap-3 border-t border-divider-subtle"
                >
                  <span className="system-xs-regular text-text-secondary">
                    {new Intl.DateTimeFormat(undefined, {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    }).format(new Date(run.created_at))}
                  </span>
                  <EvaluationState state={run.state} />
                  <span className="system-xs-regular text-text-secondary">
                    {t(($) => $[`newKnowledge.qualityPage.evaluation.mode.${run.mode}`])}
                  </span>
                  <span className="system-sm-medium text-text-primary">
                    {run.summary.completed > 0 ? percent(run.summary.hit_rate) : '—'}
                  </span>
                  <span className="system-xs-regular text-text-secondary">
                    {run.summary.completed}/{run.summary.total}
                  </span>
                  <Button
                    variant="secondary"
                    size="small"
                    className="ml-auto"
                    onClick={() => setSelectedRunId(run.id)}
                  >
                    {t(($) => $['newKnowledge.qualityPage.evaluation.viewReport'])}
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
                    {t(($) => $['newKnowledge.loadMore'])}
                  </Button>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {!selectedRunId && canEdit && runs.length > 0 && actionSlot
        ? createPortal(<RunEvaluationButton onClick={() => setDialogOpen(true)} />, actionSlot)
        : null}

      <Dialog open={canEdit && dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="w-120! max-w-[calc(100vw-2rem)]! overflow-hidden! p-0!">
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void startEvaluation()
            }}
          >
            <div className="relative px-6 pt-6">
              <DialogTitle className="system-lg-semibold pr-10 text-text-primary">
                {t(($) => $['newKnowledge.qualityPage.evaluation.dialogTitle'])}
              </DialogTitle>
              <DialogDescription className="mt-2 pr-8 system-sm-regular text-text-tertiary">
                {t(($) => $['newKnowledge.qualityPage.evaluation.dialogDescription'])}
              </DialogDescription>
              <DialogClose
                render={
                  <IconButton
                    aria-label={t(($) => $['newKnowledge.qualityPage.closeDialog'])}
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
                {t(($) => $['newKnowledge.qualityPage.evaluation.modeLabel'])}
              </p>
              <RetrievalModeSegmentedControl
                aria-label={t(($) => $['newKnowledge.qualityPage.evaluation.modeLabel'])}
                appearance="composer"
                className="mt-2 w-full min-w-0"
                value={mode}
                onChange={setMode}
              />
            </div>
            <div className="flex justify-end gap-2 px-6 py-4">
              <Button disabled={createMutation.isPending} onClick={() => setDialogOpen(false)}>
                {t(($) => $['newKnowledge.qualityPage.cancel'])}
              </Button>
              <Button type="submit" variant="primary" loading={createMutation.isPending}>
                {t(($) => $['newKnowledge.qualityPage.evaluation.start'])}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
