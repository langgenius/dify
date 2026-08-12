'use client'

import type {
  CrawlPreviewPage as PreviewPage,
  Source,
  SourceWorkflowRun,
  SourceSyncPolicy as SyncPolicy,
  SourceSyncPolicyBody as SyncPolicyBody,
} from './source-models'
import type { SyncPolicyValue } from './sync-policy-field'
import { Button } from '@langgenius/dify-ui/button'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import { Form } from '@langgenius/dify-ui/form'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useRouter } from '@/next/navigation'
import { consoleClient, consoleQuery } from '@/service/client'
import { KnowledgeModelSetupDialog } from './components/knowledge-model-setup-dialog'
import { createRequestId } from './request-id'
import { newKnowledgeDetailPath } from './routes'
import { sourceSyncPolicyFromApi, sourceWorkflowFromApi } from './source-models'
import { DEFAULT_CUSTOM_SYNC_INTERVAL_SECONDS, SyncPolicyField } from './sync-policy-field'
import { useKnowledgeModelSetupGuard } from './use-knowledge-model-setup-guard'

type SyncMode = SyncPolicy['mode']

export const MAX_SELECTED_PAGES = 200
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
    current = sourceWorkflowFromApi(
      await consoleClient.knowledgeFs.spaces.byControlSpaceId.sourceWorkflows.byRunId.get({
        params: { control_space_id: knowledgeSpaceId, run_id: current.id },
      }),
    )
    onWorkflowRun(current)
    if (discardRequested() || isTerminalImport(current)) return current
    await new Promise((resolve) => setTimeout(resolve, IMPORT_POLL_INTERVAL_MS))
  }
  throw new Error('Source import did not reach a terminal state')
}

function pageSkipReason(page: PreviewPage, rootUrl?: string): PageSkipReason | undefined {
  try {
    const candidate = new URL(page.sourceUrl)
    if (
      !['http:', 'https:'].includes(candidate.protocol) ||
      candidate.username ||
      candidate.password
    )
      return 'failed'
    if (!rootUrl) return undefined
    const root = new URL(rootUrl)
    if (candidate.hostname.toLocaleLowerCase() !== root.hostname.toLocaleLowerCase())
      return 'off-domain'
    return undefined
  } catch {
    return 'failed'
  }
}

function policyConfiguration(value: SyncPolicyValue) {
  if (value.mode === 'manual') return { enabled: false, mode: value.mode } as const
  if (value.mode === 'custom') {
    return {
      customIntervalSeconds: value.customIntervalSeconds ?? DEFAULT_CUSTOM_SYNC_INTERVAL_SECONDS,
      enabled: true,
      mode: value.mode,
    } as const
  }
  return { enabled: true, mode: value.mode } as const
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

export function CrawlPreviewPageSelection({
  busy = false,
  disabled = false,
  onRecrawl,
  onSelectionChange,
  pages,
  progressFailed = 0,
  recrawlDisabled,
  rootUrl,
  sourceLabel,
  selectedPageIds,
}: {
  busy?: boolean
  disabled?: boolean
  onRecrawl?: () => void
  onSelectionChange: (pageIds: Set<string>) => void
  pages: PreviewPage[]
  progressFailed?: number
  recrawlDisabled?: boolean
  rootUrl?: string
  sourceLabel?: string
  selectedPageIds: Set<string>
}) {
  const { t } = useTranslation('dataset')
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
  const allSelected =
    bulkSelectablePages.length > 0 &&
    bulkSelectablePages.every((page) => selectedPageIds.has(page.pageId))
  const someSelected = selectedPageIds.size > 0
  const selectionAtLimit = selectedPageIds.size >= MAX_SELECTED_PAGES
  const selectionLocked = disabled || busy

  const togglePage = (pageId: string) => {
    if (!selectablePageIds.has(pageId) || selectionLocked) return
    onSelectionChange(
      new Set(
        selectedPageIds.has(pageId)
          ? [...selectedPageIds].filter((selectedPageId) => selectedPageId !== pageId)
          : selectedPageIds.size < MAX_SELECTED_PAGES
            ? [...selectedPageIds, pageId]
            : selectedPageIds,
      ),
    )
  }

  const toggleAll = () => {
    if (selectionLocked) return
    onSelectionChange(
      allSelected ? new Set() : new Set(bulkSelectablePages.map((page) => page.pageId)),
    )
  }

  return (
    <section aria-labelledby="crawl-selection-summary">
      <div className="flex flex-wrap items-center gap-3.5">
        <h3
          id="crawl-selection-summary"
          role="status"
          aria-live="polite"
          className="min-w-0 flex-1 truncate system-xs-semibold text-text-primary"
        >
          {t(($) => $['newKnowledge.pagesCrawled'], {
            count: pages.length,
            host: sourceLabel ?? (rootUrl ? new URL(rootUrl).host : ''),
          })}
        </h3>
        <span className="system-xs-regular text-text-tertiary">
          {t(($) => $['newKnowledge.pagesSelected'], { count: selectedPageIds.size })}
        </span>
        {progressFailed > 0 && (
          <span className="system-xs-regular text-text-destructive">
            {progressFailed} {t(($) => $['newKnowledge.skippedFailed'])}
          </span>
        )}
        {onRecrawl && (
          <Button
            type="button"
            variant="ghost-accent"
            size="small"
            disabled={recrawlDisabled ?? selectionLocked}
            loading={busy}
            className="px-0"
            onClick={onRecrawl}
          >
            {t(($) => $['newKnowledge.reCrawl'])}
          </Button>
        )}
      </div>
      <div className="mt-3 flex h-79 flex-col overflow-hidden rounded-xl border border-divider-regular">
        <label className="flex shrink-0 cursor-pointer items-center gap-2.5 border-b border-divider-subtle bg-background-section px-3 py-2.5 system-xs-medium text-text-secondary">
          <Checkbox
            checked={allSelected}
            indeterminate={someSelected && !allSelected}
            onCheckedChange={toggleAll}
            disabled={!selectablePages.length || selectionLocked}
          />
          {t(($) => $['newKnowledge.selectAll'])}
        </label>
        <ul className="min-h-0 flex-1 overflow-y-auto">
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
                      {page.sourceUrl.replace(/^https?:\/\//, '')}
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
  )
}

function ReadyCrawlSelectionForm({
  busy,
  discardRequested,
  initialSelectedPageIds,
  initialSyncMode,
  knowledgeSpaceId,
  onCancel,
  onInteractionLockChange,
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
  initialSelectedPageIds: readonly string[]
  initialSyncMode?: SyncMode
  knowledgeSpaceId: string
  onCancel: () => void
  onInteractionLockChange?: (locked: boolean) => void
  onRecrawl: () => void
  onSubmissionUncertainChange: (uncertain: boolean) => void
  onSubmitted: () => Promise<void> | void
  onWorkflowPending: (request: Promise<SourceWorkflowRun | undefined>) => void
  onWorkflowRun: (run: SourceWorkflowRun) => void
  pages: PreviewPage[]
  policy: SyncPolicy
  rootUrl?: string
  run: SourceWorkflowRun
  source: Source
  workflowUncertain: boolean
}) {
  const { t } = useTranslation('dataset')
  const router = useRouter()
  const queryClient = useQueryClient()
  const {
    configureModelSetup,
    ensureModelSetupReady,
    modelSetupDialogOpen,
    setModelSetupDialogOpen,
  } = useKnowledgeModelSetupGuard(knowledgeSpaceId)
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
  const [selectedPageIds, setSelectedPageIds] = useState<Set<string>>(
    () =>
      new Set(
        initialSelectedPageIds
          .filter((pageId) => selectablePageIds.has(pageId))
          .slice(0, MAX_SELECTED_PAGES),
      ),
  )
  const [syncPolicy, setSyncPolicy] = useState<SyncPolicyValue>(() => {
    const mode = initialSyncMode ?? (policy.enabled ? policy.mode : 'manual')
    return {
      ...(mode === 'custom'
        ? {
            customIntervalSeconds:
              policy.customIntervalSeconds ?? DEFAULT_CUSTOM_SYNC_INTERVAL_SECONDS,
          }
        : {}),
      mode,
    }
  })
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(false)
  const [policyUncertain, setPolicyUncertain] = useState(false)
  const [selectionUncertain, setSelectionUncertain] = useState(false)
  const policySnapshotRef = useRef(policy)
  const submissionPendingRef = useRef(false)
  const selectionRequestRef = useRef<{ fingerprint: string; requestId: string } | undefined>(
    undefined,
  )
  const updatePolicy = useMutation({
    mutationFn: async ({ body, sourceId }: { body: SyncPolicyBody; sourceId: string }) =>
      sourceSyncPolicyFromApi(
        await consoleClient.knowledgeFs.spaces.byControlSpaceId.sources.bySourceId.syncPolicy.put({
          body,
          params: { control_space_id: knowledgeSpaceId, source_id: sourceId },
        }),
      ),
  })
  const selectPages = useMutation({
    mutationFn: async ({
      idempotencyKey,
      pageIds,
      runId,
    }: {
      idempotencyKey: string
      pageIds: string[]
      runId: string
    }) =>
      sourceWorkflowFromApi(
        await consoleClient.knowledgeFs.spaces.byControlSpaceId.sourceWorkflows.byRunId.selection.post(
          {
            body: { pageIds },
            headers: { 'Idempotency-Key': idempotencyKey },
            params: { control_space_id: knowledgeSpaceId, run_id: runId },
          },
        ),
      ),
  })
  const canSubmit = selectedPageIds.size > 0
  const formBusy = busy || submitting
  const submissionLocked = formBusy || policyUncertain || selectionUncertain
  const selectionLocked = submissionLocked || workflowUncertain

  useEffect(() => {
    onInteractionLockChange?.(submissionLocked)
  }, [onInteractionLockChange, submissionLocked])

  useEffect(
    () => () => {
      onInteractionLockChange?.(false)
    },
    [onInteractionLockChange],
  )

  const updateSelectionUncertain = (uncertain: boolean) => {
    setSelectionUncertain(uncertain)
    onSubmissionUncertainChange(uncertain)
  }

  const updateSelectedPageIds = (pageIds: Set<string>) => {
    if (submissionPendingRef.current || policyUncertain || selectionUncertain) return
    setSelectedPageIds(pageIds)
    setSubmitError(false)
  }

  const submit = async () => {
    if (!canSubmit || busy || submissionPendingRef.current) return
    submissionPendingRef.current = true
    setSubmitting(true)
    setSubmitError(false)
    if (!(await ensureModelSetupReady())) {
      submissionPendingRef.current = false
      setSubmitting(false)
      return
    }
    const desiredPolicy = policyConfiguration(syncPolicy)
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
            sourceId: source.id,
          })
        } catch (error) {
          let reconciled: SyncPolicy
          try {
            reconciled = sourceSyncPolicyFromApi(
              await consoleClient.knowledgeFs.spaces.byControlSpaceId.sources.bySourceId.syncPolicy.get(
                {
                  params: {
                    control_space_id: knowledgeSpaceId,
                    source_id: source.id,
                  },
                },
              ),
            )
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
          idempotencyKey: selectionRequestRef.current.requestId,
          pageIds: sortedPageIds,
          runId: run.id,
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
        queryKey: consoleQuery.knowledgeFs.spaces.byControlSpaceId.sources.get.key(),
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
    <Form className="flex flex-col gap-4" onFormSubmit={() => void submit()}>
      <CrawlPreviewPageSelection
        busy={busy}
        disabled={selectionLocked}
        onRecrawl={onRecrawl}
        onSelectionChange={updateSelectedPageIds}
        pages={pages}
        progressFailed={run.progressFailed}
        recrawlDisabled={submissionLocked}
        rootUrl={rootUrl}
        selectedPageIds={selectedPageIds}
      />

      <SyncPolicyField
        disabled={selectionLocked}
        triggerClassName="sm:w-75.25"
        value={syncPolicy}
        onChange={(value) => {
          setSyncPolicy(value)
          setSubmitError(false)
        }}
      />

      {submitError && (
        <p role="alert" className="system-xs-regular text-text-destructive">
          {t(($) => $['newKnowledge.addSourceFailed'])}
        </p>
      )}
      <div className="mt-1 flex justify-end gap-2 border-t border-divider-subtle pt-5">
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
      <KnowledgeModelSetupDialog
        open={modelSetupDialogOpen}
        onOpenChange={setModelSetupDialogOpen}
        onConfigure={configureModelSetup}
      />
    </Form>
  )
}

export function CrawlSelectionForm({
  busy = false,
  discardRequested,
  initialSelectedPageIds = [],
  initialSyncMode,
  knowledgeSpaceId,
  onCancel,
  onInteractionLockChange,
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
  initialSelectedPageIds?: readonly string[]
  initialSyncMode?: SyncMode
  knowledgeSpaceId: string
  onCancel: () => void
  onInteractionLockChange?: (locked: boolean) => void
  onRecrawl: () => void
  onSubmissionUncertainChange: (uncertain: boolean) => void
  onSubmitted: () => Promise<void> | void
  onWorkflowPending: (request: Promise<SourceWorkflowRun | undefined>) => void
  onWorkflowRun: (run: SourceWorkflowRun) => void
  pages: PreviewPage[]
  rootUrl?: string
  run: SourceWorkflowRun
  source: Source
  workflowUncertain?: boolean
}) {
  const { t } = useTranslation('dataset')
  const policyQuery = useQuery(
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.sources.bySourceId.syncPolicy.get.queryOptions(
      {
        context: { silent: true },
        input: {
          params: {
            control_space_id: knowledgeSpaceId,
            source_id: source.id,
          },
        },
        retry: false,
        select: sourceSyncPolicyFromApi,
      },
    ),
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
      initialSelectedPageIds={initialSelectedPageIds}
      initialSyncMode={initialSyncMode}
      knowledgeSpaceId={knowledgeSpaceId}
      onCancel={onCancel}
      onInteractionLockChange={onInteractionLockChange}
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
