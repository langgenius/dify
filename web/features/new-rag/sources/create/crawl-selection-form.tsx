'use client'

import type { SyncPolicyValue } from '../setup/sync-policy-field'
import type { CrawlPreviewPage as PreviewPage, Source, SourceWorkflowRun } from '../source-models'
import { Button } from '@langgenius/dify-ui/button'
import { Form } from '@langgenius/dify-ui/form'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useRouter } from '@/next/navigation'
import { consoleClient, consoleQuery } from '@/service/client'
import { KnowledgeModelSetupDialog } from '../../components/knowledge-model-setup-dialog'
import { createRequestId } from '../../request-id'
import { newKnowledgeDetailPath } from '../../routes'
import { useKnowledgeModelSetupGuard } from '../../use-knowledge-model-setup-guard'
import { CrawlPreviewPageSelection } from '../setup/crawl-selection'
import { crawlPreviewPageSkipReason, MAX_SELECTED_PAGES } from '../setup/crawl-selection-model'
import { DEFAULT_CUSTOM_SYNC_INTERVAL_SECONDS, SyncPolicyField } from '../setup/sync-policy-field'
import { sourceWorkflowFromApi } from '../source-models'

type SyncMode = 'manual' | 'interval' | 'custom'

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
  rootUrl,
  run,
  showSyncPolicyField,
  source,
  syncPolicyValue,
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
  rootUrl?: string
  run: SourceWorkflowRun
  showSyncPolicyField: boolean
  source: Source
  syncPolicyValue?: SyncPolicyValue
  workflowUncertain: boolean
}) {
  const { t } = useTranslation('dataset')
  const router = useRouter()
  const queryClient = useQueryClient()
  const {
    configureModelSetup,
    ensureModelReady,
    modelReadiness,
    modelSetupDialogOpen,
    setModelSetupDialogOpen,
  } = useKnowledgeModelSetupGuard(knowledgeSpaceId)
  const pageSkipReasons = useMemo(
    () => new Map(pages.map((page) => [page.pageId, crawlPreviewPageSkipReason(page, rootUrl)])),
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
  const [localSyncPolicy, setLocalSyncPolicy] = useState<SyncPolicyValue>(() => {
    if (syncPolicyValue) return syncPolicyValue
    const mode = initialSyncMode ?? 'manual'
    return {
      ...(mode === 'custom'
        ? {
            customIntervalSeconds: DEFAULT_CUSTOM_SYNC_INTERVAL_SECONDS,
          }
        : {}),
      mode,
    }
  })
  const syncPolicy = showSyncPolicyField ? localSyncPolicy : (syncPolicyValue ?? localSyncPolicy)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(false)
  const [selectionUncertain, setSelectionUncertain] = useState(false)
  const submissionPendingRef = useRef(false)
  const selectionRequestRef = useRef<{ fingerprint: string; requestId: string } | undefined>(
    undefined,
  )
  const importPages = useMutation({
    mutationFn: async ({
      idempotencyKey,
      pageIds,
      previewWorkflowId,
      syncPolicy,
    }: {
      idempotencyKey: string
      pageIds: string[]
      previewWorkflowId: string
      syncPolicy: ReturnType<typeof policyConfiguration>
    }) =>
      sourceWorkflowFromApi(
        await consoleClient.knowledgeFs.spaces.byControlSpaceId.sources.bySourceId.asyncImport.post(
          {
            body: {
              kind: 'crawl-preview-selection',
              pageIds,
              previewWorkflowId,
              syncPolicy,
            },
            headers: { 'Idempotency-Key': idempotencyKey },
            params: { control_space_id: knowledgeSpaceId, source_id: source.id },
          },
        ),
      ),
  })
  const canSubmit = selectedPageIds.size > 0
  const formBusy = busy || submitting
  const submissionLocked = formBusy || selectionUncertain
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
    if (submissionPendingRef.current || selectionUncertain) return
    setSelectedPageIds(pageIds)
    setSubmitError(false)
  }

  const submit = async () => {
    if (!canSubmit || busy || submissionPendingRef.current) return
    submissionPendingRef.current = true
    setSubmitting(true)
    setSubmitError(false)
    if (
      (await ensureModelReady({ capability: 'ingest', intent: 'source-sync' })).status !== 'ready'
    ) {
      submissionPendingRef.current = false
      setSubmitting(false)
      return
    }
    const desiredPolicy = policyConfiguration(syncPolicy)
    const sortedPageIds = [...selectedPageIds].sort()
    const fingerprint = JSON.stringify({ pageIds: sortedPageIds, policy: desiredPolicy })
    if (selectionUncertain && selectionRequestRef.current?.fingerprint !== fingerprint) {
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
      if (discardRequested()) return

      try {
        const selectionRequest = importPages.mutateAsync({
          idempotencyKey: selectionRequestRef.current.requestId,
          pageIds: sortedPageIds,
          previewWorkflowId: run.id,
          syncPolicy: desiredPolicy,
        })
        const selectionRun = await selectionRequest
        transactionRun = selectionRun
        onWorkflowRun(selectionRun)
      } catch (error) {
        updateSelectionUncertain(!isDefinitiveRequestFailure(error))
        throw error
      }
      updateSelectionUncertain(false)
      if (discardRequested()) return
      await queryClient.invalidateQueries({
        queryKey: consoleQuery.knowledgeFs.spaces.byControlSpaceId.sources.get.key(),
        refetchType: 'none',
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

      {showSyncPolicyField && (
        <SyncPolicyField
          disabled={selectionLocked}
          triggerClassName="sm:w-75.25"
          value={syncPolicy}
          onChange={(value) => {
            setLocalSyncPolicy(value)
            setSubmitError(false)
          }}
        />
      )}

      {submitError && (
        <p role="alert" className="system-xs-regular text-text-destructive">
          {t(($) => $['newKnowledge.addSourceFailed'])}
        </p>
      )}
      <div className="mt-1 flex justify-end gap-3 border-t border-divider-subtle pt-5">
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
        readiness={modelReadiness}
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
  showSyncPolicyField = true,
  source,
  syncPolicyValue,
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
  showSyncPolicyField?: boolean
  source: Source
  syncPolicyValue?: SyncPolicyValue
  workflowUncertain?: boolean
}) {
  return (
    <ReadyCrawlSelectionForm
      key={run.id}
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
      rootUrl={rootUrl}
      run={run}
      showSyncPolicyField={showSyncPolicyField}
      source={source}
      syncPolicyValue={syncPolicyValue}
      workflowUncertain={workflowUncertain}
    />
  )
}
