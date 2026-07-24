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
import { useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useRouter } from '@/next/navigation'
import { consoleClient, consoleQuery } from '@/service/client'
import { createRequestId } from './request-id'
import { newKnowledgeDetailPath } from './routes'

type PreviewPage = GetKnowledgeSpacesByIdSourceWorkflowsByRunIdPagesResponse['items'][number]
type SyncPolicy = GetKnowledgeSpacesByIdSourcesBySourceIdSyncPolicyResponse
type SyncMode = SyncPolicy['mode']
type SyncPolicyBody = PutKnowledgeSpacesByIdSourcesBySourceIdSyncPolicyData['body']

const MIN_CUSTOM_INTERVAL_HOURS = 1
const MAX_CUSTOM_INTERVAL_HOURS = 720
const MAX_SELECTED_PAGES = 200
const IMPORT_POLL_INTERVAL_MS = 1_000
const IMPORT_POLL_ATTEMPTS = 120
const SUCCESSFUL_IMPORT_STATES = new Set(['complete', 'completed', 'success', 'succeeded'])
const TERMINAL_IMPORT_STATES = new Set([
  ...SUCCESSFUL_IMPORT_STATES,
  'canceled',
  'cancelled',
  'error',
  'exhausted',
  'failed',
  'superseded',
  'timed_out',
  'timeout',
  'zero_results',
])

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

function normalizedWorkflowState(run: SourceWorkflowRun) {
  return run.state.trim().toLowerCase().replaceAll('-', '_').replaceAll(' ', '_')
}

function isSuccessfulImport(run: SourceWorkflowRun) {
  return SUCCESSFUL_IMPORT_STATES.has(normalizedWorkflowState(run))
}

function isTerminalImport(run: SourceWorkflowRun) {
  return TERMINAL_IMPORT_STATES.has(normalizedWorkflowState(run))
}

async function waitForImportTerminal(
  knowledgeSpaceId: string,
  initialRun: SourceWorkflowRun,
  onWorkflowRun: (run: SourceWorkflowRun) => void,
  discardRequested: () => boolean,
) {
  let current = initialRun
  for (let attempt = 0; attempt < IMPORT_POLL_ATTEMPTS; attempt += 1) {
    if (discardRequested() || isTerminalImport(current)) return current
    current = await consoleClient.knowledgeFs.getKnowledgeSpacesByIdSourceWorkflowsByRunId({
      params: { id: knowledgeSpaceId, runId: current.id },
    })
    onWorkflowRun(current)
    if (discardRequested() || isTerminalImport(current)) return current
    await new Promise((resolve) => setTimeout(resolve, IMPORT_POLL_INTERVAL_MS))
  }
  throw new Error('Source import did not reach a terminal state')
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
    policy.revision > 0 &&
    policy.enabled === desired.enabled &&
    policy.mode === desired.mode &&
    (desired.mode !== 'custom' || policy.customIntervalSeconds === desired.customIntervalSeconds)
  )
}

function initialSyncPolicy(source: Source): SyncPolicy | undefined {
  if (!source.version) return undefined
  return {
    createdAt: source.createdAt,
    enabled: true,
    expectedSourceVersion: source.version,
    id: source.id,
    knowledgeSpaceId: source.knowledgeSpaceId,
    mode: 'provider',
    revision: 0,
    sourceId: source.id,
    updatedAt: source.updatedAt,
  }
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
  discardRequested,
  initialSyncMode,
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
  discardRequested: () => boolean
  initialSyncMode?: SyncMode
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
  const pageDescriptionPrefixId = useId()
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
  const bulkSelectablePages = selectablePages.slice(0, MAX_SELECTED_PAGES)
  const [selectedPageIds, setSelectedPageIds] = useState<Set<string>>(() => new Set())
  const [syncMode, setSyncMode] = useState<SyncMode>(
    initialSyncMode ?? (policy.enabled ? policy.mode : 'manual'),
  )
  const [customIntervalHours, setCustomIntervalHours] = useState<number | ''>(
    policy.customIntervalSeconds ? policy.customIntervalSeconds / 3600 : MIN_CUSTOM_INTERVAL_HOURS,
  )
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(false)
  const [policyUncertain, setPolicyUncertain] = useState(false)
  const [selectionUncertain, setSelectionUncertain] = useState(false)
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
    bulkSelectablePages.length > 0 &&
    bulkSelectablePages.every((page) => selectedPageIds.has(page.pageId))
  const someSelected = selectedPageIds.size > 0
  const selectionAtLimit = selectedPageIds.size >= MAX_SELECTED_PAGES
  const customIntervalValid =
    typeof customIntervalHours === 'number' &&
    Number.isInteger(customIntervalHours) &&
    customIntervalHours >= MIN_CUSTOM_INTERVAL_HOURS &&
    customIntervalHours <= MAX_CUSTOM_INTERVAL_HOURS
  const canSubmit = selectedPageIds.size > 0 && (syncMode !== 'custom' || customIntervalValid)
  const formBusy = busy || submitting
  const submissionLocked = formBusy || policyUncertain || selectionUncertain
  const selectionLocked = submissionLocked || workflowUncertain
  const updateSelectionUncertain = (uncertain: boolean) => {
    setSelectionUncertain(uncertain)
    onSubmissionUncertainChange(uncertain)
  }

  const togglePage = (pageId: string) => {
    if (
      !selectablePageIds.has(pageId) ||
      submissionPendingRef.current ||
      policyUncertain ||
      selectionUncertain
    )
      return
    setSelectedPageIds((current) => {
      const next = new Set(current)
      if (next.has(pageId)) next.delete(pageId)
      else if (next.size < MAX_SELECTED_PAGES) next.add(pageId)
      return next
    })
    setSubmitError(false)
  }

  const toggleAll = () => {
    if (submissionPendingRef.current || policyUncertain || selectionUncertain) return
    setSelectedPageIds(
      allSelected ? new Set() : new Set(bulkSelectablePages.map((page) => page.pageId)),
    )
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
    if (
      (policyUncertain || selectionUncertain) &&
      selectionRequestRef.current?.fingerprint !== fingerprint
    ) {
      submissionPendingRef.current = false
      setSubmitting(false)
      setSubmitError(true)
      return
    }
    if (selectionRequestRef.current?.fingerprint !== fingerprint) {
      selectionRequestRef.current = {
        fingerprint,
        requestId: createRequestId(),
      }
    }

    let resolveTransaction!: (run: SourceWorkflowRun | undefined) => void
    let transactionRun: SourceWorkflowRun | undefined
    const transaction = new Promise<SourceWorkflowRun | undefined>((resolve) => {
      resolveTransaction = resolve
    })
    onWorkflowPending(transaction)

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
            setPolicyUncertain(!isDefinitiveRequestFailure(error))
            throw reconciliationError
          }
          policySnapshotRef.current = reconciled
          if (!policyMatches(reconciled, desiredPolicy)) {
            setPolicyUncertain(!isDefinitiveRequestFailure(error))
            throw error
          }
          currentPolicy = reconciled
        }
        policySnapshotRef.current = currentPolicy
      }
      setPolicyUncertain(false)

      if (discardRequested()) return

      try {
        const selectionRequest = selectPages.mutateAsync({
          body: { pageIds: sortedPageIds },
          headers: { 'Idempotency-Key': selectionRequestRef.current.requestId },
          params: { id: knowledgeSpaceId, runId: run.id },
        })
        const selectionRun = await selectionRequest
        transactionRun = selectionRun
        onWorkflowRun(selectionRun)
      } catch (error) {
        updateSelectionUncertain(!isDefinitiveRequestFailure(error))
        throw error
      }
      updateSelectionUncertain(true)
      if (discardRequested()) return
      const terminalRun = await waitForImportTerminal(
        knowledgeSpaceId,
        transactionRun,
        onWorkflowRun,
        discardRequested,
      )
      transactionRun = terminalRun
      if (discardRequested()) return
      if (!isSuccessfulImport(terminalRun)) {
        selectionRequestRef.current = undefined
        updateSelectionUncertain(false)
        throw new Error('Source import failed')
      }
      updateSelectionUncertain(false)
      await queryClient.invalidateQueries({
        queryKey: consoleQuery.knowledgeFs.getKnowledgeSpacesByIdSources.key(),
      })
      if (discardRequested()) return
      await onSubmitted()
      router.push(newKnowledgeDetailPath(knowledgeSpaceId))
    } catch {
      setSubmitError(true)
    } finally {
      resolveTransaction(transactionRun)
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
            {pages.map((page, index) => {
              const skipReason = pageSkipReasons.get(page.pageId)
              const selectable = !skipReason
              const selectionLimitReached =
                selectable && selectionAtLimit && !selectedPageIds.has(page.pageId)
              const titleId = `${pageDescriptionPrefixId}-title-${index}`
              const urlId = `${pageDescriptionPrefixId}-url-${index}`
              const reasonId = `${pageDescriptionPrefixId}-reason-${index}`
              return (
                <li key={page.pageId}>
                  <label className="flex cursor-pointer items-center gap-2.5 px-3 py-2.5">
                    <Checkbox
                      checked={selectedPageIds.has(page.pageId)}
                      disabled={!selectable || selectionLimitReached || selectionLocked}
                      aria-labelledby={titleId}
                      aria-describedby={`${urlId}${skipReason || selectionLimitReached ? ` ${reasonId}` : ''}`}
                      onCheckedChange={() => togglePage(page.pageId)}
                    />
                    <span className="min-w-0 flex-1">
                      <span
                        id={titleId}
                        className="block truncate system-xs-medium text-text-primary"
                      >
                        {page.title || page.sourceUrl}
                      </span>
                      <span
                        id={urlId}
                        className="block truncate system-2xs-regular text-text-tertiary"
                      >
                        {page.sourceUrl}
                      </span>
                    </span>
                    {(!selectable || selectionLimitReached) && (
                      <span id={reasonId} className="shrink-0 system-xs-medium text-text-tertiary">
                        {selectionLimitReached
                          ? `${t(($) => $['newKnowledge.maxPages'])}: ${MAX_SELECTED_PAGES}`
                          : skipReason === 'off-domain'
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
            name="syncMode"
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
              name="customIntervalHours"
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
        <Button type="button" onClick={onCancel}>
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
  discardRequested,
  initialSyncMode,
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
  discardRequested: () => boolean
  initialSyncMode?: SyncMode
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
      context: { silent: true },
      input: { params: { id: knowledgeSpaceId, sourceId: source.id } },
      retry: false,
    }),
  )
  const policy =
    policyQuery.data ??
    (requestStatus(policyQuery.error) === 404 ? initialSyncPolicy(source) : undefined)

  if (policyQuery.isPending) {
    return (
      <div className="space-y-4">
        <PolicyLoading />
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
  if (!policy) {
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
      key={`${run.id}:${policy.revision}`}
      busy={busy}
      discardRequested={discardRequested}
      initialSyncMode={initialSyncMode}
      knowledgeSpaceId={knowledgeSpaceId}
      onCancel={onCancel}
      onRecrawl={onRecrawl}
      onSubmissionUncertainChange={onSubmissionUncertainChange}
      onSubmitted={onSubmitted}
      onWorkflowPending={onWorkflowPending}
      onWorkflowRun={onWorkflowRun}
      pages={pages}
      policy={policy}
      rootUrl={rootUrl}
      run={run}
      source={source}
      workflowUncertain={workflowUncertain}
    />
  )
}
