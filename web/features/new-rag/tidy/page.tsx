'use client'

import type {
  KnowledgeFsTidyFindingResponse,
  KnowledgeFsTidySummaryResponse,
} from '@dify/contracts/api/console/knowledge-fs/types.gen'
import { Button } from '@langgenius/dify-ui/button'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { Switch } from '@langgenius/dify-ui/switch'
import { useMutation, useQuery } from '@tanstack/react-query'
import { parseAsString, parseAsStringLiteral, useQueryState } from 'nuqs'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Link from '@/next/link'
import { consoleQuery } from '@/service/console'
import { getHttpErrorStatus } from '@/service/http-error'
import { newKnowledgeDocumentDetailPath } from '../routes'
import { useKnowledgeSpace, useKnowledgeSpacePermission } from '../space/context'

const api = consoleQuery.knowledgeFs.spaces.byControlSpaceId.tidy
type Finding = KnowledgeFsTidyFindingResponse
const STATUSES = ['open', 'dismissed', 'reviewed', 'disabled'] as const
const KINDS = ['all', 'conflict', 'similar', 'duplicate'] as const
type Status = (typeof STATUSES)[number]
type Kind = (typeof KINDS)[number]

/** Documents finished (scanned or given up) out of all current documents. */
function progressOf(summary: KnowledgeFsTidySummaryResponse | undefined) {
  const docs = summary?.documents ?? { pending: 0, scanning: 0, complete: 0, failed: 0 }
  const total = docs.pending + docs.scanning + docs.complete + docs.failed
  return {
    total,
    done: docs.complete + docs.failed,
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
    .filter((row) => row.status === status && (kind === 'all' || row.kind === kind))
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
  const [scanCursor, setScanCursor] = useQueryState('tidyScanCursor', parseAsString)
  const [confirmation, setConfirmation] = useState<
    | { kind: 'enable' }
    | { kind: 'conflicts' }
    | { kind: 'disable'; finding: Finding; documentId: string; title: string }
  >()
  const [withConflicts, setWithConflicts] = useState(true)
  const [error, setError] = useState<string>()
  const queueFocusRef = useRef<HTMLButtonElement>(null)
  const restoreQueueFocusRef = useRef(false)
  const settings = useQuery(
    api.settings.get.queryOptions({
      input: { params },
      context: { silent: true },
      refetchInterval: 15000,
    }),
  )
  const summary = useQuery(
    api.summary.get.queryOptions({
      input: { params },
      context: { silent: true },
      refetchInterval: 15000,
    }),
  )
  const findings = useQuery(
    api.findings.get.queryOptions({
      input: {
        params,
        query: {
          status,
          ...(kind === 'all' ? {} : { kind }),
          ...(cursor ? { cursor } : {}),
        },
      },
      context: { silent: true },
      refetchInterval: 15000,
    }),
  )
  const scans = useQuery(
    api.scans.get.queryOptions({
      input: { params, query: scanCursor ? { cursor: scanCursor } : {} },
      context: { silent: true },
      refetchInterval: 15000,
    }),
  )
  const configure = useMutation(api.settings.patch.mutationOptions({ context: { silent: true } }))
  const act = useMutation(
    api.findings.byFindingId.actions.post.mutationOptions({ context: { silent: true } }),
  )
  const retry = useMutation(api.retry.post.mutationOptions({ context: { silent: true } }))
  const pending = configure.isPending || act.isPending || retry.isPending
  const progress = progressOf(summary.data)
  const lastError = settings.data?.enabled ? settings.data.lastError : null

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
  async function apply(
    finding: Finding,
    action: 'dismiss' | 'review' | 'disable_document' | 'undo',
    documentId?: string,
  ) {
    setError(undefined)
    try {
      await act.mutateAsync({
        params: { ...params, finding_id: finding.id },
        body: { action, expectedRevision: finding.revision, ...(documentId ? { documentId } : {}) },
      })
      restoreQueueFocusRef.current = true
      if (!confirmation) queueFocusRef.current?.focus({ preventScroll: true })
      setConfirmation(undefined)
    } catch (cause) {
      report(cause)
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
    duplicate: t(($) => $['tidy.duplicate']),
    similar: t(($) => $['tidy.similar']),
    conflict: t(($) => $['tidy.conflict']),
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
  function reasonOf(finding: Finding) {
    if (finding.reason === 'identical_content_hash') return t(($) => $['tidy.duplicateReason'])
    if (finding.reason === 'textual_overlap') return t(($) => $['tidy.similarReason'])
    if (finding.reason === 'semantic_overlap') return t(($) => $['tidy.semanticReason'])
    return finding.reason
  }
  function similarityOf(finding: Finding) {
    if (finding.kind !== 'similar' || finding.similarity === null) return null
    const percent = Math.round(finding.similarity * 100)
    return finding.reason === 'semantic_overlap'
      ? t(($) => $['tidy.semanticCoverage'], { percent })
      : t(($) => $['tidy.overlap'], { percent })
  }

  return (
    <div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-6 py-4">
      <h1 className="title-2xl-semi-bold text-text-primary">Tidy</h1>
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

      <nav aria-label={t(($) => $['tidy.results'])} className="mb-3 flex flex-wrap gap-2">
        {STATUSES.map((value) => (
          <Button
            key={value}
            ref={status === value ? queueFocusRef : undefined}
            aria-pressed={status === value}
            variant={status === value ? 'primary' : 'secondary'}
            onClick={() => {
              void setStatus(value)
              void setCursor(null)
            }}
          >
            {statusLabels[value]}
            {countOf(summary.data, value) > 0 && <span> {countOf(summary.data, value)}</span>}
          </Button>
        ))}
      </nav>
      <div
        role="group"
        aria-label={t(($) => $['tidy.kindFilter'])}
        className="mb-4 flex flex-wrap gap-1"
      >
        {KINDS.map((value) => (
          <Button
            key={value}
            size="small"
            aria-pressed={kind === value}
            variant={kind === value ? 'secondary-accent' : 'ghost'}
            onClick={() => {
              void setKind(value)
              void setCursor(null)
            }}
          >
            {kindLabels[value]} {countOf(summary.data, status, value)}
          </Button>
        ))}
      </div>
      {findings.isPending && <p role="status">{common(($) => $.loading)}</p>}
      {findings.isError && <p role="alert">{t(($) => $['tidy.error'])}</p>}
      {findings.data?.items.length === 0 && (
        <p className="rounded-xl bg-background-section p-6 text-text-tertiary">
          {t(($) => $['tidy.empty'])}
        </p>
      )}
      <div className="space-y-4">
        {findings.data?.items.map((finding) => (
          <article key={finding.id} className="rounded-xl border border-divider-regular p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="system-md-semibold text-text-primary">
                {kindLabels[finding.kind]}
                {similarityOf(finding) && (
                  <span className="ms-2 body-sm-regular text-text-tertiary">
                    {similarityOf(finding)}
                  </span>
                )}
              </h2>
              <span className="body-sm-regular text-text-tertiary">
                {statusLabels[finding.status]}
              </span>
            </div>
            <p className="my-3 body-sm-regular text-text-secondary">{reasonOf(finding)}</p>
            <div className="grid gap-3 lg:grid-cols-2">
              {[finding.left, finding.right].map((evidence) => (
                <div
                  key={evidence.documentId}
                  className="min-w-0 rounded-lg bg-background-section p-4"
                >
                  <Link
                    className="system-sm-semibold text-text-accent underline focus-visible:outline-2"
                    href={newKnowledgeDocumentDetailPath(
                      space.control_space_id,
                      evidence.documentId,
                      { revision: evidence.revision, chunkId: evidence.chunkId },
                    )}
                  >
                    {evidence.title} · v{evidence.revision}
                  </Link>
                  <blockquote className="my-3 max-h-72 overflow-auto body-sm-regular break-words whitespace-pre-wrap text-text-secondary">
                    {evidence.text}
                  </blockquote>
                  {canManage && finding.status === 'open' && (
                    <Button
                      disabled={finding.stale || pending}
                      onClick={() => {
                        setError(undefined)
                        restoreQueueFocusRef.current = false
                        setConfirmation({
                          kind: 'disable',
                          finding,
                          documentId: evidence.documentId,
                          title: evidence.title,
                        })
                      }}
                    >
                      {t(($) => $['tidy.disableDocument'])} {evidence.title}
                    </Button>
                  )}
                </div>
              ))}
            </div>
            {finding.stale && <p className="mt-3 text-text-warning">{t(($) => $['tidy.stale'])}</p>}
            {canManage && finding.status !== 'outdated' && (
              <div className="mt-4 flex flex-wrap gap-2">
                {finding.status === 'open' ? (
                  <>
                    <Button
                      disabled={finding.stale || pending}
                      onClick={() => void apply(finding, 'dismiss')}
                    >
                      {t(($) => $['tidy.dismiss'])}
                    </Button>
                    <Button
                      disabled={finding.stale || pending}
                      onClick={() => void apply(finding, 'review')}
                    >
                      {t(($) => $['tidy.review'])}
                    </Button>
                  </>
                ) : (
                  <Button
                    disabled={finding.stale || pending}
                    onClick={() => void apply(finding, 'undo')}
                  >
                    {t(($) => $['tidy.undo'])}
                  </Button>
                )}
              </div>
            )}
          </article>
        ))}
      </div>
      <div className="my-5 flex gap-2">
        {cursor && (
          <Button onClick={() => void setCursor(null)}>{common(($) => $['operation.back'])}</Button>
        )}
        {findings.data?.nextCursor && (
          <Button onClick={() => void setCursor(findings.data?.nextCursor ?? null)}>
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
              else if (confirmation)
                void apply(confirmation.finding, 'disable_document', confirmation.documentId)
            }}
          >
            <DialogHeader>
              <DialogTitle>
                {confirmation?.kind === 'disable'
                  ? `${t(($) => $['tidy.disableDocument'])} ${confirmation.title}`
                  : confirmation?.kind === 'conflicts'
                    ? t(($) => $['tidy.conflicts'])
                    : 'Tidy'}
              </DialogTitle>
              <DialogDescription>
                {confirmation?.kind === 'disable'
                  ? t(($) => $['tidy.disableNotice'])
                  : confirmation?.kind === 'enable' && !withConflicts
                    ? t(($) => $['tidy.freeNotice'])
                    : t(($) => $['tidy.tokenNotice'])}
              </DialogDescription>
            </DialogHeader>
            {(confirmation?.kind === 'enable' || error) && (
              <DialogBody>
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
              <Button type="submit" variant="primary" loading={pending}>
                {common(($) => $['operation.confirm'])}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
