'use client'

import type { DatasourceParameters } from './datasource-parameter-model'
import type { NewKnowledgeWebsiteSourceDraft } from './routes'
import type { CrawlPreviewPage as PreviewPage, Source, SourceWorkflowRun } from './source-models'
import type { InstalledSourceProviderOption } from './source-provider-options'
import type { SyncPolicyValue } from './sync-policy-field'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { Button } from '@langgenius/dify-ui/button'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import { cn } from '@langgenius/dify-ui/cn'
import { Field, FieldLabel } from '@langgenius/dify-ui/field'
import { Fieldset } from '@langgenius/dify-ui/fieldset'
import { Form } from '@langgenius/dify-ui/form'
import { Input } from '@langgenius/dify-ui/input'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useRouter } from '@/next/navigation'
import { consoleClient } from '@/service/client'
import { CrawlSelectionForm } from './crawl-selection-form'
import { WebsiteDatasourceParameterForm } from './datasource-parameter-form'
import {
  datasourceIncludeSubpages,
  datasourceParameterDefaults,
  invalidDatasourceParameters,
  missingRequiredDatasourceParameters,
  websiteDatasourceParameterSchemas,
  withDatasourceParameterDefaults,
} from './datasource-parameter-model'
import { createRequestId } from './request-id'
import {
  NEW_KNOWLEDGE_SOURCE_NAME_MAX_LENGTH,
  newKnowledgeDetailPath,
  normalizeWebsiteSourceUrl,
} from './routes'
import { crawlPreviewPageListFromApi, sourceFromApi, sourceWorkflowFromApi } from './source-models'

type ConnectionReference = {
  id: string
  providerId: string
}

type CrawlConfiguration = {
  name: string
  parameters: DatasourceParameters
  rootUrl?: string
  uri: string
}

function initialSyncPolicyValue(draft?: NewKnowledgeWebsiteSourceDraft): SyncPolicyValue {
  const mode = draft?.syncPolicy === 'daily' ? 'interval' : (draft?.syncPolicy ?? 'provider')
  return {
    ...(mode === 'custom' ? { customIntervalSeconds: draft?.customIntervalSeconds } : {}),
    mode,
  }
}

type PreviewDraft = {
  clientRequestId: string
  configurationKey: string
  creationAttempted?: boolean
  deletionRequest?: {
    idempotencyKey: string
    sourceVersion: number
  }
  previewRequestId: string
  source?: Source
}

type PendingNavigation = { type: 'back' } | { href: string; type: 'push' }

function previewPagesEqual(left: PreviewPage, right: PreviewPage) {
  return (
    left.pageId === right.pageId &&
    left.description === right.description &&
    left.etag === right.etag &&
    left.sourceUrl === right.sourceUrl &&
    left.title === right.title
  )
}

const PAGE_SIZE = 200
const MAX_CURSOR_PAGES = 100
const POLL_INTERVAL_MS = 1500
const MAX_PREVIEW_SELECTION = 200
const SUCCESS_STATES = new Set([
  'complete',
  'completed',
  'preview_ready',
  'success',
  'succeeded',
  'zero_results',
])
const FAILURE_STATES = new Set(['error', 'exhausted', 'failed', 'timed_out', 'timeout'])
const CANCELED_STATES = new Set(['canceled', 'cancelled', 'superseded'])

async function getSourceWorkflow(knowledgeSpaceId: string, runId: string) {
  return sourceWorkflowFromApi(
    await consoleClient.knowledgeFs.spaces.byControlSpaceId.sourceWorkflows.byRunId.get({
      params: { control_space_id: knowledgeSpaceId, run_id: runId },
    }),
  )
}

async function previewSourceCrawl(
  knowledgeSpaceId: string,
  sourceId: string,
  idempotencyKey: string,
) {
  return sourceWorkflowFromApi(
    await consoleClient.knowledgeFs.spaces.byControlSpaceId.sources.bySourceId.crawlPreview.post({
      headers: { 'Idempotency-Key': idempotencyKey },
      params: { control_space_id: knowledgeSpaceId, source_id: sourceId },
    }),
  )
}

async function retrySourceWorkflow(knowledgeSpaceId: string, runId: string) {
  return sourceWorkflowFromApi(
    await consoleClient.knowledgeFs.spaces.byControlSpaceId.sourceWorkflows.byRunId.retry.post({
      params: { control_space_id: knowledgeSpaceId, run_id: runId },
    }),
  )
}

async function cancelSourceWorkflow(knowledgeSpaceId: string, runId: string) {
  return sourceWorkflowFromApi(
    await consoleClient.knowledgeFs.spaces.byControlSpaceId.sourceWorkflows.byRunId.cancel.post({
      body: { reason: 'user_requested' },
      params: { control_space_id: knowledgeSpaceId, run_id: runId },
    }),
  )
}

async function deleteProvisionalSource(
  knowledgeSpaceId: string,
  source: Source,
  idempotencyKey: string,
) {
  if (!source.version) throw new Error('Provisional source has no version')
  await consoleClient.knowledgeFs.spaces.byControlSpaceId.sources.bySourceId.delete({
    body: { expectedRevision: source.version },
    headers: { 'Idempotency-Key': idempotencyKey },
    params: { control_space_id: knowledgeSpaceId, source_id: source.id },
    query: { documents: 'cascade' },
  })
}

async function getSource(knowledgeSpaceId: string, sourceId: string) {
  return sourceFromApi(
    await consoleClient.knowledgeFs.spaces.byControlSpaceId.sources.bySourceId.get({
      params: { control_space_id: knowledgeSpaceId, source_id: sourceId },
    }),
  )
}

function isSameProvisionalSource(draft: PreviewDraft, source: Source) {
  return (
    source.id === draft.source?.id &&
    source.type === 'web' &&
    source.status === 'disabled' &&
    source.metadata.preview === true &&
    source.metadata.clientRequestId === draft.clientRequestId
  )
}

function normalizedState(state: string) {
  return state.trim().toLowerCase().replaceAll('-', '_').replaceAll(' ', '_')
}

function isSuccessful(state: string) {
  return SUCCESS_STATES.has(normalizedState(state))
}

function isFailed(state: string) {
  return FAILURE_STATES.has(normalizedState(state))
}

function isCanceled(state: string) {
  return CANCELED_STATES.has(normalizedState(state))
}

function isTerminal(state: string) {
  return isSuccessful(state) || isFailed(state) || isCanceled(state)
}

function requiresCancellation(state: string) {
  return normalizedState(state) === 'preview_ready' || !isTerminal(state)
}

function configurationKey(configuration: CrawlConfiguration) {
  return JSON.stringify(configuration)
}

function datasourceSourceUri(parameters: DatasourceParameters, fallback: string) {
  const url = parameters.url
  if (typeof url === 'string') {
    const normalized = normalizeWebsiteSourceUrl(url)
    if (normalized) return normalized.toString()
  }
  return `datasource://${encodeURIComponent(fallback)}`
}

function workflowAttemptKey(run: SourceWorkflowRun) {
  return `${run.id}:${run.executionAttempts}`
}

function responseStatus(error: unknown) {
  if (error instanceof Response) return error.status
  if (!error || typeof error !== 'object') return undefined
  if ('status' in error && typeof error.status === 'number') return error.status
  if ('data' in error && error.data && typeof error.data === 'object' && 'status' in error.data) {
    return typeof error.data.status === 'number' ? error.data.status : undefined
  }
}

function isDefinitiveRequestFailure(error: unknown) {
  const status = responseStatus(error)
  return status !== undefined && [400, 401, 403, 404, 409, 422, 429].includes(status)
}

function isRetryConfirmed(previous: SourceWorkflowRun, current: SourceWorkflowRun) {
  return (
    previous.id === current.id &&
    (current.executionAttempts > previous.executionAttempts ||
      current.updatedAt > previous.updatedAt ||
      current.checkpoint !== previous.checkpoint ||
      normalizedState(current.state) !== normalizedState(previous.state))
  )
}

function sameWorkflowSnapshot(left: SourceWorkflowRun, right: SourceWorkflowRun) {
  return (
    left.id === right.id &&
    left.executionAttempts === right.executionAttempts &&
    left.updatedAt === right.updatedAt &&
    left.checkpoint === right.checkpoint &&
    normalizedState(left.state) === normalizedState(right.state)
  )
}

function isCancelConfirmed(target: SourceWorkflowRun, current: SourceWorkflowRun) {
  return (
    target.id === current.id &&
    current.executionAttempts >= target.executionAttempts &&
    !(
      normalizedState(target.state) === 'preview_ready' &&
      normalizedState(current.state) === 'preview_ready'
    ) &&
    isTerminal(current.state)
  )
}

function latestWorkflowRun(
  current: SourceWorkflowRun | undefined,
  candidate: SourceWorkflowRun | undefined,
) {
  if (!current) return candidate
  if (!candidate) return current
  if (current.id !== candidate.id) return candidate
  if (current.executionAttempts !== candidate.executionAttempts)
    return current.executionAttempts > candidate.executionAttempts ? current : candidate
  if (current.updatedAt !== candidate.updatedAt)
    return current.updatedAt > candidate.updatedAt ? current : candidate
  if (isTerminal(current.state) !== isTerminal(candidate.state))
    return isTerminal(current.state) ? current : candidate
  return candidate
}

async function listWorkflowPageUpdates(
  knowledgeSpaceId: string,
  runId: string,
  initialCursor?: string,
) {
  const pages = new Map<string, PreviewPage>()
  const seenCursors = new Set(initialCursor ? [initialCursor] : [])
  let cursor = initialCursor
  let resumeCursor = initialCursor
  let pageCount = 0

  do {
    pageCount += 1
    if (pageCount > MAX_CURSOR_PAGES) throw new Error('Workflow page cursor limit exceeded')
    const response = crawlPreviewPageListFromApi(
      await consoleClient.knowledgeFs.spaces.byControlSpaceId.sourceWorkflows.byRunId.pages.get({
        params: { control_space_id: knowledgeSpaceId, run_id: runId },
        query: { ...(cursor ? { cursor } : {}), limit: PAGE_SIZE },
      }),
    )
    for (const page of response.items) pages.set(page.pageId, page)
    const nextCursor = response.nextCursor
    if (!nextCursor || seenCursors.has(nextCursor)) break
    seenCursors.add(nextCursor)
    cursor = nextCursor
    resumeCursor = nextCursor
  } while (cursor)

  return { items: [...pages.values()], resumeCursor }
}

async function findProvisionalSource(knowledgeSpaceId: string, clientRequestId: string) {
  const seenCursors = new Set<string>()
  let cursor: string | undefined
  let pageCount = 0

  do {
    pageCount += 1
    if (pageCount > MAX_CURSOR_PAGES) throw new Error('Source cursor limit exceeded')
    const response = await consoleClient.knowledgeFs.spaces.byControlSpaceId.sources.get({
      params: { control_space_id: knowledgeSpaceId },
      query: { ...(cursor ? { cursor } : {}) },
    })
    const source = response.data
      .map(sourceFromApi)
      .find((candidate) => candidate.metadata.clientRequestId === clientRequestId)
    if (source) return source
    const nextCursor = response.next_cursor ?? undefined
    if (!nextCursor || seenCursors.has(nextCursor)) return undefined
    seenCursors.add(nextCursor)
    cursor = nextCursor
  } while (cursor)

  return undefined
}

const CrawlPageList = memo(
  ({
    loading = false,
    onTogglePage,
    pages,
    selectedPageIds,
  }: {
    loading?: boolean
    onTogglePage?: (pageId: string) => void
    pages: PreviewPage[]
    selectedPageIds?: ReadonlySet<string>
  }) => {
    if (!pages.length && !loading) return null

    return (
      <ul
        className={cn(
          'max-h-64 overflow-y-auto',
          loading ? 'flex min-h-0 flex-1 flex-col gap-3.5' : 'divide-y divide-divider-subtle',
        )}
        aria-live="polite"
      >
        {pages.map((page) => (
          <li
            key={page.pageId}
            className={cn(
              'flex items-start gap-2.5 [contain-intrinsic-size:auto_40px] [content-visibility:auto]',
              loading ? 'py-1' : 'px-4 py-2.5',
            )}
          >
            <Checkbox
              aria-label={page.title || page.sourceUrl}
              checked={selectedPageIds?.has(page.pageId) ?? false}
              disabled={!onTogglePage}
              className="mt-0.5"
              onCheckedChange={() => onTogglePage?.(page.pageId)}
            />
            <span className="min-w-0">
              <span className="block truncate system-xs-medium text-text-primary">
                {page.title || page.sourceUrl}
              </span>
              <span className="block truncate system-2xs-regular text-text-tertiary">
                {page.sourceUrl}
              </span>
            </span>
          </li>
        ))}
        {loading &&
          [
            { id: 'short', sourceWidth: 'w-22.5', titleWidth: 'w-37.5' },
            { id: 'medium', sourceWidth: 'w-26', titleWidth: 'w-42.5' },
            { id: 'long', sourceWidth: 'w-29.5', titleWidth: 'w-47.5' },
            { id: 'longest', sourceWidth: 'w-33', titleWidth: 'w-52.5' },
          ].map(({ id, sourceWidth, titleWidth }) => (
            <li
              key={id}
              data-testid="crawl-page-skeleton"
              aria-hidden
              className="flex h-8 shrink-0 items-center gap-2.5 py-1"
            >
              <span className="size-4 animate-pulse rounded bg-util-colors-gray-gray-200" />
              <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                <span
                  className={cn(
                    'block h-2.5 animate-pulse rounded bg-util-colors-gray-gray-200',
                    titleWidth,
                  )}
                />
                <span
                  className={cn(
                    'block h-2 animate-pulse rounded bg-background-section-burn',
                    sourceWidth,
                  )}
                />
              </span>
            </li>
          ))}
      </ul>
    )
  },
)

function EmptyPreview() {
  const { t } = useTranslation('dataset')
  return (
    <div className="flex min-h-38.75 flex-col items-center justify-center rounded-xl border border-dashed border-divider-regular bg-background-default-subtle px-6 text-center">
      <span className="flex size-10 items-center justify-center rounded-[10px] bg-background-section-burn">
        <span aria-hidden className="i-ri-global-line size-5 text-text-tertiary" />
      </span>
      <p className="mt-2.5 system-xs-semibold text-text-primary">
        {t(($) => $['newKnowledge.pagesAppearTitle'])}
      </p>
      <p className="mt-2.5 system-xs-regular text-text-tertiary">
        {t(($) => $['newKnowledge.pagesAppearDescription'])}
      </p>
    </div>
  )
}

export function WebsiteCrawlPreview({
  connection,
  initialDraft,
  knowledgeSpaceId,
  onDraftFinished,
  onInteractionLockChange,
  providerOption,
  providerName = 'Firecrawl',
}: {
  connection: ConnectionReference
  initialDraft?: NewKnowledgeWebsiteSourceDraft
  knowledgeSpaceId: string
  onDraftFinished?: () => void
  onInteractionLockChange?: (locked: boolean) => void
  providerOption?: InstalledSourceProviderOption
  providerName?: string
}) {
  const { t } = useTranslation('dataset')
  const router = useRouter()
  const parameterSchemas = useMemo(
    () =>
      providerOption
        ? websiteDatasourceParameterSchemas(providerOption.datasource)
        : websiteDatasourceParameterSchemas(),
    [providerOption],
  )
  const defaultParameters = useMemo(
    () => datasourceParameterDefaults(parameterSchemas),
    [parameterSchemas],
  )
  const [parameters, setParameters] = useState<DatasourceParameters>(() => {
    const initialParameters = withDatasourceParameterDefaults(
      parameterSchemas,
      initialDraft?.parameters,
    )
    if (!providerOption || providerOption.datasource.parameters.length === 0) {
      const crawlSubpagesParameter = parameterSchemas.find((parameter) =>
        ['crawl_sub_pages', 'crawl_subpages'].includes(parameter.name),
      )
      if (crawlSubpagesParameter)
        initialParameters[crawlSubpagesParameter.name] = initialDraft?.includeSubpages ?? true
      initialParameters.limit = initialDraft?.maxPages ?? 100
    }
    if (
      initialDraft?.rootUrl &&
      parameterSchemas.some((parameter) => parameter.name === 'url') &&
      initialParameters.url === undefined
    )
      initialParameters.url = initialDraft.rootUrl
    return initialParameters
  })
  const [sourceName, setSourceName] = useState(initialDraft?.sourceName ?? '')
  const initialSyncPolicyRef = useRef(initialSyncPolicyValue(initialDraft))
  const syncPolicy = initialSyncPolicyValue(initialDraft)
  const [run, setRun] = useState<SourceWorkflowRun>()
  const [pages, setPages] = useState<PreviewPage[]>([])
  const [selectedPageIds, setSelectedPageIds] = useState<Set<string>>(() => new Set())
  const [pagesLoaded, setPagesLoaded] = useState(false)
  const [starting, setStarting] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [pollPaused, setPollPaused] = useState(false)
  const [requestError, setRequestError] = useState<string>()
  const [cancelConfirmationOpen, setCancelConfirmationOpen] = useState(false)
  const [discarding, setDiscarding] = useState(false)
  const [discardError, setDiscardError] = useState(false)
  const [workflowUncertain, setWorkflowUncertain] = useState(false)
  const [selectionUncertain, setSelectionUncertain] = useState(false)
  const [selectionInteractionLocked, setSelectionInteractionLocked] = useState(false)
  const workflowStatusUncertainRef = useRef(false)
  const selectionUncertainRef = useRef(false)
  const draftRef = useRef<PreviewDraft | undefined>(undefined)
  const actionPendingRef = useRef(false)
  const retryFingerprintRef = useRef<string | undefined>(undefined)
  const cancelFingerprintRef = useRef<string | undefined>(undefined)
  const sourceNameInputRef = useRef<HTMLInputElement>(null)
  const pageMapRef = useRef(new Map<string, PreviewPage>())
  const pageCursorRef = useRef<string | undefined>(undefined)
  const submittedRef = useRef(false)
  const discardRequestedRef = useRef(false)
  const pendingWorkflowPromiseRef = useRef<Promise<SourceWorkflowRun | undefined> | undefined>(
    undefined,
  )
  const pendingCancelRunRef = useRef<SourceWorkflowRun | undefined>(undefined)
  const runRef = useRef<SourceWorkflowRun | undefined>(undefined)
  const retryPredecessorRef = useRef<SourceWorkflowRun | undefined>(undefined)
  const uncertainWorkflowRef = useRef<(() => Promise<SourceWorkflowRun | undefined>) | undefined>(
    undefined,
  )
  const pendingNavigationRef = useRef<PendingNavigation | undefined>(undefined)
  const historyGuardRef = useRef<string | undefined>(undefined)
  const historyGuardCompletionRef = useRef<(() => void) | undefined>(undefined)

  const deletePreviewDraftSource = useCallback(
    async (draft: PreviewDraft) => {
      if (!draft.source) return
      let source = draft.source
      const clearDraft = () => {
        if (draftRef.current === draft) draftRef.current = undefined
      }
      for (let attempt = 0; attempt < 2; attempt += 1) {
        if (!source.version) throw new Error('Provisional source has no version')
        if (draft.deletionRequest?.sourceVersion !== source.version) {
          draft.deletionRequest = {
            idempotencyKey: createRequestId(),
            sourceVersion: source.version,
          }
        }
        try {
          await deleteProvisionalSource(
            knowledgeSpaceId,
            source,
            draft.deletionRequest.idempotencyKey,
          )
          clearDraft()
          return
        } catch (error) {
          if (responseStatus(error) === 404) {
            clearDraft()
            return
          }
          if (responseStatus(error) === 409 && attempt === 0) {
            let refreshedSource: Source
            try {
              refreshedSource = await getSource(knowledgeSpaceId, source.id)
            } catch (refreshError) {
              if (responseStatus(refreshError) === 404) {
                clearDraft()
                return
              }
              throw refreshError
            }
            if (!isSameProvisionalSource(draft, refreshedSource)) throw error
            source = refreshedSource
            draft.source = refreshedSource
            draft.deletionRequest = undefined
            continue
          }
          throw error
        }
      }
    },
    [knowledgeSpaceId],
  )

  const resetPreviewPages = useCallback(() => {
    pageMapRef.current.clear()
    pageCursorRef.current = undefined
    setPages([])
    setSelectedPageIds(new Set())
    setPagesLoaded(false)
  }, [])

  const updateRun = useCallback((nextRun: SourceWorkflowRun | undefined) => {
    if (nextRun && pendingCancelRunRef.current?.id === nextRun.id)
      pendingCancelRunRef.current = nextRun
    runRef.current = nextRun
    setRun(nextRun)
  }, [])

  const trackPendingWorkflow = useCallback((request: Promise<SourceWorkflowRun | undefined>) => {
    pendingWorkflowPromiseRef.current = request
    void request.finally(() => {
      if (pendingWorkflowPromiseRef.current === request)
        pendingWorkflowPromiseRef.current = undefined
    })
  }, [])

  const updateWorkflowUncertain = useCallback((uncertain: boolean) => {
    workflowStatusUncertainRef.current = uncertain
    setWorkflowUncertain(uncertain)
  }, [])

  const updateSelectionUncertain = useCallback((uncertain: boolean) => {
    selectionUncertainRef.current = uncertain
    setSelectionUncertain(uncertain)
  }, [])

  const normalizedURL = useMemo(
    () =>
      typeof parameters.url === 'string' ? normalizeWebsiteSourceUrl(parameters.url) : undefined,
    [parameters.url],
  )
  const hasUrlParameter = parameterSchemas.some((parameter) => parameter.name === 'url')
  const parametersValid =
    !missingRequiredDatasourceParameters(parameterSchemas, parameters).length &&
    !invalidDatasourceParameters(parameterSchemas, parameters).length &&
    !(hasUrlParameter && parameters.url && !normalizedURL)
  const configuration = useMemo<CrawlConfiguration | undefined>(
    () =>
      parametersValid &&
      sourceName.trim() &&
      sourceName.trim().length <= NEW_KNOWLEDGE_SOURCE_NAME_MAX_LENGTH
        ? {
            name: sourceName.trim(),
            parameters,
            ...(normalizedURL ? { rootUrl: normalizedURL.toString() } : {}),
            uri: datasourceSourceUri(parameters, providerOption?.key ?? providerName),
          }
        : undefined,
    [normalizedURL, parameters, parametersValid, providerName, providerOption?.key, sourceName],
  )
  const currentConfigurationKey = configuration ? configurationKey(configuration) : undefined
  const previewConfigurationMatches = Boolean(
    currentConfigurationKey && draftRef.current?.configurationKey === currentConfigurationKey,
  )
  const active = Boolean(run && !isTerminal(run.state))
  const successfulPreview = Boolean(
    run &&
    isSuccessful(run.state) &&
    pagesLoaded &&
    pages.length > 0 &&
    previewConfigurationMatches,
  )
  const staleSuccessfulPreview = Boolean(
    run && isSuccessful(run.state) && pagesLoaded && !previewConfigurationMatches,
  )
  const uncertainOperation = workflowUncertain || selectionUncertain
  const shouldPoll = Boolean(
    run && !starting && !stopping && !pollPaused && (active || !pagesLoaded),
  )
  const runId = run?.id
  const locked = starting || stopping || active || uncertainOperation || selectionInteractionLocked
  const dirty = Boolean(
    sourceName ||
    run ||
    JSON.stringify(parameters) !== JSON.stringify(defaultParameters) ||
    JSON.stringify(syncPolicy) !== JSON.stringify(initialSyncPolicyRef.current),
  )
  const host = normalizedURL?.host ?? providerName
  const completedCount = Math.max(run?.progressCompleted ?? 0, pages.length)
  const crawlingStatusText = t(($) => $['newKnowledge.crawlingPages'], {
    count: completedCount,
    host,
  })

  useEffect(() => {
    onInteractionLockChange?.(locked)
  }, [locked, onInteractionLockChange])

  useEffect(
    () => () => {
      onInteractionLockChange?.(false)
      if (submittedRef.current) return
      discardRequestedRef.current = true
      void (async () => {
        try {
          await pendingWorkflowPromiseRef.current
        } catch {
          // Continue best-effort cleanup even if the in-flight workflow request rejected.
        }
        if (submittedRef.current) return
        const draft = draftRef.current
        if (!draft) return
        try {
          await deletePreviewDraftSource(draft)
        } catch {
          // A route or provider switch cannot surface cleanup errors after this owner unmounts.
        }
      })()
    },
    [deletePreviewDraftSource, onInteractionLockChange],
  )
  const togglePreviewPage = useCallback((pageId: string) => {
    setSelectedPageIds((current) => {
      const next = new Set(current)
      if (next.has(pageId)) next.delete(pageId)
      else if (next.size < MAX_PREVIEW_SELECTION) next.add(pageId)
      return next
    })
  }, [])

  useEffect(() => {
    if (!dirty) return
    const preventUnsavedUnload = (event: BeforeUnloadEvent) => {
      if (submittedRef.current) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', preventUnsavedUnload)
    return () => window.removeEventListener('beforeunload', preventUnsavedUnload)
  }, [dirty])

  useEffect(() => {
    if ((!dirty && !historyGuardRef.current) || submittedRef.current) return
    const guardId = historyGuardRef.current ?? createRequestId()
    const currentState =
      window.history.state && typeof window.history.state === 'object' ? window.history.state : {}
    if (!historyGuardRef.current) {
      window.history.pushState(
        { ...currentState, difyUnsavedSourceGuard: guardId },
        '',
        location.href,
      )
      historyGuardRef.current = guardId
    }

    const handlePopState = () => {
      if (submittedRef.current) {
        historyGuardRef.current = undefined
        const complete = historyGuardCompletionRef.current
        historyGuardCompletionRef.current = undefined
        complete?.()
        return
      }
      if (!dirty) {
        window.removeEventListener('popstate', handlePopState)
        historyGuardRef.current = undefined
        window.history.back()
        return
      }
      window.history.pushState(
        { ...currentState, difyUnsavedSourceGuard: guardId },
        '',
        location.href,
      )
      pendingNavigationRef.current = { type: 'back' }
      setDiscardError(false)
      setCancelConfirmationOpen(true)
    }
    const handleLinkClick = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return
      const target = event.target
      if (!(target instanceof Element)) return
      const anchor = target.closest('a[href]')
      if (
        !(anchor instanceof HTMLAnchorElement) ||
        anchor.target === '_blank' ||
        anchor.hasAttribute('download')
      )
        return
      const destination = new URL(anchor.href, location.href)
      if (destination.origin !== location.origin || destination.href === location.href) return
      event.preventDefault()
      event.stopPropagation()
      if (!dirty) {
        submittedRef.current = true
        onDraftFinished?.()
        historyGuardCompletionRef.current = () =>
          router.push(`${destination.pathname}${destination.search}${destination.hash}`)
        window.history.back()
        return
      }
      pendingNavigationRef.current = {
        href: `${destination.pathname}${destination.search}${destination.hash}`,
        type: 'push',
      }
      setDiscardError(false)
      setCancelConfirmationOpen(true)
    }

    window.addEventListener('popstate', handlePopState)
    document.addEventListener('click', handleLinkClick, true)
    return () => {
      window.removeEventListener('popstate', handlePopState)
      document.removeEventListener('click', handleLinkClick, true)
    }
  }, [dirty, onDraftFinished, router])

  const leaveHistoryGuard = useCallback((complete: () => void) => {
    if (!historyGuardRef.current) {
      complete()
      return
    }
    historyGuardCompletionRef.current = complete
    window.history.back()
  }, [])

  const ensureProvisionalSource = useCallback(
    async (nextConfiguration: CrawlConfiguration) => {
      const nextConfigurationKey = configurationKey(nextConfiguration)
      let draft = draftRef.current
      if (!draft || draft.configurationKey !== nextConfigurationKey) {
        draft = {
          clientRequestId: createRequestId(),
          configurationKey: nextConfigurationKey,
          previewRequestId: createRequestId(),
        }
        draftRef.current = draft
      }
      if (draft.source) return draft

      if (draft.creationAttempted) {
        const reconciled = await findProvisionalSource(knowledgeSpaceId, draft.clientRequestId)
        if (reconciled) {
          draft.source = reconciled
          updateWorkflowUncertain(false)
          return draft
        }
        updateWorkflowUncertain(true)
        throw new Error('Provisional source creation is still reconciling')
      }

      draft.creationAttempted = true
      try {
        draft.source = sourceFromApi(
          await consoleClient.knowledgeFs.spaces.byControlSpaceId.sources.post({
            body: {
              connectionId: connection.id,
              metadata: {
                clientRequestId: draft.clientRequestId,
                crawlOptions: {
                  includeSubpages: datasourceIncludeSubpages(nextConfiguration.parameters),
                  limit:
                    typeof nextConfiguration.parameters.limit === 'number'
                      ? nextConfiguration.parameters.limit
                      : 200,
                },
                datasourceParameterMode: 'exact',
                parameters: nextConfiguration.parameters,
                preview: true,
                providerId: connection.providerId,
                providerName,
              },
              name: nextConfiguration.name,
              status: 'disabled',
              type: 'web',
              uri: nextConfiguration.uri,
            },
            params: { control_space_id: knowledgeSpaceId },
          }),
        )
        updateWorkflowUncertain(false)
      } catch (error) {
        if (isDefinitiveRequestFailure(error)) {
          draft.creationAttempted = false
          updateWorkflowUncertain(false)
          throw error
        }
        const reconciled = await findProvisionalSource(knowledgeSpaceId, draft.clientRequestId)
        if (!reconciled) {
          updateWorkflowUncertain(true)
          throw error
        }
        draft.source = reconciled
        updateWorkflowUncertain(false)
      }
      return draft
    },
    [connection.id, connection.providerId, knowledgeSpaceId, providerName, updateWorkflowUncertain],
  )

  const startPreview = useCallback(
    (nextConfiguration: CrawlConfiguration) => {
      if (actionPendingRef.current) return undefined
      actionPendingRef.current = true
      const request = (async () => {
        setStarting(true)
        setRequestError(undefined)
        setPollPaused(false)
        resetPreviewPages()
        updateRun(undefined)
        let draft: PreviewDraft | undefined
        const existingUncertainWorkflow = uncertainWorkflowRef.current
        try {
          const nextConfigurationKey = configurationKey(nextConfiguration)
          const previousDraft = draftRef.current
          if (previousDraft?.source && previousDraft.configurationKey !== nextConfigurationKey) {
            await deletePreviewDraftSource(previousDraft)
          }
          draft = await ensureProvisionalSource(nextConfiguration)
          if (!draft.source) throw new Error('Provisional source is missing')
          if (discardRequestedRef.current) return undefined
          const nextRun = await previewSourceCrawl(
            knowledgeSpaceId,
            draft.source.id,
            draft.previewRequestId,
          )
          uncertainWorkflowRef.current = undefined
          retryFingerprintRef.current = undefined
          cancelFingerprintRef.current = undefined
          retryPredecessorRef.current = undefined
          updateWorkflowUncertain(false)
          if (!discardRequestedRef.current) updateRun(nextRun)
          return nextRun
        } catch (error) {
          if (!isDefinitiveRequestFailure(error) && draft?.source) {
            const previewRequestId = draft.previewRequestId
            const sourceId = draft.source.id
            uncertainWorkflowRef.current = async () => {
              try {
                return await previewSourceCrawl(knowledgeSpaceId, sourceId, previewRequestId)
              } catch {
                return undefined
              }
            }
            updateWorkflowUncertain(true)
          } else if (isDefinitiveRequestFailure(error) && !existingUncertainWorkflow) {
            uncertainWorkflowRef.current = undefined
            updateWorkflowUncertain(false)
          }
          setRequestError('START_FAILED')
          return undefined
        } finally {
          actionPendingRef.current = false
          setStarting(false)
        }
      })()
      pendingWorkflowPromiseRef.current = request
      void request.finally(() => {
        if (pendingWorkflowPromiseRef.current === request)
          pendingWorkflowPromiseRef.current = undefined
      })
      return request
    },
    [
      deletePreviewDraftSource,
      ensureProvisionalSource,
      knowledgeSpaceId,
      resetPreviewPages,
      updateRun,
      updateWorkflowUncertain,
    ],
  )

  const retryRun = useCallback(() => {
    if (!run || actionPendingRef.current) return undefined
    const attemptKey = workflowAttemptKey(run)
    const retryAlreadySent = retryFingerprintRef.current === attemptKey
    const existingUncertainWorkflow = uncertainWorkflowRef.current
    actionPendingRef.current = true
    const request = (async () => {
      setStarting(true)
      setRequestError(undefined)
      setPollPaused(false)
      const acceptRun = (nextRun: SourceWorkflowRun) => {
        uncertainWorkflowRef.current = undefined
        retryFingerprintRef.current = undefined
        cancelFingerprintRef.current = undefined
        retryPredecessorRef.current = run
        updateWorkflowUncertain(false)
        if (!discardRequestedRef.current) {
          resetPreviewPages()
          updateRun(nextRun)
        }
        return nextRun
      }
      try {
        if (retryAlreadySent) {
          try {
            const reconciled = await getSourceWorkflow(knowledgeSpaceId, run.id)
            if (!isRetryConfirmed(run, reconciled)) {
              setRequestError('RETRY_FAILED')
              return undefined
            }
            return acceptRun(reconciled)
          } catch {
            setRequestError('RETRY_FAILED')
            return undefined
          }
        }

        retryFingerprintRef.current = attemptKey
        const reconcileRetry = async () => {
          try {
            const reconciled = await getSourceWorkflow(knowledgeSpaceId, run.id)
            return isRetryConfirmed(run, reconciled) ? reconciled : undefined
          } catch {
            return undefined
          }
        }
        try {
          const retried = await retrySourceWorkflow(knowledgeSpaceId, run.id)
          return acceptRun(retried)
        } catch (error) {
          if (isDefinitiveRequestFailure(error)) {
            if (!existingUncertainWorkflow) {
              retryFingerprintRef.current = undefined
              uncertainWorkflowRef.current = undefined
              updateWorkflowUncertain(false)
            }
            setRequestError('RETRY_FAILED')
            return undefined
          }
          uncertainWorkflowRef.current = reconcileRetry
          updateWorkflowUncertain(true)
          const reconciled = await reconcileRetry()
          if (!reconciled) {
            setRequestError('RETRY_FAILED')
            return undefined
          }
          return acceptRun(reconciled)
        }
      } finally {
        actionPendingRef.current = false
        setStarting(false)
      }
    })()
    pendingWorkflowPromiseRef.current = request
    void request.finally(() => {
      if (pendingWorkflowPromiseRef.current === request)
        pendingWorkflowPromiseRef.current = undefined
    })
    return request
  }, [knowledgeSpaceId, resetPreviewPages, run, updateRun, updateWorkflowUncertain])

  useEffect(() => {
    if (!runId || !shouldPoll) return
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const poll = async () => {
      try {
        const nextRun = await getSourceWorkflow(knowledgeSpaceId, runId)
        if (disposed) return
        const currentRun = runRef.current
        const retryPredecessor = retryPredecessorRef.current
        if (retryPredecessor && sameWorkflowSnapshot(retryPredecessor, nextRun)) {
          if (currentRun && !isTerminal(currentRun.state))
            timer = setTimeout(() => void poll(), POLL_INTERVAL_MS)
          return
        }
        if (
          retryPredecessor &&
          (nextRun.executionAttempts > retryPredecessor.executionAttempts ||
            nextRun.updatedAt > retryPredecessor.updatedAt ||
            nextRun.checkpoint !== retryPredecessor.checkpoint)
        )
          retryPredecessorRef.current = undefined
        if (currentRun && latestWorkflowRun(currentRun, nextRun) === currentRun) {
          if (!isTerminal(currentRun.state)) timer = setTimeout(() => void poll(), POLL_INTERVAL_MS)
          return
        }
        let pageUpdates: Awaited<ReturnType<typeof listWorkflowPageUpdates>>
        const finalSnapshot = isSuccessful(nextRun.state)
        try {
          pageUpdates = await listWorkflowPageUpdates(
            knowledgeSpaceId,
            runId,
            finalSnapshot ? undefined : pageCursorRef.current,
          )
        } catch (error) {
          if (isFailed(nextRun.state) || isCanceled(nextRun.state)) {
            if (cancelFingerprintRef.current === workflowAttemptKey(nextRun))
              cancelFingerprintRef.current = undefined
            updateRun(nextRun)
            setPagesLoaded(true)
            setRequestError(undefined)
            return
          }
          throw error
        }
        if (disposed) return
        let pagesChanged = false
        if (finalSnapshot) {
          const currentPages = [...pageMapRef.current.values()]
          const finalPageMap = new Map(pageUpdates.items.map((page) => [page.pageId, page]))
          pagesChanged =
            currentPages.length !== pageUpdates.items.length ||
            pageUpdates.items.some(
              (page, index) =>
                !currentPages[index] || !previewPagesEqual(currentPages[index], page),
            )
          pageMapRef.current = finalPageMap
        } else {
          for (const page of pageUpdates.items) {
            const current = pageMapRef.current.get(page.pageId)
            if (!current || !previewPagesEqual(current, page)) {
              pageMapRef.current.set(page.pageId, page)
              pagesChanged = true
            }
          }
        }
        pageCursorRef.current = pageUpdates.resumeCursor
        if (
          isTerminal(nextRun.state) &&
          cancelFingerprintRef.current === workflowAttemptKey(nextRun)
        )
          cancelFingerprintRef.current = undefined
        updateRun(nextRun)
        if (pagesChanged) setPages([...pageMapRef.current.values()])
        setPagesLoaded(true)
        setRequestError(undefined)
        if (!isTerminal(nextRun.state)) timer = setTimeout(() => void poll(), POLL_INTERVAL_MS)
      } catch {
        if (disposed) return
        setRequestError('POLL_FAILED')
        setPollPaused(true)
      }
    }

    void poll()
    return () => {
      disposed = true
      if (timer) clearTimeout(timer)
    }
  }, [knowledgeSpaceId, runId, shouldPoll, updateRun])

  const stop = async (targetRun = run) => {
    if (!targetRun || !requiresCancellation(targetRun.state)) return true
    if (actionPendingRef.current) return false
    const attemptKey = workflowAttemptKey(targetRun)
    const cancelAlreadySent = cancelFingerprintRef.current === attemptKey
    actionPendingRef.current = true
    setStopping(true)
    setRequestError(undefined)
    try {
      if (cancelAlreadySent) {
        try {
          const reconciled = await getSourceWorkflow(knowledgeSpaceId, targetRun.id)
          if (!isCancelConfirmed(targetRun, reconciled)) {
            setRequestError('CANCEL_FAILED')
            return false
          }
          cancelFingerprintRef.current = undefined
          updateRun(reconciled)
          return true
        } catch {
          setRequestError('CANCEL_FAILED')
          return false
        }
      }

      cancelFingerprintRef.current = attemptKey
      try {
        const canceled = await cancelSourceWorkflow(knowledgeSpaceId, targetRun.id)
        cancelFingerprintRef.current = undefined
        updateRun(canceled)
        return true
      } catch (error) {
        if (isDefinitiveRequestFailure(error)) {
          cancelFingerprintRef.current = undefined
          setRequestError('CANCEL_FAILED')
          return false
        }
        try {
          const reconciled = await getSourceWorkflow(knowledgeSpaceId, targetRun.id)
          if (!isCancelConfirmed(targetRun, reconciled)) {
            setRequestError('CANCEL_FAILED')
            return false
          } else {
            cancelFingerprintRef.current = undefined
            updateRun(reconciled)
            return true
          }
        } catch {
          setRequestError('CANCEL_FAILED')
          return false
        }
      }
    } finally {
      actionPendingRef.current = false
      setStopping(false)
    }
  }

  const handlePrimaryAction = () => {
    if (!configuration) {
      sourceNameInputRef.current?.focus()
      return
    }
    if (requestError === 'POLL_FAILED' && run) {
      setRequestError(undefined)
      setPollPaused(false)
      return
    }
    if (run && isSuccessful(run.state)) {
      const currentRun = run
      void (async () => {
        if (requiresCancellation(currentRun.state) && !(await stop(currentRun))) return
        const currentKey = configurationKey(configuration)
        if (draftRef.current?.configurationKey === currentKey)
          draftRef.current.previewRequestId = createRequestId()
        await startPreview(configuration)
      })()
      return
    }
    if (run && (isFailed(run.state) || isCanceled(run.state))) {
      const currentKey = configurationKey(configuration)
      if (draftRef.current?.configurationKey === currentKey) {
        void retryRun()
        return
      }
    }
    void startPreview(configuration)
  }

  const handleSubmit = () => handlePrimaryAction()

  const primaryLabel =
    starting || (active && !pollPaused)
      ? t(($) => $['newKnowledge.crawling'])
      : (requestError && requestError !== 'CANCEL_FAILED') ||
          (run && (isFailed(run.state) || isCanceled(run.state)))
        ? t(($) => $['newKnowledge.retryCrawl'])
        : run && isSuccessful(run.state) && pagesLoaded && pages.length === 0
          ? t(($) => $['newKnowledge.adjustAndRecrawl'])
          : t(($) => $['newKnowledge.crawlAndPreview'])
  const canReconcileUncertainOperation =
    uncertainOperation && (requestError === 'START_FAILED' || requestError === 'RETRY_FAILED')

  const showFailure = Boolean(
    requestError === 'START_FAILED' ||
    requestError === 'RETRY_FAILED' ||
    requestError === 'POLL_FAILED' ||
    (run && isFailed(run.state)),
  )
  const showZero = Boolean(
    run &&
    isSuccessful(run.state) &&
    pagesLoaded &&
    pages.length === 0 &&
    previewConfigurationMatches,
  )
  const showSuccess = successfulPreview
  const showCanceled = Boolean(run && isCanceled(run.state))
  const errorCode = run?.lastErrorCode ?? requestError
  const is403 = errorCode?.includes('403')
  const isTimeout =
    errorCode?.toUpperCase().includes('TIMEOUT') ||
    (run ? ['timed_out', 'timeout'].includes(normalizedState(run.state)) : false)
  const isProviderError = errorCode?.toUpperCase().includes('PROVIDER')

  const cancel = () => {
    if (dirty) {
      pendingNavigationRef.current = undefined
      setDiscardError(false)
      setCancelConfirmationOpen(true)
      return
    }
    submittedRef.current = true
    onDraftFinished?.()
    leaveHistoryGuard(() => router.push(newKnowledgeDetailPath(knowledgeSpaceId)))
  }

  const discardAndCancel = async () => {
    if (discarding) return
    setDiscarding(true)
    setDiscardError(false)
    discardRequestedRef.current = true
    let pendingRun = await pendingWorkflowPromiseRef.current
    if (!pendingRun && uncertainWorkflowRef.current)
      pendingRun = await uncertainWorkflowRef.current()
    if (
      !pendingRun &&
      (uncertainWorkflowRef.current ||
        ((workflowStatusUncertainRef.current || selectionUncertainRef.current) &&
          !pendingCancelRunRef.current))
    ) {
      discardRequestedRef.current = false
      setDiscarding(false)
      setDiscardError(true)
      return
    }
    if (pendingRun) {
      uncertainWorkflowRef.current = undefined
      updateWorkflowUncertain(false)
    }
    const runToCancel = pendingRun ?? pendingCancelRunRef.current ?? runRef.current
    if (runToCancel && requiresCancellation(runToCancel.state) && !(await stop(runToCancel))) {
      pendingCancelRunRef.current = runToCancel
      discardRequestedRef.current = false
      resetPreviewPages()
      setPollPaused(false)
      updateRun(runToCancel)
      setDiscarding(false)
      setDiscardError(true)
      return
    }
    const previewDraft = draftRef.current
    if (previewDraft) {
      try {
        await deletePreviewDraftSource(previewDraft)
      } catch {
        discardRequestedRef.current = false
        setDiscarding(false)
        setDiscardError(true)
        return
      }
    }
    pendingCancelRunRef.current = undefined
    retryPredecessorRef.current = undefined
    submittedRef.current = true
    onDraftFinished?.()
    setCancelConfirmationOpen(false)
    const pendingNavigation = pendingNavigationRef.current
    pendingNavigationRef.current = undefined
    leaveHistoryGuard(() => {
      if (pendingNavigation?.type === 'back') window.history.back()
      else
        router.push(
          pendingNavigation?.type === 'push'
            ? pendingNavigation.href
            : newKnowledgeDetailPath(knowledgeSpaceId),
        )
    })
  }

  const handleCancelConfirmationOpenChange = (open: boolean) => {
    if (discarding) return
    setCancelConfirmationOpen(open)
    if (!open) {
      pendingNavigationRef.current = undefined
      setDiscardError(false)
    }
  }

  return (
    <section aria-label={t(($) => $['newKnowledge.crawlAndPreview'])}>
      <p role="status" className="sr-only">
        {t(($) => $['newKnowledge.providerConnected'], { provider: providerName })}
      </p>
      <Form onFormSubmit={handleSubmit}>
        <Fieldset disabled={locked} className="space-y-4">
          <WebsiteDatasourceParameterForm
            additionalPrimaryField={
              <Field name="sourceName" className="gap-1.5">
                <FieldLabel>
                  {t(($) => $['newKnowledge.sourceName'])}
                  <span className="ml-0.5 text-text-destructive">*</span>
                </FieldLabel>
                <Input
                  ref={sourceNameInputRef}
                  type="text"
                  autoComplete="off"
                  required
                  maxLength={NEW_KNOWLEDGE_SOURCE_NAME_MAX_LENGTH}
                  value={sourceName}
                  placeholder={t(($) => $['newKnowledge.sourceNamePlaceholder'])}
                  onValueChange={setSourceName}
                />
              </Field>
            }
            disabled={locked}
            parameters={parameters}
            schemas={parameterSchemas}
            onChange={setParameters}
          />
        </Fieldset>

        {!showSuccess && (
          <Button
            type="submit"
            variant="primary"
            className="mt-4 w-full"
            disabled={
              !configuration ||
              (locked && requestError !== 'POLL_FAILED' && !canReconcileUncertainOperation)
            }
            loading={starting || (active && !pollPaused)}
          >
            {primaryLabel}
          </Button>
        )}
      </Form>

      <div className="mt-4">
        {(!run || staleSuccessfulPreview) && !requestError && <EmptyPreview />}
        {run && active && !pollPaused && (
          <div className="flex h-60 flex-col gap-3.5 overflow-hidden rounded-xl border border-divider-deep bg-background-default-subtle p-3.75">
            <div className="flex h-6 shrink-0 items-center gap-2">
              <span
                aria-hidden
                className="i-ri-loader-4-line size-4 animate-spin text-text-accent"
              />
              <span
                role="status"
                aria-live="polite"
                className="min-w-0 flex-1 truncate system-xs-medium text-text-primary"
                title={crawlingStatusText}
              >
                {crawlingStatusText}
              </span>
              <Button
                type="button"
                variant="ghost-accent"
                size="small"
                className="ml-auto shrink-0"
                disabled={stopping}
                onClick={() => void stop()}
              >
                {stopping
                  ? t(($) => $['newKnowledge.stoppingCrawl'])
                  : t(($) => $['newKnowledge.stopCrawl'])}
              </Button>
            </div>
            {requestError === 'CANCEL_FAILED' && (
              <p role="alert" className="px-4 pb-3 system-xs-regular text-text-destructive">
                {t(($) => $['newKnowledge.crawlFailedDescription'])}
              </p>
            )}
            {run.progressTotal !== undefined && run.progressTotal > 0 && (
              <progress
                max={run.progressTotal}
                value={Math.min(completedCount, run.progressTotal)}
                aria-label={t(($) => $['newKnowledge.crawlProgress'], { host })}
                className="sr-only"
              />
            )}
            <CrawlPageList
              pages={pages}
              loading
              selectedPageIds={selectedPageIds}
              onTogglePage={stopping ? undefined : togglePreviewPage}
            />
          </div>
        )}
        {showSuccess && run && draftRef.current?.source && configuration && (
          <CrawlSelectionForm
            busy={starting || stopping}
            discardRequested={() => discardRequestedRef.current}
            initialSyncMode={
              initialDraft?.syncPolicy === 'daily' ? 'interval' : initialDraft?.syncPolicy
            }
            initialSelectedPageIds={[...selectedPageIds]}
            knowledgeSpaceId={knowledgeSpaceId}
            onCancel={cancel}
            onInteractionLockChange={setSelectionInteractionLocked}
            onRecrawl={handlePrimaryAction}
            onSubmissionUncertainChange={updateSelectionUncertain}
            onSubmitted={() =>
              new Promise<void>((resolve) => {
                pendingNavigationRef.current = undefined
                submittedRef.current = true
                onDraftFinished?.()
                leaveHistoryGuard(resolve)
              })
            }
            onWorkflowPending={trackPendingWorkflow}
            onWorkflowRun={(nextRun) => {
              pendingCancelRunRef.current = nextRun
            }}
            pages={pages}
            rootUrl={configuration.rootUrl}
            run={run}
            showSyncPolicyField={false}
            source={draftRef.current.source}
            syncPolicyValue={syncPolicy}
            workflowUncertain={workflowUncertain}
          />
        )}
        {showCanceled && (
          <div className="overflow-hidden rounded-xl border border-divider-regular">
            <p
              role="status"
              aria-live="polite"
              className="px-4 py-3 system-xs-semibold text-text-primary"
            >
              {t(($) => $['newKnowledge.crawlStopped'])}
            </p>
            <CrawlPageList
              pages={pages}
              selectedPageIds={selectedPageIds}
              onTogglePage={togglePreviewPage}
            />
          </div>
        )}
        {showFailure && (
          <div
            role="alert"
            className="flex min-h-38.75 flex-col items-center justify-center gap-2.5 rounded-xl border border-divider-deep bg-background-default-subtle px-6 py-7 text-center"
          >
            <span aria-hidden className="i-ri-error-warning-fill size-6 text-text-destructive" />
            <p className="system-sm-semibold text-text-primary">
              {t(($) => $['newKnowledge.crawlFailed'], { host })}
            </p>
            <p className="max-w-lg system-xs-regular text-text-tertiary">
              {is403
                ? t(($) => $['newKnowledge.crawlFailed403'])
                : isTimeout
                  ? t(($) => $['newKnowledge.crawlFailedTimeout'])
                  : isProviderError
                    ? t(($) => $['newKnowledge.crawlFailedProvider'], {
                        provider: providerName,
                      })
                    : requestError === 'START_FAILED'
                      ? t(($) => $['newKnowledge.crawlStartFailed'])
                      : t(($) => $['newKnowledge.crawlFailedDescription'])}
            </p>
          </div>
        )}
        {showZero && !showFailure && (
          <div
            role="status"
            aria-live="polite"
            className="flex min-h-38.75 flex-col items-center justify-center gap-2.5 rounded-xl border border-divider-deep bg-background-default-subtle px-6 py-7 text-center"
          >
            <span className="flex size-11 items-center justify-center rounded-[10px] bg-background-section-burn">
              <span aria-hidden className="i-ri-global-line size-5.5 text-text-tertiary" />
            </span>
            <p className="system-sm-semibold text-text-primary">
              {t(($) => $['newKnowledge.noPagesFound'], { host })}
            </p>
            <p className="max-w-lg system-xs-regular text-text-tertiary">
              {t(($) => $['newKnowledge.noPagesFoundDescription'])}
            </p>
          </div>
        )}
      </div>
      {!showSuccess && (
        <div className="mt-5 flex justify-end gap-3 border-t border-divider-subtle pt-4.75">
          <Button type="button" onClick={cancel}>
            {t(($) => $['newKnowledge.cancelAddSource'])}
          </Button>
          <span id="add-source-selection-requirement" className="sr-only">
            {t(($) => $['newKnowledge.addSourceRequiresSelection'])}
          </span>
          <Button variant="primary" disabled aria-describedby="add-source-selection-requirement">
            {t(($) => $['newKnowledge.addSource'])}
          </Button>
        </div>
      )}
      <AlertDialog open={cancelConfirmationOpen} onOpenChange={handleCancelConfirmationOpenChange}>
        <AlertDialogContent>
          <div className="flex flex-col gap-2 p-6 pb-4">
            <AlertDialogTitle className="title-2xl-semi-bold text-text-primary">
              {t(($) => $['newKnowledge.discardSourceChanges'])}
            </AlertDialogTitle>
            <AlertDialogDescription className="system-sm-regular text-text-tertiary">
              {t(($) => $['newKnowledge.discardSourceChangesDescription'])}
            </AlertDialogDescription>
            {discardError && (
              <p role="alert" className="mt-3 system-sm-regular text-text-destructive">
                {t(($) => $['newKnowledge.crawlFailedDescription'])}
              </p>
            )}
          </div>
          <AlertDialogActions>
            <AlertDialogCancelButton disabled={discarding}>
              {t(($) => $['newKnowledge.keepEditing'])}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton
              disabled={discarding}
              loading={discarding}
              onClick={() => void discardAndCancel()}
            >
              {t(($) => $['newKnowledge.discardSourceChangesConfirm'])}
            </AlertDialogConfirmButton>
          </AlertDialogActions>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
