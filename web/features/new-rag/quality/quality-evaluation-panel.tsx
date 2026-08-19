'use client'

import type { KnowledgeFsQualityReplayResponse } from '@dify/contracts/api/console/knowledge-fs/types.gen'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Dialog,
  DialogBackdrop,
  DialogCloseButton,
  DialogPopup,
  DialogPortal,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { RadioGroup, RadioItem } from '@langgenius/dify-ui/radio'
import { toast } from '@langgenius/dify-ui/toast'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import { consoleQuery } from '@/service/client'

type EvaluationMode = 'default' | 'deep' | 'fast' | 'research'
type ReplayState = KnowledgeFsQualityReplayResponse['state']

const pageSize = 20
const activeReplayStates = new Set<ReplayState>(['queued', 'running'])

function evaluationStateClassName(state: ReplayState) {
  if (state === 'passed') return 'bg-state-success-hover text-text-success'
  if (state === 'failed') return 'bg-state-destructive-hover text-text-destructive'
  if (state === 'canceled') return 'bg-state-base-hover text-text-tertiary'
  return 'bg-state-accent-hover text-text-accent'
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
        'inline-flex w-fit items-center rounded-md px-1.5 py-0.5 system-2xs-medium-uppercase',
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
  runId,
}: {
  knowledgeSpaceId: string
  onBack: () => void
  runId: string
}) {
  const { t } = useTranslation('dataset')
  const detailOptions =
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.quality.replayRuns.byRunId.get.queryOptions({
      input: { params: { control_space_id: knowledgeSpaceId, run_id: runId } },
    })
  const detailQuery = useQuery({
    ...detailOptions,
    refetchInterval: (query) =>
      query.state.data && activeReplayStates.has(query.state.data.state) ? 1500 : false,
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
  return (
    <section className="mt-3 min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <Button variant="ghost" className="mt-0.5 px-2" onClick={onBack}>
            <span aria-hidden className="i-ri-arrow-left-line size-4" />
            {t(($) => $['newKnowledge.qualityPage.evaluation.back'])}
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="system-md-semibold text-text-primary">
                {t(($) => $['newKnowledge.qualityPage.evaluation.reportTitle'])}
              </h2>
              <EvaluationState state={run.state} />
            </div>
            <p className="mt-1 system-xs-regular text-text-tertiary">
              {new Intl.DateTimeFormat(undefined, {
                dateStyle: 'medium',
                timeStyle: 'short',
              }).format(new Date(run.created_at))}
              {' · '}
              {t(($) => $[`newKnowledge.qualityPage.evaluation.mode.${run.mode}`])}
            </p>
          </div>
        </div>
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
          <div
            key={metric.label}
            className="rounded-xl border border-divider-subtle bg-background-section-burn p-4"
          >
            <p className="system-xs-regular text-text-tertiary">{metric.label}</p>
            <p className="mt-1 system-xl-semibold text-text-primary">{metric.value}</p>
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

      <div className="mt-5 overflow-x-auto rounded-xl border border-divider-subtle">
        <div className="grid min-w-190 grid-cols-[minmax(240px,2fr)_100px_120px_130px_100px] gap-3 border-b border-divider-subtle bg-background-section-burn px-4 py-2 system-2xs-medium-uppercase text-text-tertiary">
          <span>{t(($) => $['newKnowledge.qualityPage.question'])}</span>
          <span>{t(($) => $['newKnowledge.qualityPage.statusLabel'])}</span>
          <span>{t(($) => $['newKnowledge.qualityPage.evaluation.policy'])}</span>
          <span>{t(($) => $['newKnowledge.qualityPage.evaluation.evidenceHit'])}</span>
          <span>{t(($) => $['newKnowledge.qualityPage.evaluation.duration'])}</span>
        </div>
        {run.items.map((item) => {
          const diff = item.result?.evidence_diff
          return (
            <div
              key={item.id}
              className="grid min-h-14 min-w-190 grid-cols-[minmax(240px,2fr)_100px_120px_130px_100px] items-center gap-3 border-b border-divider-subtle px-4 py-2 last:border-b-0"
            >
              <span className="line-clamp-2 system-sm-medium text-text-primary">
                {item.question}
              </span>
              <EvaluationState state={item.state} />
              <span className="system-xs-regular text-text-secondary">
                {t(($) => $[`newKnowledge.qualityPage.matchPolicy.${item.match_policy}`])}
              </span>
              <span className="system-xs-medium text-text-secondary">
                {diff ? `${diff.matched_count}/${diff.expected_count}` : '—'}
              </span>
              <span className="system-xs-regular text-text-secondary">
                {formatDuration(item.result?.metrics.total_ms)}
              </span>
            </div>
          )
        })}
      </div>

      <div className="mt-4 rounded-xl border border-divider-subtle p-4">
        <h3 className="system-sm-semibold text-text-primary">
          {t(($) => $['newKnowledge.qualityPage.evaluation.runtimeSnapshot'])}
        </h3>
        <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 system-xs-regular text-text-tertiary">
          <span>
            {t(($) => $['newKnowledge.qualityPage.evaluation.profileRevision'])}:{' '}
            {run.provenance.retrieval.profile_revision}
          </span>
          <span>
            {t(($) => $['newKnowledge.qualityPage.evaluation.reasoningModel'])}:{' '}
            {run.provenance.retrieval.reasoning_model}
          </span>
          {run.provenance.retrieval.rerank_model && (
            <span>
              {t(($) => $['newKnowledge.qualityPage.evaluation.rerankModel'])}:{' '}
              {run.provenance.retrieval.rerank_model}
            </span>
          )}
          <span>
            {t(($) => $['newKnowledge.qualityPage.evaluation.projectionVersion'])}:{' '}
            {run.provenance.projection.projection_version}
          </span>
        </div>
      </div>
    </section>
  )
}

export function QualityEvaluationPanel({ knowledgeSpaceId }: { knowledgeSpaceId: string }) {
  const { t } = useTranslation('dataset')
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [mode, setMode] = useState<EvaluationMode>('default')
  const [selectedRunId, setSelectedRunId] = useState<string>()
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
          selection: 'all-active',
          ...(mode === 'default' ? {} : { mode }),
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

  if (selectedRunId)
    return (
      <EvaluationReport
        knowledgeSpaceId={knowledgeSpaceId}
        runId={selectedRunId}
        onBack={() => setSelectedRunId(undefined)}
      />
    )

  return (
    <section className="mt-3 min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="system-md-semibold text-text-primary">
            {t(($) => $['newKnowledge.qualityPage.evaluation.title'])}
          </h2>
          <p className="mt-1 max-w-160 system-xs-regular text-text-tertiary">
            {t(($) => $['newKnowledge.qualityPage.evaluation.description'])}
          </p>
        </div>
        <Button variant="primary" className="gap-1" onClick={() => setDialogOpen(true)}>
          <span aria-hidden className="i-ri-play-circle-line size-4" />
          {t(($) => $['newKnowledge.qualityPage.evaluation.run'])}
        </Button>
      </div>

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
        <div className="flex h-105 flex-col items-center justify-center text-center">
          <span aria-hidden className="i-ri-bar-chart-box-line size-8 text-text-tertiary" />
          <h3 className="mt-3 system-md-semibold text-text-primary">
            {t(($) => $['newKnowledge.qualityPage.evaluation.emptyTitle'])}
          </h3>
          <p className="mt-1 max-w-lg system-xs-regular text-text-tertiary">
            {t(($) => $['newKnowledge.qualityPage.evaluation.emptyDescription'])}
          </p>
        </div>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-xl border border-divider-subtle">
          <div className="grid min-w-185 grid-cols-[140px_100px_110px_110px_1fr_100px] gap-3 border-b border-divider-subtle bg-background-section-burn px-4 py-2 system-2xs-medium-uppercase text-text-tertiary">
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
              className="grid min-h-14 min-w-185 grid-cols-[140px_100px_110px_110px_1fr_100px] items-center gap-3 border-b border-divider-subtle px-4 py-2 last:border-b-0"
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
              <Button variant="ghost" onClick={() => setSelectedRunId(run.id)}>
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

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogPortal>
          <DialogBackdrop />
          <DialogPopup className="w-[480px] max-w-[calc(100vw-32px)] p-6">
            <DialogTitle>
              {t(($) => $['newKnowledge.qualityPage.evaluation.dialogTitle'])}
            </DialogTitle>
            <DialogCloseButton />
            <p className="mt-2 system-xs-regular text-text-tertiary">
              {t(($) => $['newKnowledge.qualityPage.evaluation.dialogDescription'])}
            </p>
            <RadioGroup<EvaluationMode>
              aria-label={t(($) => $['newKnowledge.qualityPage.evaluation.modeLabel'])}
              className="mt-5 grid grid-cols-2 gap-2"
              value={mode}
              onValueChange={setMode}
            >
              {(['default', 'fast', 'deep', 'research'] as const).map((candidate) => (
                <RadioItem<EvaluationMode>
                  key={candidate}
                  value={candidate}
                  nativeButton
                  render={
                    <Button
                      type="button"
                      className="justify-start"
                      variant={mode === candidate ? 'secondary' : 'ghost'}
                    />
                  }
                >
                  {t(($) => $[`newKnowledge.qualityPage.evaluation.mode.${candidate}`])}
                </RadioItem>
              ))}
            </RadioGroup>
            <div className="mt-6 flex justify-end gap-2">
              <Button disabled={createMutation.isPending} onClick={() => setDialogOpen(false)}>
                {t(($) => $['newKnowledge.qualityPage.cancel'])}
              </Button>
              <Button
                variant="primary"
                loading={createMutation.isPending}
                disabled={createMutation.isPending}
                onClick={() => void startEvaluation()}
              >
                {t(($) => $['newKnowledge.qualityPage.evaluation.start'])}
              </Button>
            </div>
          </DialogPopup>
        </DialogPortal>
      </Dialog>
    </section>
  )
}
