'use client'

import type { KnowledgeFsTidySummaryResponse } from '@dify/contracts/api/console/knowledge-fs/types.gen'
import type { PlannedAction, RewriteRequest } from './review'
import type { PlanConfirmation } from './review-cards'
import { Button } from '@langgenius/dify-ui/button'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectTrigger,
} from '@langgenius/dify-ui/select'
import { Switch } from '@langgenius/dify-ui/switch'
import { Textarea } from '@langgenius/dify-ui/textarea'
import { ORPCError } from '@orpc/client'
import { useMutation, useQuery } from '@tanstack/react-query'
import { parseAsString, parseAsStringLiteral, useQueryState } from 'nuqs'
import { useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import { consoleQuery } from '@/service/console'
import { getHttpErrorStatus } from '@/service/http-error'
import { useKnowledgeSpace, useKnowledgeSpacePermission } from '../space/context'
import { groupDuplicates, groupPairs, rewriteRefusal } from './review'
import { DuplicateGroupCard, KindSection, PairCard, PairGroupCard } from './review-cards'

const api = consoleQuery.knowledgeFs.spaces.byControlSpaceId.tidy
const STATUSES = ['open', 'dismissed', 'reviewed', 'disabled'] as const
// Exact copies and overlapping documents ask the same question (which one to keep), so they
// share one tab; the API still filters one finding kind at a time.
const KINDS = ['all', 'conflict', 'overlap'] as const
/** Cursor value of a list whose last page was already shown. */
const END = 'end'
type Status = (typeof STATUSES)[number]
type Kind = (typeof KINDS)[number]

/** Documents finished (scanned or given up) out of all current documents. */
function progressOf(summary: KnowledgeFsTidySummaryResponse | undefined) {
  const docs = summary?.documents ?? { pending: 0, scanning: 0, complete: 0, failed: 0 }
  const total = docs.pending + docs.scanning + docs.complete + docs.failed
  const done = docs.complete + docs.failed
  const current = summary?.current ?? null
  // A long document is most of the work: count its scanned passages too.
  const partial =
    current && current.passagesTotal > 0
      ? Math.min(1, current.passagesDone / current.passagesTotal)
      : 0
  return {
    total,
    done,
    percent: total ? Math.min(100, Math.round(((done + partial) / total) * 100)) : 0,
    current,
    active: docs.pending + docs.scanning > 0,
    failed: docs.failed,
  }
}

function countOf(
  summary: KnowledgeFsTidySummaryResponse | undefined,
  status: Status,
  kind: Kind = 'all',
) {
  return (summary?.findings ?? [])
    .filter(
      (row) =>
        row.status === status &&
        (kind === 'all' || (kind === 'overlap' ? row.kind !== 'conflict' : row.kind === kind)),
    )
    .reduce((total, row) => total + row.count, 0)
}

export function TidyPage() {
  const { t } = useTranslation(['knowledgeSpace'])
  const { t: common } = useTranslation(['common'])
  const { space } = useKnowledgeSpace()
  const canManage = useKnowledgeSpacePermission('knowledge_space_edit')
  const params = { control_space_id: space.control_space_id }
  const [status, setStatus] = useQueryState(
    'tidyStatus',
    parseAsStringLiteral(STATUSES).withDefault('open'),
  )
  const [kind, setKind] = useQueryState('tidyKind', parseAsStringLiteral(KINDS).withDefault('all'))
  const [cursor, setCursor] = useQueryState('tidyCursor', parseAsString)
  const [similarCursor, setSimilarCursor] = useQueryState('tidySimilarCursor', parseAsString)
  const [scanCursor, setScanCursor] = useQueryState('tidyScanCursor', parseAsString)
  const [confirmation, setConfirmation] = useState<
    | { kind: 'enable' }
    | { kind: 'conflicts' }
    | ({ kind: 'plan' } & PlanConfirmation)
    | ({ kind: 'rewrite' } & RewriteRequest)
  >()
  const [replacement, setReplacement] = useState('')
  const replacementId = useId()
  const [withConflicts, setWithConflicts] = useState(true)
  const [error, setError] = useState<string>()
  const queueFocusRef = useRef<HTMLButtonElement>(null)
  const restoreQueueFocusRef = useRef(false)
  const settings = useQuery(
    api.settings.get.queryOptions({
      input: { params },
      meta: { errorToast: false },
      refetchInterval: 15000,
    }),
  )
  const summary = useQuery(
    api.summary.get.queryOptions({
      input: { params },
      meta: { errorToast: false },
      refetchInterval: 15000,
    }),
  )
  const findings = useQuery(
    api.findings.get.queryOptions({
      input: {
        params,
        query: {
          status,
          ...(kind === 'all' ? {} : { kind: kind === 'overlap' ? ('duplicate' as const) : kind }),
          ...(cursor ? { cursor } : {}),
        },
      },
      meta: { errorToast: false },
      refetchInterval: 15000,
      enabled: cursor !== END,
    }),
  )
  // The overlap tab pages through exact copies and overlapping documents side by side.
  const similarFindings = useQuery(
    api.findings.get.queryOptions({
      input: {
        params,
        query: {
          status,
          kind: 'similar' as const,
          ...(similarCursor ? { cursor: similarCursor } : {}),
        },
      },
      meta: { errorToast: false },
      refetchInterval: 15000,
      enabled: kind === 'overlap' && similarCursor !== END,
    }),
  )
  const scans = useQuery(
    api.scans.get.queryOptions({
      input: { params, query: scanCursor ? { cursor: scanCursor } : {} },
      meta: { errorToast: false },
      refetchInterval: 15000,
    }),
  )
  const configure = useMutation(api.settings.patch.mutationOptions({ meta: { errorToast: false } }))
  const act = useMutation(
    api.findings.byFindingId.actions.post.mutationOptions({ meta: { errorToast: false } }),
  )
  const retry = useMutation(api.retry.post.mutationOptions({ meta: { errorToast: false } }))
  const pending = configure.isPending || act.isPending || retry.isPending
  const progress = progressOf(summary.data)
  const lastError = settings.data?.enabled ? settings.data.lastError : null

  const rewriteErrors = {
    document_busy: t(($) => $['tidy.rewriteBusy']),
    not_indexed: t(($) => $['tidy.rewriteNotFound']),
    passage_not_found: t(($) => $['tidy.rewriteNotFound']),
    passage_ambiguous: t(($) => $['tidy.rewriteAmbiguous']),
    no_change: t(($) => $['tidy.rewriteNoChange']),
    too_long: t(($) => $['tidy.rewriteTooLong']),
    unsupported: t(($) => $['tidy.rewriteUnavailable']),
  }
  function report(cause: unknown) {
    setError(
      getHttpErrorStatus(cause) === 409 ? t(($) => $['tidy.stale']) : t(($) => $['tidy.error']),
    )
  }
  async function save(enabled: boolean, conflicts: boolean) {
    if (!settings.data) return
    setError(undefined)
    try {
      await configure.mutateAsync({
        params,
        body: {
          enabled,
          conflicts,
          expectedRevision: settings.data.revision,
          // Only conflict detection calls the model; duplicate detection costs nothing.
          acknowledgeTokenUsage: enabled && conflicts,
        },
      })
      setConfirmation(undefined)
    } catch (cause) {
      report(cause)
    }
  }
  /** Runs reviewer actions in order (a keep-one merge disables one copy per finding). */
  async function run(plan: PlannedAction[]) {
    setError(undefined)
    try {
      for (const step of plan) {
        await act.mutateAsync({
          params: { ...params, finding_id: step.finding.id },
          body: {
            action: step.action,
            expectedRevision: step.finding.revision,
            ...(step.documentId ? { documentId: step.documentId } : {}),
          },
        })
      }
      restoreQueueFocusRef.current = true
      if (!confirmation) queueFocusRef.current?.focus({ preventScroll: true })
      setConfirmation(undefined)
    } catch (cause) {
      report(cause)
    }
  }
  /** Rewrites the other document's indexed passage in place and settles the finding. */
  async function adopt(request: RewriteRequest, text: string) {
    setError(undefined)
    try {
      await act.mutateAsync({
        params: { ...params, finding_id: request.finding.id },
        body: {
          action: 'adopt',
          expectedRevision: request.finding.revision,
          documentId: request.keptDocumentId,
          replacement: text,
        },
      })
      restoreQueueFocusRef.current = true
      setConfirmation(undefined)
      toast.success(t(($) => $['tidy.rewriteAccepted'], { title: request.targetTitle }))
    } catch (cause) {
      const refusal = rewriteRefusal(cause instanceof ORPCError ? cause.data : undefined)
      if (refusal) setError(rewriteErrors[refusal])
      else report(cause)
    }
  }
  async function resume() {
    setError(undefined)
    try {
      await retry.mutateAsync({ params })
    } catch (cause) {
      report(cause)
    }
  }
  const statusLabels = {
    open: t(($) => $['tidy.open']),
    dismissed: t(($) => $['tidy.dismissed']),
    reviewed: t(($) => $['tidy.reviewed']),
    disabled: t(($) => $['documentStatus.disabled']),
    outdated: t(($) => $['tidy.outdated']),
  }
  const kindLabels = {
    all: t(($) => $['tidy.allKinds']),
    conflict: t(($) => $['tidy.conflict']),
    overlap: t(($) => $['tidy.overlapKind']),
  }
  const scanLabels = {
    pending: t(($) => $['tidy.pending']),
    scanning: t(($) => $['tidy.scanning']),
    complete: t(($) => $['tidy.complete']),
    failed: t(($) => $['tidy.failed']),
  }
  const pauseReasons = {
    authorization_failed: t(($) => $['tidy.pausedAuthorization']),
    model_unavailable: t(($) => $['tidy.pausedModel']),
    scan_failed: t(($) => $['tidy.pausedScan']),
  }
  const lists = [
    ...(cursor !== END ? [findings] : []),
    ...(kind === 'overlap' && similarCursor !== END ? [similarFindings] : []),
  ]
  const items = lists.flatMap((list) => list.data?.items ?? [])
  const cards = {
    ...(cursor !== END ? findings.data?.documents : undefined),
    ...(kind === 'overlap' && similarCursor !== END ? similarFindings.data?.documents : undefined),
  }
  const hasNext = lists.some((list) => list.data?.nextCursor)
  const resetPaging = () => {
    void setCursor(null)
    void setSimilarCursor(null)
  }
  const conflictPairs = groupPairs(
    items.filter((finding) => finding.status === 'open' && finding.kind !== 'duplicate'),
  ).filter((group) => group.conflicts.length > 0)
  /** The open conflicts between the same two documents as an overlap finding. */
  const conflictsBeside = (finding: (typeof items)[number]) =>
    conflictPairs.find((group) => group.similar?.id === finding.id)?.conflicts ?? []
  const handledConflicts = items.filter(
    (finding) => finding.kind === 'conflict' && finding.status !== 'open',
  )
  const duplicates = items.filter((finding) => finding.kind === 'duplicate')
  // Identical copies awaiting review read best as one group with a keep-one choice.
  const copyGroups = duplicates.every((finding) => finding.status === 'open')
    ? groupDuplicates(duplicates)
    : null
  // The closer two documents are, the more likely one of them can go: most overlap first.
  const similar = items
    .filter((finding) => finding.kind === 'similar')
    .sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0))
  const cardProps = {
    busy: pending,
    canManage,
    cards,
    spaceId: space.control_space_id,
    onConfirm: (plan: PlanConfirmation) => {
      setError(undefined)
      restoreQueueFocusRef.current = false
      setConfirmation({ kind: 'plan', ...plan })
    },
    onRewrite: (request: RewriteRequest) => {
      setError(undefined)
      restoreQueueFocusRef.current = false
      setReplacement(request.replacement)
      setConfirmation({ kind: 'rewrite', ...request })
    },
    onRun: (plan: PlannedAction[]) => void run(plan),
  }

  return (
    <div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-6 py-4">
      <h1 className="title-2xl-semi-bold text-text-primary">{t(($) => $['tidy.name'])}</h1>
      <p className="mt-2 body-sm-regular text-text-tertiary">{t(($) => $['tidy.description'])}</p>
      <div className="my-5 rounded-xl border border-divider-regular p-4">
        <div className="flex items-center justify-between gap-4">
          <span id="tidy-enabled-label" className="system-md-semibold text-text-primary">
            {t(($) => $['tidy.enabled'])}
          </span>
          <Switch
            aria-labelledby="tidy-enabled-label"
            checked={settings.data?.enabled ?? false}
            loading={configure.isPending && !confirmation}
            disabled={!canManage || !settings.data}
            onCheckedChange={(enabled) => {
              setError(undefined)
              if (enabled) {
                restoreQueueFocusRef.current = false
                setWithConflicts(settings.data?.conflicts ?? true)
                setConfirmation({ kind: 'enable' })
              } else void save(false, settings.data?.conflicts ?? true)
            }}
          />
        </div>
        <p className="mt-2 body-sm-regular text-text-tertiary">{t(($) => $['tidy.schedule'])}</p>
        {settings.isPending && <p role="status">{common(($) => $.loading)}</p>}
        {settings.isError && <p role="alert">{t(($) => $['tidy.error'])}</p>}
        {settings.data?.enabled && (
          <div className="mt-4 flex flex-col gap-3 border-t border-divider-subtle pt-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <span id="tidy-conflicts-label" className="system-sm-semibold text-text-secondary">
                  {t(($) => $['tidy.conflicts'])}
                </span>
                <p className="mt-1 body-sm-regular text-text-tertiary">
                  {t(($) => $['tidy.conflictsHint'])}
                </p>
              </div>
              <Switch
                aria-labelledby="tidy-conflicts-label"
                checked={settings.data.conflicts}
                disabled={!canManage || pending}
                onCheckedChange={(conflicts) => {
                  setError(undefined)
                  if (conflicts) {
                    restoreQueueFocusRef.current = false
                    setConfirmation({ kind: 'conflicts' })
                  } else void save(true, false)
                }}
              />
            </div>
            {summary.data && (
              <div className="flex flex-col gap-1.5">
                <p role="status" className="body-sm-regular text-text-secondary">
                  {t(($) => $['tidy.progressSummary'], {
                    done: progress.done,
                    total: progress.total,
                  })}
                  {summary.data.modelCalls > 0 && (
                    <span className="text-text-tertiary">
                      {' · '}
                      {t(($) => $['tidy.modelCalls'], { count: summary.data.modelCalls })}
                    </span>
                  )}
                </p>
                {progress.active && (
                  <div
                    role="progressbar"
                    aria-label={t(($) => $['tidy.progress'])}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={progress.percent}
                    className="h-1 overflow-hidden rounded-full bg-components-progress-bar-bg"
                  >
                    <div
                      className="h-full rounded-full bg-components-progress-bar-progress-solid"
                      style={{ width: `${progress.percent}%` }}
                    />
                  </div>
                )}
                {progress.active && progress.current && progress.current.passagesTotal > 0 && (
                  <p className="truncate body-xs-regular text-text-tertiary tabular-nums">
                    {t(($) => $['tidy.progressCurrent'], {
                      title: progress.current.title,
                      done: progress.current.passagesDone,
                      total: progress.current.passagesTotal,
                    })}
                  </p>
                )}
              </div>
            )}
            {lastError && (
              <div
                role="alert"
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-background-section p-3 text-text-warning"
              >
                <span className="body-sm-regular">{pauseReasons[lastError]}</span>
                {canManage && (
                  <Button size="small" loading={retry.isPending} onClick={() => void resume()}>
                    {common(($) => $['operation.retry'])}
                  </Button>
                )}
              </div>
            )}
            {progress.failed > 0 && (
              <p className="body-sm-regular text-text-warning">
                {t(($) => $['tidy.failedCount'], { count: progress.failed })}
              </p>
            )}
          </div>
        )}
      </div>
      <p className="mb-4 body-sm-regular text-text-tertiary">{t(($) => $['tidy.reviewNotice'])}</p>
      {error && !confirmation && (
        <p role="alert" className="mb-3 text-text-destructive">
          {error}
        </p>
      )}

      <details className="mb-5 rounded-xl border border-divider-regular p-4">
        <summary className="cursor-pointer system-sm-semibold text-text-primary">
          {t(($) => $['tidy.progress'])}
        </summary>
        {scans.isPending && <p role="status">{common(($) => $.loading)}</p>}
        {scans.isError && <p role="alert">{t(($) => $['tidy.error'])}</p>}
        <ul className="my-3 space-y-2">
          {scans.data?.items.map((scan) => (
            <li
              key={scan.documentId}
              className="flex flex-wrap justify-between gap-2 body-sm-regular"
            >
              <span>{scan.title}</span>
              <span>
                {scanLabels[scan.state]} ·{' '}
                {t(($) => $['tidy.usage'], { windows: scan.windows, calls: scan.modelCalls })}
              </span>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          {canManage && (
            <Button
              disabled={!settings.data?.enabled}
              loading={retry.isPending}
              onClick={() => void resume()}
            >
              {common(($) => $['operation.retry'])}
            </Button>
          )}
          {scanCursor && (
            <Button onClick={() => void setScanCursor(null)}>
              {common(($) => $['operation.back'])}
            </Button>
          )}
          {scans.data?.nextCursor && (
            <Button onClick={() => void setScanCursor(scans.data?.nextCursor ?? null)}>
              {common(($) => $['pagination.next'])}
            </Button>
          )}
        </div>
      </details>

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div
          role="group"
          aria-label={t(($) => $['tidy.kindFilter'])}
          className="flex flex-wrap items-center gap-1 rounded-full bg-background-section p-1"
        >
          {KINDS.map((value) => (
            <button
              key={value}
              type="button"
              ref={kind === value ? queueFocusRef : undefined}
              aria-pressed={kind === value}
              onClick={() => {
                void setKind(value)
                resetPaging()
              }}
              className={cn(
                'inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 system-sm-medium outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid',
                kind === value
                  ? 'bg-components-panel-bg text-text-primary shadow-xs'
                  : 'text-text-tertiary hover:text-text-secondary',
              )}
            >
              {kindLabels[value]}
              <span aria-hidden className="text-text-quaternary">
                ·
              </span>
              <span className="system-xs-regular text-text-tertiary tabular-nums">
                {countOf(summary.data, status, value)}
              </span>
            </button>
          ))}
        </div>
        <Select
          value={status}
          onValueChange={(value) => {
            if (!value) return
            void setStatus(value as Status)
            resetPaging()
          }}
        >
          <SelectTrigger aria-label={t(($) => $['tidy.statusFilter'])} className="w-auto min-w-36">
            {statusLabels[status]}
          </SelectTrigger>
          <SelectContent>
            {STATUSES.map((value) => (
              <SelectItem key={value} value={value}>
                <SelectItemText>
                  {statusLabels[value]}
                  {countOf(summary.data, value) > 0 && (
                    <span className="ms-1.5 text-text-tertiary tabular-nums">
                      {countOf(summary.data, value)}
                    </span>
                  )}
                </SelectItemText>
                <SelectItemIndicator />
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {lists.some((list) => list.isPending) && <p role="status">{common(($) => $.loading)}</p>}
      {lists.some((list) => list.isError) && <p role="alert">{t(($) => $['tidy.error'])}</p>}
      {lists.every((list) => list.data) && items.length === 0 && (
        <p className="rounded-2xl bg-background-section p-6 text-text-tertiary">
          {t(($) => $['tidy.empty'])}
        </p>
      )}
      <div aria-label={t(($) => $['tidy.results'])} className="flex flex-col gap-6">
        {kind !== 'overlap' && conflictPairs.length + handledConflicts.length > 0 && (
          <KindSection
            kind="conflict"
            meta={t(($) => $['tidy.pairsMeta'], {
              count: conflictPairs.length + handledConflicts.length,
            })}
          >
            {conflictPairs.map((group) => (
              <PairGroupCard key={group.key} group={group} {...cardProps} />
            ))}
            {handledConflicts.map((finding) => (
              <PairCard key={finding.id} finding={finding} {...cardProps} />
            ))}
          </KindSection>
        )}
        {kind !== 'conflict' && duplicates.length + similar.length > 0 && (
          <KindSection
            kind="overlap"
            meta={[
              ...(copyGroups
                ? [
                    t(($) => $['tidy.groupsMeta'], {
                      count: copyGroups.length,
                      files: copyGroups.reduce(
                        (total, group) => total + group.documentIds.length,
                        0,
                      ),
                    }),
                  ]
                : []),
              ...((copyGroups ? 0 : duplicates.length) + similar.length > 0
                ? [
                    t(($) => $['tidy.pairsMeta'], {
                      count: (copyGroups ? 0 : duplicates.length) + similar.length,
                    }),
                  ]
                : []),
            ].join(' · ')}
          >
            {copyGroups
              ? copyGroups.map((group) => (
                  <DuplicateGroupCard key={group.key} group={group} {...cardProps} />
                ))
              : duplicates.map((finding) => (
                  <PairCard key={finding.id} finding={finding} {...cardProps} />
                ))}
            {similar.map((finding) => (
              <PairCard
                key={finding.id}
                finding={finding}
                related={conflictsBeside(finding)}
                {...cardProps}
              />
            ))}
          </KindSection>
        )}
      </div>
      <div className="my-5 flex gap-2">
        {(cursor || similarCursor) && (
          <Button onClick={resetPaging}>{common(($) => $['operation.back'])}</Button>
        )}
        {hasNext && (
          <Button
            onClick={() => {
              if (cursor !== END) void setCursor(findings.data?.nextCursor ?? END)
              if (kind === 'overlap' && similarCursor !== END)
                void setSimilarCursor(similarFindings.data?.nextCursor ?? END)
            }}
          >
            {common(($) => $['pagination.next'])}
          </Button>
        )}
      </div>

      <Dialog
        open={!!confirmation}
        onOpenChange={(open) => {
          if (!open && !pending) setConfirmation(undefined)
        }}
      >
        <DialogContent
          finalFocus={() => {
            if (!restoreQueueFocusRef.current) return true
            queueFocusRef.current?.focus({ preventScroll: true })
            return false
          }}
        >
          <form
            className="contents"
            onSubmit={(event) => {
              event.preventDefault()
              if (confirmation?.kind === 'enable') void save(true, withConflicts)
              else if (confirmation?.kind === 'conflicts') void save(true, true)
              else if (confirmation?.kind === 'rewrite') void adopt(confirmation, replacement)
              else if (confirmation) void run(confirmation.plan)
            }}
          >
            <DialogHeader>
              <DialogTitle>
                {confirmation?.kind === 'plan'
                  ? confirmation.title
                  : confirmation?.kind === 'rewrite'
                    ? t(($) => $['tidy.rewriteTitle'], { title: confirmation.keptTitle })
                    : confirmation?.kind === 'conflicts'
                      ? t(($) => $['tidy.conflicts'])
                      : t(($) => $['tidy.name'])}
              </DialogTitle>
              <DialogDescription>
                {confirmation?.kind === 'plan'
                  ? confirmation.description
                  : confirmation?.kind === 'rewrite'
                    ? t(($) => $['tidy.rewriteDescription'], { title: confirmation.targetTitle })
                    : confirmation?.kind === 'enable' && !withConflicts
                      ? t(($) => $['tidy.freeNotice'])
                      : t(($) => $['tidy.tokenNotice'])}
              </DialogDescription>
            </DialogHeader>
            {(confirmation?.kind === 'enable' || confirmation?.kind === 'rewrite' || error) && (
              <DialogBody>
                {confirmation?.kind === 'rewrite' && (
                  <div className="flex flex-col gap-3">
                    <div className="flex flex-col gap-1">
                      <span className="system-xs-medium text-text-tertiary">
                        {t(($) => $['tidy.rewriteCurrent'])}
                      </span>
                      <blockquote className="max-h-32 overflow-y-auto rounded-lg bg-background-section px-3 py-2 body-sm-regular wrap-break-word whitespace-pre-wrap text-text-tertiary line-through">
                        {confirmation.passage}
                      </blockquote>
                    </div>
                    <div className="flex flex-col gap-1">
                      <label
                        htmlFor={replacementId}
                        className="system-xs-medium text-text-tertiary"
                      >
                        {t(($) => $['tidy.rewriteReplacement'])}
                      </label>
                      <Textarea
                        id={replacementId}
                        value={replacement}
                        rows={4}
                        maxLength={8000}
                        onValueChange={setReplacement}
                      />
                    </div>
                  </div>
                )}
                {confirmation?.kind === 'enable' && (
                  <label className="flex items-start gap-2 body-sm-regular text-text-secondary">
                    <Checkbox
                      checked={withConflicts}
                      onCheckedChange={(checked) => setWithConflicts(checked === true)}
                    />
                    {t(($) => $['tidy.consentConflicts'])}
                  </label>
                )}
                {error && (
                  <p role="alert" className="text-text-destructive">
                    {error}
                  </p>
                )}
              </DialogBody>
            )}
            <DialogFooter>
              <Button type="button" disabled={pending} onClick={() => setConfirmation(undefined)}>
                {common(($) => $['operation.cancel'])}
              </Button>
              <Button
                type="submit"
                variant="primary"
                loading={pending}
                disabled={confirmation?.kind === 'rewrite' && !replacement.trim()}
              >
                {confirmation?.kind === 'rewrite'
                  ? t(($) => $['tidy.rewriteConfirm'])
                  : common(($) => $['operation.confirm'])}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
