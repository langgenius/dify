'use client'

import type {
  GetKnowledgeSpacesByIdSourceWorkflowsByRunIdPagesResponse,
  Source,
  SourceWorkflowRun,
} from '@dify/contracts/knowledge-fs/types.gen'
import type { FormEvent } from 'react'
import type { NewKnowledgeWebsiteSourceDraft } from './routes'
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
import { cn } from '@langgenius/dify-ui/cn'
import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useRouter } from '@/next/navigation'
import { consoleClient } from '@/service/client'
import { CrawlSelectionForm } from './crawl-selection-form'
import { createRequestId } from './request-id'
import {
  NEW_KNOWLEDGE_SOURCE_NAME_MAX_LENGTH,
  NEW_KNOWLEDGE_SOURCE_URL_MAX_LENGTH,
  newKnowledgeDetailPath,
  normalizeWebsiteSourceUrl,
} from './routes'

type ConnectionReference = {
  id: string
  providerId: string
}

type PreviewPage = GetKnowledgeSpacesByIdSourceWorkflowsByRunIdPagesResponse['items'][number]

type CrawlConfiguration = {
  includeSubpages: boolean
  limit: number
  name: string
  url: string
}

type PreviewDraft = {
  clientRequestId: string
  configurationKey: string
  creationAttempted?: boolean
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
const DEFAULT_PAGE_LIMIT = 100
const MAX_PAGE_LIMIT = 200
const SUCCESS_STATES = new Set(['complete', 'completed', 'preview_ready', 'success', 'succeeded'])
const FAILURE_STATES = new Set(['error', 'exhausted', 'failed', 'timed_out', 'timeout'])
const CANCELED_STATES = new Set(['canceled', 'cancelled', 'superseded'])

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

function configurationKey(configuration: CrawlConfiguration) {
  return JSON.stringify(configuration)
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
    const response =
      await consoleClient.knowledgeFs.getKnowledgeSpacesByIdSourceWorkflowsByRunIdPages({
        params: { id: knowledgeSpaceId, runId },
        query: { ...(cursor ? { cursor } : {}), limit: PAGE_SIZE },
      })
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
    const response = await consoleClient.knowledgeFs.getKnowledgeSpacesByIdSources({
      params: { id: knowledgeSpaceId },
      query: { ...(cursor ? { cursor } : {}), limit: PAGE_SIZE },
    })
    const source = response.items.find(
      (candidate) => candidate.metadata.clientRequestId === clientRequestId,
    )
    if (source) return source
    const nextCursor = response.nextCursor
    if (!nextCursor || seenCursors.has(nextCursor)) return undefined
    seenCursors.add(nextCursor)
    cursor = nextCursor
  } while (cursor)

  return undefined
}

const CrawlPageList = memo(
  ({ loading = false, pages }: { loading?: boolean; pages: PreviewPage[] }) => {
    if (!pages.length && !loading) return null

    return (
      <ul className="max-h-64 divide-y divide-divider-subtle overflow-y-auto" aria-live="polite">
        {pages.map((page) => (
          <li
            key={page.pageId}
            className="flex items-start gap-2.5 px-4 py-2.5 [contain-intrinsic-size:auto_40px] [content-visibility:auto]"
          >
            <input
              type="checkbox"
              disabled
              aria-label={page.title || page.sourceUrl}
              className="mt-0.5 size-4"
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
          [0, 1].map((placeholder) => (
            <li
              key={`placeholder-${placeholder}`}
              data-testid="crawl-page-skeleton"
              aria-hidden
              className="flex items-start gap-2.5 px-4 py-2.5"
            >
              <span className="size-4 animate-pulse rounded bg-background-section" />
              <span className="min-w-0 flex-1 space-y-1.5">
                <span className="block h-3 w-2/3 animate-pulse rounded bg-background-section" />
                <span className="block h-2.5 w-full animate-pulse rounded bg-background-section" />
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
    <div className="flex min-h-40 flex-col items-center justify-center rounded-xl border border-dashed border-divider-regular px-6 text-center">
      <span className="flex size-10 items-center justify-center rounded-lg bg-background-section">
        <span aria-hidden className="i-ri-global-line size-5 text-text-tertiary" />
      </span>
      <p className="mt-2 system-xs-semibold text-text-primary">
        {t(($) => $['newKnowledge.pagesAppearTitle'])}
      </p>
      <p className="mt-2 system-xs-regular text-text-tertiary">
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
  providerName = 'Firecrawl',
}: {
  connection: ConnectionReference
  initialDraft?: NewKnowledgeWebsiteSourceDraft
  knowledgeSpaceId: string
  onDraftFinished?: () => void
  providerName?: string
}) {
  const { t } = useTranslation('dataset')
  const router = useRouter()
  const rootUrlErrorId = useId()
  const [rootUrl, setRootUrl] = useState(initialDraft?.rootUrl ?? '')
  const [sourceName, setSourceName] = useState(initialDraft?.sourceName ?? '')
  const [urlTouched, setUrlTouched] = useState(false)
  const [optionsExpanded, setOptionsExpanded] = useState(false)
  const [includeSubpages, setIncludeSubpages] = useState(initialDraft?.includeSubpages ?? true)
  const [pageLimit, setPageLimit] = useState<number | ''>(() => {
    const initialLimit = initialDraft?.maxPages
    return initialLimit && initialLimit > 0 && initialLimit <= MAX_PAGE_LIMIT
      ? initialLimit
      : DEFAULT_PAGE_LIMIT
  })
  const [run, setRun] = useState<SourceWorkflowRun>()
  const [pages, setPages] = useState<PreviewPage[]>([])
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
  const workflowStatusUncertainRef = useRef(false)
  const selectionUncertainRef = useRef(false)
  const draftRef = useRef<PreviewDraft | undefined>(undefined)
  const actionPendingRef = useRef(false)
  const retryFingerprintRef = useRef<string | undefined>(undefined)
  const cancelFingerprintRef = useRef<string | undefined>(undefined)
  const rootUrlInputRef = useRef<HTMLInputElement>(null)
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

  const resetPreviewPages = useCallback(() => {
    pageMapRef.current.clear()
    pageCursorRef.current = undefined
    setPages([])
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

  const normalizedURL = useMemo(() => normalizeWebsiteSourceUrl(rootUrl), [rootUrl])
  const normalizedLimit =
    typeof pageLimit === 'number'
      ? Math.min(Math.max(Math.trunc(pageLimit) || 1, 1), MAX_PAGE_LIMIT)
      : DEFAULT_PAGE_LIMIT
  const configuration = useMemo<CrawlConfiguration | undefined>(
    () =>
      normalizedURL &&
      sourceName.trim() &&
      sourceName.trim().length <= NEW_KNOWLEDGE_SOURCE_NAME_MAX_LENGTH
        ? {
            includeSubpages,
            limit: normalizedLimit,
            name: sourceName.trim(),
            url: normalizedURL.toString(),
          }
        : undefined,
    [includeSubpages, normalizedLimit, normalizedURL, sourceName],
  )
  const active = Boolean(run && !isTerminal(run.state))
  const successfulPreview = Boolean(
    run && isSuccessful(run.state) && pagesLoaded && pages.length > 0,
  )
  const uncertainOperation = workflowUncertain || selectionUncertain
  const shouldPoll = Boolean(
    run && !starting && !stopping && !pollPaused && (active || !pagesLoaded),
  )
  const runId = run?.id
  const locked = starting || stopping || active || successfulPreview || uncertainOperation
  const dirty = Boolean(
    rootUrl || sourceName || run || !includeSubpages || pageLimit !== DEFAULT_PAGE_LIMIT,
  )
  const host = normalizedURL?.host ?? ''
  const completedCount = Math.max(run?.progressCompleted ?? 0, pages.length)
  const crawlingStatusText = t(($) => $['newKnowledge.crawlingPages'], {
    count: completedCount,
    host,
  })

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
        draft.source = await consoleClient.knowledgeFs.postKnowledgeSpacesByIdSources({
          body: {
            connectionId: connection.id,
            metadata: {
              clientRequestId: draft.clientRequestId,
              crawlOptions: {
                includeSubpages: nextConfiguration.includeSubpages,
                limit: nextConfiguration.limit,
              },
              preview: true,
              providerId: connection.providerId,
            },
            name: nextConfiguration.name,
            status: 'disabled',
            type: 'web',
            uri: nextConfiguration.url,
          },
          params: { id: knowledgeSpaceId },
        })
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
    [connection.id, connection.providerId, knowledgeSpaceId, updateWorkflowUncertain],
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
          draft = await ensureProvisionalSource(nextConfiguration)
          if (!draft.source) throw new Error('Provisional source is missing')
          if (discardRequestedRef.current) return undefined
          const nextRun =
            await consoleClient.knowledgeFs.postKnowledgeSpacesByIdSourcesBySourceIdCrawlPreview({
              headers: { 'Idempotency-Key': draft.previewRequestId },
              params: { id: knowledgeSpaceId, sourceId: draft.source.id },
            })
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
                return await consoleClient.knowledgeFs.postKnowledgeSpacesByIdSourcesBySourceIdCrawlPreview(
                  {
                    headers: { 'Idempotency-Key': previewRequestId },
                    params: { id: knowledgeSpaceId, sourceId },
                  },
                )
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
            const reconciled =
              await consoleClient.knowledgeFs.getKnowledgeSpacesByIdSourceWorkflowsByRunId({
                params: { id: knowledgeSpaceId, runId: run.id },
              })
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
            const reconciled =
              await consoleClient.knowledgeFs.getKnowledgeSpacesByIdSourceWorkflowsByRunId({
                params: { id: knowledgeSpaceId, runId: run.id },
              })
            return isRetryConfirmed(run, reconciled) ? reconciled : undefined
          } catch {
            return undefined
          }
        }
        try {
          const retried =
            await consoleClient.knowledgeFs.postKnowledgeSpacesByIdSourceWorkflowsByRunIdRetry({
              params: { id: knowledgeSpaceId, runId: run.id },
            })
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
        const nextRun =
          await consoleClient.knowledgeFs.getKnowledgeSpacesByIdSourceWorkflowsByRunId({
            params: { id: knowledgeSpaceId, runId },
          })
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
    if (!targetRun || isTerminal(targetRun.state)) return true
    if (actionPendingRef.current) return false
    const attemptKey = workflowAttemptKey(targetRun)
    const cancelAlreadySent = cancelFingerprintRef.current === attemptKey
    actionPendingRef.current = true
    setStopping(true)
    setRequestError(undefined)
    try {
      if (cancelAlreadySent) {
        try {
          const reconciled =
            await consoleClient.knowledgeFs.getKnowledgeSpacesByIdSourceWorkflowsByRunId({
              params: { id: knowledgeSpaceId, runId: targetRun.id },
            })
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
        const canceled =
          await consoleClient.knowledgeFs.postKnowledgeSpacesByIdSourceWorkflowsByRunIdCancel({
            body: { reason: 'user_requested' },
            params: { id: knowledgeSpaceId, runId: targetRun.id },
          })
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
          const reconciled =
            await consoleClient.knowledgeFs.getKnowledgeSpacesByIdSourceWorkflowsByRunId({
              params: { id: knowledgeSpaceId, runId: targetRun.id },
            })
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
      setUrlTouched(true)
      if (!normalizedURL) rootUrlInputRef.current?.focus()
      else sourceNameInputRef.current?.focus()
      return
    }
    if (requestError === 'POLL_FAILED' && run) {
      setRequestError(undefined)
      setPollPaused(false)
      return
    }
    if (run && (isFailed(run.state) || isSuccessful(run.state) || isCanceled(run.state))) {
      const currentKey = configurationKey(configuration)
      if (draftRef.current?.configurationKey === currentKey) {
        void retryRun()
        return
      }
    }
    void startPreview(configuration)
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    handlePrimaryAction()
  }

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
  const showZero = Boolean(run && isSuccessful(run.state) && pagesLoaded && pages.length === 0)
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
    if (runToCancel && !isTerminal(runToCancel.state) && !(await stop(runToCancel))) {
      pendingCancelRunRef.current = runToCancel
      discardRequestedRef.current = false
      resetPreviewPages()
      setPollPaused(false)
      updateRun(runToCancel)
      setDiscarding(false)
      setDiscardError(true)
      return
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
      <form onSubmit={handleSubmit}>
        <fieldset disabled={locked} className="mt-4 space-y-4 disabled:opacity-70">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="system-xs-medium text-text-secondary">
                {t(($) => $['newKnowledge.rootUrl'])}
                <span className="ml-0.5 text-text-destructive">*</span>
              </span>
              <input
                ref={rootUrlInputRef}
                type="url"
                required
                maxLength={NEW_KNOWLEDGE_SOURCE_URL_MAX_LENGTH}
                value={rootUrl}
                placeholder={t(($) => $['newKnowledge.rootUrlPlaceholder'])}
                aria-invalid={urlTouched && !normalizedURL}
                aria-describedby={urlTouched && !normalizedURL ? rootUrlErrorId : undefined}
                onBlur={() => setUrlTouched(true)}
                onChange={(event) => setRootUrl(event.target.value)}
                className={cn(
                  'mt-1.5 h-9 w-full rounded-lg border-0 bg-components-input-bg-normal px-3 system-sm-regular text-text-primary outline-hidden focus:ring-2 focus:ring-state-accent-solid',
                  urlTouched && !normalizedURL && 'ring-1 ring-text-destructive',
                )}
              />
              {urlTouched && !normalizedURL && (
                <span
                  id={rootUrlErrorId}
                  className="mt-1 block system-xs-regular text-text-destructive"
                >
                  {t(($) => $['newKnowledge.invalidRootUrl'])}
                </span>
              )}
            </label>
            <label className="block">
              <span className="system-xs-medium text-text-secondary">
                {t(($) => $['newKnowledge.sourceName'])}
                <span className="ml-0.5 text-text-destructive">*</span>
              </span>
              <input
                ref={sourceNameInputRef}
                type="text"
                required
                maxLength={NEW_KNOWLEDGE_SOURCE_NAME_MAX_LENGTH}
                value={sourceName}
                placeholder={t(($) => $['newKnowledge.sourceNamePlaceholder'])}
                onChange={(event) => setSourceName(event.target.value)}
                className="mt-1.5 h-9 w-full rounded-lg border-0 bg-components-input-bg-normal px-3 system-sm-regular text-text-primary outline-hidden focus:ring-2 focus:ring-state-accent-solid"
              />
            </label>
          </div>
          <div className="overflow-hidden rounded-lg border border-components-option-card-option-border bg-background-default">
            <button
              type="button"
              aria-expanded={optionsExpanded}
              className="flex h-9 w-full items-center gap-2 px-3 text-left outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:ring-inset"
              onClick={() => setOptionsExpanded((expanded) => !expanded)}
            >
              <span
                aria-hidden
                className={cn(
                  'i-ri-arrow-right-s-line size-4 text-text-tertiary transition-transform',
                  optionsExpanded && 'rotate-90',
                )}
              />
              <span className="system-xs-medium text-text-primary">
                {t(($) => $['newKnowledge.crawlOptions'])}
              </span>
              {!optionsExpanded && (
                <span className="ml-auto system-xs-regular text-text-tertiary">
                  {t(($) => $['newKnowledge.usingDefaults'])}
                </span>
              )}
            </button>
            {optionsExpanded && (
              <div className="grid grid-cols-1 gap-3 border-t border-divider-subtle p-3 sm:grid-cols-2">
                <label className="flex h-9 items-center gap-2 system-xs-regular text-text-secondary">
                  <input
                    type="checkbox"
                    checked={includeSubpages}
                    onChange={(event) => setIncludeSubpages(event.target.checked)}
                  />
                  {t(($) => $['newKnowledge.includeSubpages'])}
                </label>
                <label className="flex items-center gap-2">
                  <span className="system-xs-regular text-text-secondary">
                    {t(($) => $['newKnowledge.maxPages'])}
                  </span>
                  <input
                    type="number"
                    min={1}
                    max={MAX_PAGE_LIMIT}
                    value={pageLimit}
                    onBlur={() => {
                      if (pageLimit === '') setPageLimit(DEFAULT_PAGE_LIMIT)
                    }}
                    onChange={(event) =>
                      setPageLimit(
                        Number.isFinite(event.target.valueAsNumber)
                          ? Math.min(
                              Math.max(Math.trunc(event.target.valueAsNumber), 1),
                              MAX_PAGE_LIMIT,
                            )
                          : '',
                      )
                    }
                    className="ml-auto h-8 w-24 rounded-lg border-0 bg-components-input-bg-normal px-2 system-xs-regular text-text-primary outline-hidden focus:ring-2 focus:ring-state-accent-solid"
                  />
                </label>
              </div>
            )}
          </div>
        </fieldset>

        {!showSuccess && (
          <Button
            type="submit"
            variant="primary"
            className="mt-4 w-full"
            disabled={
              !configuration ||
              (locked && requestError !== 'POLL_FAILED' && !canReconcileUncertainOperation)
            }
            loading={starting}
          >
            {primaryLabel}
          </Button>
        )}
      </form>

      <div className="mt-4">
        {!run && !requestError && <EmptyPreview />}
        {run && active && !pollPaused && (
          <div className="overflow-hidden rounded-xl border border-divider-regular">
            <div className="flex flex-wrap items-center gap-2 px-4 py-3">
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
                variant="tertiary"
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
                className="block h-1 w-full accent-state-accent-solid"
              />
            )}
            <CrawlPageList pages={pages} loading />
          </div>
        )}
        {showSuccess && run && draftRef.current?.source && configuration && (
          <CrawlSelectionForm
            busy={starting}
            discardRequested={() => discardRequestedRef.current}
            initialSyncMode={
              initialDraft?.syncPolicy === 'daily' ? 'interval' : initialDraft?.syncPolicy
            }
            knowledgeSpaceId={knowledgeSpaceId}
            onCancel={cancel}
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
            rootUrl={configuration.url}
            run={run}
            source={draftRef.current.source}
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
            <CrawlPageList pages={pages} />
          </div>
        )}
        {showFailure && (
          <div
            role="alert"
            className="flex min-h-36 flex-col items-center justify-center rounded-xl border border-divider-regular px-6 text-center"
          >
            <span aria-hidden className="i-ri-error-warning-fill size-6 text-text-destructive" />
            <p className="mt-2 system-sm-semibold text-text-primary">
              {t(($) => $['newKnowledge.crawlFailed'], { host })}
            </p>
            <p className="mt-1 max-w-lg system-xs-regular text-text-tertiary">
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
            className="flex min-h-40 flex-col items-center justify-center rounded-xl border border-divider-regular px-6 text-center"
          >
            <span className="flex size-10 items-center justify-center rounded-lg bg-background-section">
              <span aria-hidden className="i-ri-global-line size-5 text-text-tertiary" />
            </span>
            <p className="mt-2 system-xs-semibold text-text-primary">
              {t(($) => $['newKnowledge.noPagesFound'], { host })}
            </p>
            <p className="mt-2 max-w-lg system-xs-regular text-text-tertiary">
              {t(($) => $['newKnowledge.noPagesFoundDescription'])}
            </p>
          </div>
        )}
      </div>
      {!showSuccess && (
        <div className="mt-4 flex justify-end gap-2 border-t border-divider-subtle pt-5">
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
          <div>
            <AlertDialogTitle className="title-2xl-semi-bold text-text-primary">
              {t(($) => $['newKnowledge.discardSourceChanges'])}
            </AlertDialogTitle>
            <AlertDialogDescription className="mt-2 system-sm-regular text-text-tertiary">
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
