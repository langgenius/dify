'use client'

import type {
  GetKnowledgeSpacesByIdSourcesBySourceIdSyncPolicyResponse,
  GetKnowledgeSpacesByIdSourceWorkflowsByRunIdPagesResponse,
  PutKnowledgeSpacesByIdSourcesBySourceIdSyncPolicyData,
  Source,
  SourceWorkflowRun,
} from '@dify/contracts/knowledge-fs/types.gen'
import type { FormEvent } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useRouter } from '@/next/navigation'
import { consoleClient, consoleQuery } from '@/service/client'
import { newKnowledgeDetailPath } from './routes'

type PreviewPage = GetKnowledgeSpacesByIdSourceWorkflowsByRunIdPagesResponse['items'][number]
type SyncPolicy = GetKnowledgeSpacesByIdSourcesBySourceIdSyncPolicyResponse
type SyncMode = SyncPolicy['mode']
type SyncPolicyBody = PutKnowledgeSpacesByIdSourcesBySourceIdSyncPolicyData['body']

const MIN_CUSTOM_INTERVAL_HOURS = 1
const MAX_CUSTOM_INTERVAL_HOURS = 720

type PageSkipReason = 'failed' | 'off-domain'

function requestStatus(error: unknown) {
  if (error instanceof Response) return error.status
  if (!error || typeof error !== 'object') return undefined
  if ('status' in error && typeof error.status === 'number') return error.status
  if ('data' in error && error.data && typeof error.data === 'object' && 'status' in error.data)
    return typeof error.data.status === 'number' ? error.data.status : undefined
}

function isDefinitiveRequestFailure(error: unknown) {
  const status = requestStatus(error)
  return status !== undefined && [400, 401, 403, 404, 409, 422, 429].includes(status)
}

function pageSkipReason(page: PreviewPage, rootUrl: string): PageSkipReason | undefined {
  try {
    const root = new URL(rootUrl)
    const candidate = new URL(page.sourceUrl)
    if (
      !['http:', 'https:'].includes(candidate.protocol) ||
      candidate.username ||
      candidate.password
    )
      return 'failed'
    if (candidate.hostname.toLocaleLowerCase() !== root.hostname.toLocaleLowerCase())
      return 'off-domain'
    return undefined
  } catch {
    return 'failed'
  }
}

function policyConfiguration(mode: SyncMode, customIntervalHours: number) {
  if (mode === 'manual') return { enabled: false, mode } as const
  if (mode === 'custom') {
    return {
      customIntervalSeconds: customIntervalHours * 3600,
      enabled: true,
      mode,
    } as const
  }
  return { enabled: true, mode } as const
}

function policyMatches(policy: SyncPolicy, desired: ReturnType<typeof policyConfiguration>) {
  return (
    policy.enabled === desired.enabled &&
    policy.mode === desired.mode &&
    (desired.mode !== 'custom' || policy.customIntervalSeconds === desired.customIntervalSeconds)
  )
}

function PolicyLoading() {
  const { t } = useTranslation('dataset')
  return (
    <div
      role="status"
      aria-label={t(($) => $['newKnowledge.loadingSyncPolicy'])}
      className="space-y-3"
    >
      <div className="h-6 w-28 animate-pulse rounded bg-background-section" />
      <div className="h-9 w-full animate-pulse rounded-lg bg-background-section" />
      <div className="h-8 w-full animate-pulse rounded-lg bg-background-section" />
    </div>
  )
}

function ReadyCrawlSelectionForm({
  busy,
  knowledgeSpaceId,
  onCancel,
  onRecrawl,
  onSubmissionUncertainChange,
  onSubmitted,
  onWorkflowPending,
  onWorkflowRun,
  pages,
  policy,
  rootUrl,
  run,
  source,
  workflowUncertain,
}: {
  busy: boolean
  knowledgeSpaceId: string
  onCancel: () => void
  onRecrawl: () => void
  onSubmissionUncertainChange: (uncertain: boolean) => void
  onSubmitted: () => Promise<void> | void
  onWorkflowPending: (request: Promise<SourceWorkflowRun | undefined>) => void
  onWorkflowRun: (run: SourceWorkflowRun) => void
  pages: PreviewPage[]
  policy: SyncPolicy
  rootUrl: string
  run: SourceWorkflowRun
  source: Source
  workflowUncertain: boolean
}) {
  const { t } = useTranslation('dataset')
  const router = useRouter()
  const queryClient = useQueryClient()
  const customIntervalErrorId = 'crawl-custom-interval-error'
  const pageSkipReasons = useMemo(
    () => new Map(pages.map((page) => [page.pageId, pageSkipReason(page, rootUrl)])),
    [pages, rootUrl],
  )
  const selectablePages = useMemo(
    () => pages.filter((page) => !pageSkipReasons.get(page.pageId)),
    [pageSkipReasons, pages],
  )
  const selectablePageIds = useMemo(
    () => new Set(selectablePages.map((page) => page.pageId)),
    [selectablePages],
  )
  const [selectedPageIds, setSelectedPageIds] = useState<Set<string>>(() => new Set())
  const [syncMode, setSyncMode] = useState<SyncMode>(policy.enabled ? policy.mode : 'manual')
  const [customIntervalHours, setCustomIntervalHours] = useState<number | ''>(
    policy.customIntervalSeconds ? policy.customIntervalSeconds / 3600 : MIN_CUSTOM_INTERVAL_HOURS,
  )
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(false)
  const [submissionUncertain, setSubmissionUncertain] = useState(false)
  const policySnapshotRef = useRef(policy)
  const submissionPendingRef = useRef(false)
  const selectionRequestRef = useRef<{ fingerprint: string; requestId: string } | undefined>(
    undefined,
  )
  const updatePolicy = useMutation(
    consoleQuery.knowledgeFs.putKnowledgeSpacesByIdSourcesBySourceIdSyncPolicy.mutationOptions(),
  )
  const selectPages = useMutation(
    consoleQuery.knowledgeFs.postKnowledgeSpacesByIdSourceWorkflowsByRunIdSelection.mutationOptions(),
  )
  const allSelected =
    selectablePages.length > 0 && selectablePages.every((page) => selectedPageIds.has(page.pageId))
  const someSelected = selectedPageIds.size > 0
  const customIntervalValid =
    typeof customIntervalHours === 'number' &&
    Number.isInteger(customIntervalHours) &&
    customIntervalHours >= MIN_CUSTOM_INTERVAL_HOURS &&
    customIntervalHours <= MAX_CUSTOM_INTERVAL_HOURS
  const canSubmit = selectedPageIds.size > 0 && (syncMode !== 'custom' || customIntervalValid)
  const formBusy = busy || submitting
  const submissionLocked = formBusy || submissionUncertain
  const selectionLocked = submissionLocked || workflowUncertain
  const updateSubmissionUncertain = (uncertain: boolean) => {
    setSubmissionUncertain(uncertain)
    onSubmissionUncertainChange(uncertain)
  }

  const togglePage = (pageId: string) => {
    if (!selectablePageIds.has(pageId) || submissionPendingRef.current || submissionUncertain)
      return
    setSelectedPageIds((current) => {
      const next = new Set(current)
      if (next.has(pageId)) next.delete(pageId)
      else next.add(pageId)
      return next
    })
    setSubmitError(false)
  }

  const toggleAll = () => {
    if (submissionPendingRef.current || submissionUncertain) return
    setSelectedPageIds(allSelected ? new Set() : new Set(selectablePageIds))
    setSubmitError(false)
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canSubmit || busy || submissionPendingRef.current) return
    submissionPendingRef.current = true
    setSubmitting(true)
    setSubmitError(false)
    const desiredPolicy = policyConfiguration(
      syncMode,
      typeof customIntervalHours === 'number' ? customIntervalHours : 0,
    )
    const sortedPageIds = [...selectedPageIds].sort()
    const fingerprint = JSON.stringify({ pageIds: sortedPageIds, policy: desiredPolicy })
    if (submissionUncertain && selectionRequestRef.current?.fingerprint !== fingerprint) {
      submissionPendingRef.current = false
      setSubmitting(false)
      setSubmitError(true)
      return
    }
    if (selectionRequestRef.current?.fingerprint !== fingerprint) {
      selectionRequestRef.current = {
        fingerprint,
        requestId: globalThis.crypto.randomUUID(),
      }
    }

    try {
      let currentPolicy = policySnapshotRef.current
      if (!policyMatches(currentPolicy, desiredPolicy)) {
        const body: SyncPolicyBody = {
          ...desiredPolicy,
          expectedRevision: currentPolicy.revision,
          expectedSourceVersion: currentPolicy.expectedSourceVersion,
        }
        try {
          currentPolicy = await updatePolicy.mutateAsync({
            body,
            params: { id: knowledgeSpaceId, sourceId: source.id },
          })
        } catch (error) {
          let reconciled: SyncPolicy
          try {
            reconciled =
              await consoleClient.knowledgeFs.getKnowledgeSpacesByIdSourcesBySourceIdSyncPolicy({
                params: { id: knowledgeSpaceId, sourceId: source.id },
              })
          } catch (reconciliationError) {
            if (!isDefinitiveRequestFailure(error)) updateSubmissionUncertain(true)
            throw reconciliationError
          }
          policySnapshotRef.current = reconciled
          if (!policyMatches(reconciled, desiredPolicy)) {
            if (!isDefinitiveRequestFailure(error)) updateSubmissionUncertain(true)
            throw error
          }
          currentPolicy = reconciled
        }
        policySnapshotRef.current = currentPolicy
      }

      try {
        const selectionRequest = selectPages.mutateAsync({
          body: { pageIds: sortedPageIds },
          headers: { 'Idempotency-Key': selectionRequestRef.current.requestId },
          params: { id: knowledgeSpaceId, runId: run.id },
        })
        onWorkflowPending(
          selectionRequest.then((selectionRun) => selectionRun).catch(() => undefined),
        )
        const selectionRun = await selectionRequest
        onWorkflowRun(selectionRun)
      } catch (error) {
        updateSubmissionUncertain(!isDefinitiveRequestFailure(error))
        throw error
      }
      updateSubmissionUncertain(true)
      await queryClient.invalidateQueries({
        queryKey: consoleQuery.knowledgeFs.getKnowledgeSpacesByIdSources.key(),
      })
      await onSubmitted()
      router.push(newKnowledgeDetailPath(knowledgeSpaceId))
    } catch {
      setSubmitError(true)
    } finally {
      submissionPendingRef.current = false
      setSubmitting(false)
    }
  }

  return (
    <form className="space-y-4" onSubmit={(event) => void submit(event)}>
      <section aria-labelledby="crawl-selection-summary">
        <div className="flex flex-wrap items-center gap-2">
          <h3
            id="crawl-selection-summary"
            role="status"
            aria-live="polite"
            className="min-w-0 flex-1 truncate system-xs-semibold text-text-primary"
          >
            {t(($) => $['newKnowledge.pagesCrawled'], {
              count: pages.length,
              host: new URL(rootUrl).host,
            })}
          </h3>
          <span className="system-xs-regular text-text-tertiary">
            {t(($) => $['newKnowledge.pagesSelected'], { count: selectedPageIds.size })}
          </span>
          {run.progressFailed > 0 && (
            <span className="system-xs-regular text-text-destructive">
              {run.progressFailed} {t(($) => $['newKnowledge.skippedFailed'])}
            </span>
          )}
          <Button
            type="button"
            variant="tertiary"
            size="small"
            disabled={submissionLocked}
            loading={busy}
            onClick={onRecrawl}
          >
            {t(($) => $['newKnowledge.reCrawl'])}
          </Button>
        </div>
        <div className="mt-3 overflow-hidden rounded-xl border border-divider-regular">
          <label className="flex cursor-pointer items-center gap-2.5 border-b border-divider-subtle bg-background-section px-3 py-2.5 system-xs-medium text-text-secondary">
            <Checkbox
              checked={allSelected}
              indeterminate={someSelected && !allSelected}
              onCheckedChange={toggleAll}
              disabled={!selectablePages.length || selectionLocked}
            />
            {t(($) => $['newKnowledge.selectAll'])}
          </label>
          <ul className="max-h-[280px] divide-y divide-divider-subtle overflow-y-auto">
            {pages.map((page) => {
              const skipReason = pageSkipReasons.get(page.pageId)
              const selectable = !skipReason
              return (
                <li key={page.pageId}>
                  <label className="flex cursor-pointer items-center gap-2.5 px-3 py-2.5">
                    <Checkbox
                      checked={selectedPageIds.has(page.pageId)}
                      disabled={!selectable || selectionLocked}
                      onCheckedChange={() => togglePage(page.pageId)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate system-xs-medium text-text-primary">
                        {page.title || page.sourceUrl}
                      </span>
                      <span
                        aria-hidden
                        className="block truncate system-2xs-regular text-text-tertiary"
                      >
                        {page.sourceUrl}
                      </span>
                    </span>
                    {!selectable && (
                      <span aria-hidden className="shrink-0 system-xs-medium text-text-tertiary">
                        {skipReason === 'off-domain'
                          ? t(($) => $['newKnowledge.skippedOffDomain'])
                          : t(($) => $['newKnowledge.skippedFailed'])}
                      </span>
                    )}
                  </label>
                </li>
              )
            })}
          </ul>
        </div>
      </section>

      <fieldset disabled={selectionLocked}>
        <label className="block">
          <span className="system-xs-medium text-text-secondary">
            {t(($) => $['newKnowledge.syncPolicy'])}
          </span>
          <select
            value={syncMode}
            onChange={(event) => {
              setSyncMode(event.target.value as SyncMode)
              setSubmitError(false)
            }}
            className="mt-1.5 h-9 w-full rounded-lg border-0 bg-components-input-bg-normal px-3 system-sm-regular text-text-primary outline-hidden focus:ring-2 focus:ring-state-accent-solid sm:w-72"
          >
            <option value="provider">{t(($) => $['newKnowledge.syncPolicyProvider'])}</option>
            <option value="manual">{t(($) => $['newKnowledge.syncPolicyManual'])}</option>
            <option value="interval">{t(($) => $['newKnowledge.syncPolicyDaily'])}</option>
            <option value="custom">{t(($) => $['newKnowledge.syncPolicyCustom'])}</option>
          </select>
        </label>
        {syncMode === 'custom' && (
          <label className="mt-3 block sm:w-72">
            <span className="system-xs-medium text-text-secondary">
              {t(($) => $['newKnowledge.customIntervalHours'])}
            </span>
            <input
              type="number"
              min={MIN_CUSTOM_INTERVAL_HOURS}
              max={MAX_CUSTOM_INTERVAL_HOURS}
              step={1}
              value={customIntervalHours}
              aria-invalid={!customIntervalValid}
              aria-describedby={!customIntervalValid ? customIntervalErrorId : undefined}
              onChange={(event) => {
                setCustomIntervalHours(
                  Number.isFinite(event.target.valueAsNumber) ? event.target.valueAsNumber : '',
                )
                setSubmitError(false)
              }}
              className="mt-1.5 h-9 w-full rounded-lg border-0 bg-components-input-bg-normal px-3 system-sm-regular text-text-primary outline-hidden focus:ring-2 focus:ring-state-accent-solid"
            />
            {!customIntervalValid && (
              <span
                id={customIntervalErrorId}
                className="mt-1 block system-xs-regular text-text-destructive"
              >
                {t(($) => $['newKnowledge.customIntervalInvalid'])}
              </span>
            )}
          </label>
        )}
      </fieldset>

      {submitError && (
        <p role="alert" className="system-xs-regular text-text-destructive">
          {t(($) => $['newKnowledge.addSourceFailed'])}
        </p>
      )}
      <div className="flex justify-end gap-2 border-t border-divider-subtle pt-5">
        <Button type="button" disabled={submissionLocked} onClick={onCancel}>
          {t(($) => $['newKnowledge.cancelAddSource'])}
        </Button>
        <Button
          type="submit"
          variant="primary"
          disabled={!canSubmit || formBusy || workflowUncertain}
          loading={submitting}
          aria-describedby={!selectedPageIds.size ? 'add-source-selection-requirement' : undefined}
        >
          {t(($) => $['newKnowledge.addSource'])}
        </Button>
        {!selectedPageIds.size && (
          <span id="add-source-selection-requirement" className="sr-only">
            {t(($) => $['newKnowledge.addSourceRequiresSelection'])}
          </span>
        )}
      </div>
    </form>
  )
}

export function CrawlSelectionForm({
  busy = false,
  knowledgeSpaceId,
  onCancel,
  onRecrawl,
  onSubmissionUncertainChange,
  onSubmitted,
  onWorkflowPending,
  onWorkflowRun,
  pages,
  rootUrl,
  run,
  source,
  workflowUncertain = false,
}: {
  busy?: boolean
  knowledgeSpaceId: string
  onCancel: () => void
  onRecrawl: () => void
  onSubmissionUncertainChange: (uncertain: boolean) => void
  onSubmitted: () => Promise<void> | void
  onWorkflowPending: (request: Promise<SourceWorkflowRun | undefined>) => void
  onWorkflowRun: (run: SourceWorkflowRun) => void
  pages: PreviewPage[]
  rootUrl: string
  run: SourceWorkflowRun
  source: Source
  workflowUncertain?: boolean
}) {
  const { t } = useTranslation('dataset')
  const policyQuery = useQuery(
    consoleQuery.knowledgeFs.getKnowledgeSpacesByIdSourcesBySourceIdSyncPolicy.queryOptions({
      input: { params: { id: knowledgeSpaceId, sourceId: source.id } },
      retry: false,
    }),
  )

  if (policyQuery.isPending) return <PolicyLoading />
  if (policyQuery.error || !policyQuery.data) {
    return (
      <div className="space-y-4">
        <div role="alert" className="rounded-xl border border-divider-regular p-4">
          <p className="system-xs-regular text-text-destructive">
            {t(($) => $['newKnowledge.syncPolicyLoadFailed'])}
          </p>
          <Button className="mt-3" onClick={() => void policyQuery.refetch()}>
            {t(($) => $['newKnowledge.retrySyncPolicy'])}
          </Button>
        </div>
        <div className="flex justify-end gap-2 border-t border-divider-subtle pt-5">
          <Button type="button" onClick={onCancel}>
            {t(($) => $['newKnowledge.cancelAddSource'])}
          </Button>
          <Button type="button" variant="primary" disabled>
            {t(($) => $['newKnowledge.addSource'])}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <ReadyCrawlSelectionForm
      key={`${run.id}:${policyQuery.data.revision}`}
      busy={busy}
      knowledgeSpaceId={knowledgeSpaceId}
      onCancel={onCancel}
      onRecrawl={onRecrawl}
      onSubmissionUncertainChange={onSubmissionUncertainChange}
      onSubmitted={onSubmitted}
      onWorkflowPending={onWorkflowPending}
      onWorkflowRun={onWorkflowRun}
      pages={pages}
      policy={policyQuery.data}
      rootUrl={rootUrl}
      run={run}
      source={source}
      workflowUncertain={workflowUncertain}
    />
  )
}
