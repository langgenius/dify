'use client'

import type {
  GetKnowledgeSpacesByIdSourceWorkflowsByRunIdPagesResponse,
  Source,
  SourceWorkflowRun,
} from '@dify/contracts/knowledge-fs/types.gen'
import { Button } from '@langgenius/dify-ui/button'
import { Checkbox } from '@langgenius/dify-ui/checkbox'
import { cn } from '@langgenius/dify-ui/cn'
import { Field, FieldError, FieldLabel } from '@langgenius/dify-ui/field'
import { Form } from '@langgenius/dify-ui/form'
import { Input } from '@langgenius/dify-ui/input'
import { NumberField, NumberFieldGroup, NumberFieldInput } from '@langgenius/dify-ui/number-field'
import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { consoleClient } from '@/service/client'

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
  reconciliationAttempts?: number
  source?: Source
}

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
const MAX_PAGE_LIMIT = 1000
const MAX_SOURCE_NAME_LENGTH = 200
const MAX_SOURCE_RECONCILIATION_ATTEMPTS = 3
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

function normalizeURL(value: string) {
  try {
    const url = new URL(value.trim())
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      !url.hostname ||
      url.username ||
      url.password
    )
      return undefined
    url.hash = ''
    return url
  } catch {
    return undefined
  }
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
      (isTerminal(previous.state) && !isTerminal(current.state)))
  )
}

function isCancelConfirmed(current: SourceWorkflowRun) {
  return isTerminal(current.state)
}

function createRequestId() {
  return globalThis.crypto.randomUUID()
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
              <span className="size-4 animate-pulse rounded bg-background-section motion-reduce:animate-none" />
              <span className="min-w-0 flex-1 space-y-1.5">
                <span className="block h-3 w-2/3 animate-pulse rounded bg-background-section motion-reduce:animate-none" />
                <span className="block h-2.5 w-full animate-pulse rounded bg-background-section motion-reduce:animate-none" />
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
  knowledgeSpaceId,
  onDraftChange,
  onPendingOperation,
  onProvisionalSource,
  providerName,
}: {
  connection: ConnectionReference
  knowledgeSpaceId: string
  onDraftChange?: (dirty: boolean) => void
  onPendingOperation?: (operation: Promise<void>) => void
  onProvisionalSource?: (source: Source) => void
  providerName: string
}) {
  const { t } = useTranslation('dataset')
  const rootUrlErrorId = useId()
  const [rootUrl, setRootUrl] = useState('')
  const [sourceName, setSourceName] = useState('')
  const [urlTouched, setUrlTouched] = useState(false)
  const [optionsExpanded, setOptionsExpanded] = useState(false)
  const [includeSubpages, setIncludeSubpages] = useState(true)
  const [pageLimit, setPageLimit] = useState(DEFAULT_PAGE_LIMIT)
  const [run, setRun] = useState<SourceWorkflowRun>()
  const [previewConfiguration, setPreviewConfiguration] = useState<CrawlConfiguration>()
  const [pages, setPages] = useState<PreviewPage[]>([])
  const [pagesLoaded, setPagesLoaded] = useState(false)
  const [starting, setStarting] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [pollPaused, setPollPaused] = useState(false)
  const [requestError, setRequestError] = useState<string>()
  const draftRef = useRef<PreviewDraft | undefined>(undefined)
  const actionPendingRef = useRef(false)
  const retryFingerprintRef = useRef<string | undefined>(undefined)
  const cancelFingerprintRef = useRef<string | undefined>(undefined)
  const rootUrlInputRef = useRef<HTMLInputElement>(null)
  const sourceNameInputRef = useRef<HTMLInputElement>(null)
  const pageMapRef = useRef(new Map<string, PreviewPage>())
  const pageCursorRef = useRef<string | undefined>(undefined)

  const resetPreviewPages = useCallback(() => {
    pageMapRef.current.clear()
    pageCursorRef.current = undefined
    setPages([])
    setPagesLoaded(false)
  }, [])

  const normalizedURL = useMemo(() => normalizeURL(rootUrl), [rootUrl])
  const normalizedLimit = Math.min(Math.max(Math.trunc(pageLimit) || 1, 1), MAX_PAGE_LIMIT)
  const configuration = useMemo<CrawlConfiguration | undefined>(
    () =>
      normalizedURL && sourceName.trim() && sourceName.trim().length <= MAX_SOURCE_NAME_LENGTH
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
  const shouldPoll = Boolean(
    run && !starting && !stopping && !pollPaused && (active || !pagesLoaded),
  )
  const runId = run?.id
  const locked = starting || stopping || active
  const draftHost = normalizedURL?.host ?? ''
  const previewHost = previewConfiguration ? new URL(previewConfiguration.url).host : draftHost
  const completedCount = Math.max(run?.progressCompleted ?? 0, pages.length)
  const crawlingStatusText = t(($) => $['newKnowledge.crawlingPages'], {
    count: completedCount,
    host: previewHost,
  })
  const completedStatusText = t(($) => $['newKnowledge.pagesCrawled'], {
    count: pages.length,
    host: previewHost,
  })
  const hasDraftChanges = Boolean(
    rootUrl ||
    sourceName ||
    !includeSubpages ||
    pageLimit !== DEFAULT_PAGE_LIMIT ||
    run ||
    requestError,
  )

  useEffect(() => {
    onDraftChange?.(hasDraftChanges)
  }, [hasDraftChanges, onDraftChange])

  useEffect(
    () => () => {
      onDraftChange?.(false)
    },
    [onDraftChange],
  )

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
          onProvisionalSource?.(reconciled)
          return draft
        }
        draft.reconciliationAttempts = (draft.reconciliationAttempts ?? 0) + 1
        if (draft.reconciliationAttempts < MAX_SOURCE_RECONCILIATION_ATTEMPTS)
          throw new Error('Provisional source creation is still reconciling')
        draft.creationAttempted = false
        draft.reconciliationAttempts = 0
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
        onProvisionalSource?.(draft.source)
      } catch (error) {
        if (isDefinitiveRequestFailure(error)) {
          draft.creationAttempted = false
          draft.reconciliationAttempts = 0
          throw error
        }
        const reconciled = await findProvisionalSource(knowledgeSpaceId, draft.clientRequestId)
        if (!reconciled) {
          draft.reconciliationAttempts = (draft.reconciliationAttempts ?? 0) + 1
          throw error
        }
        draft.source = reconciled
        onProvisionalSource?.(reconciled)
      }
      return draft
    },
    [connection.id, connection.providerId, knowledgeSpaceId, onProvisionalSource],
  )

  const startPreview = useCallback(
    async (nextConfiguration: CrawlConfiguration, forceNewRun = false) => {
      if (actionPendingRef.current) return
      actionPendingRef.current = true
      setStarting(true)
      setRequestError(undefined)
      setPollPaused(false)
      setPreviewConfiguration(nextConfiguration)
      resetPreviewPages()
      setRun(undefined)
      try {
        const draft = await ensureProvisionalSource(nextConfiguration)
        if (!draft.source) throw new Error('Provisional source is missing')
        if (forceNewRun) draft.previewRequestId = createRequestId()
        const nextRun =
          await consoleClient.knowledgeFs.postKnowledgeSpacesByIdSourcesBySourceIdCrawlPreview({
            headers: { 'Idempotency-Key': draft.previewRequestId },
            params: { id: knowledgeSpaceId, sourceId: draft.source.id },
          })
        setRun(nextRun)
      } catch {
        setRequestError('START_FAILED')
      } finally {
        actionPendingRef.current = false
        setStarting(false)
      }
    },
    [ensureProvisionalSource, knowledgeSpaceId, resetPreviewPages],
  )

  const retryRun = useCallback(async () => {
    if (!run || actionPendingRef.current) return
    const attemptKey = workflowAttemptKey(run)
    const retryAlreadySent = retryFingerprintRef.current === attemptKey
    actionPendingRef.current = true
    setStarting(true)
    setRequestError(undefined)
    setPollPaused(false)
    try {
      if (retryAlreadySent) {
        try {
          const reconciled =
            await consoleClient.knowledgeFs.getKnowledgeSpacesByIdSourceWorkflowsByRunId({
              params: { id: knowledgeSpaceId, runId: run.id },
            })
          if (!isRetryConfirmed(run, reconciled)) {
            setRequestError('RETRY_FAILED')
            return
          }
          resetPreviewPages()
          setRun(reconciled)
        } catch {
          setRequestError('RETRY_FAILED')
        }
        return
      }

      retryFingerprintRef.current = attemptKey
      try {
        const retried =
          await consoleClient.knowledgeFs.postKnowledgeSpacesByIdSourceWorkflowsByRunIdRetry({
            params: { id: knowledgeSpaceId, runId: run.id },
          })
        resetPreviewPages()
        setRun(retried)
      } catch (error) {
        if (isDefinitiveRequestFailure(error)) {
          retryFingerprintRef.current = undefined
          setRequestError('RETRY_FAILED')
          return
        }
        try {
          const reconciled =
            await consoleClient.knowledgeFs.getKnowledgeSpacesByIdSourceWorkflowsByRunId({
              params: { id: knowledgeSpaceId, runId: run.id },
            })
          if (!isRetryConfirmed(run, reconciled)) {
            setRequestError('RETRY_FAILED')
          } else {
            resetPreviewPages()
            setRun(reconciled)
          }
        } catch {
          setRequestError('RETRY_FAILED')
        }
      }
    } finally {
      actionPendingRef.current = false
      setStarting(false)
    }
  }, [knowledgeSpaceId, resetPreviewPages, run])

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
            setRun(nextRun)
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
        setRun(nextRun)
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
  }, [knowledgeSpaceId, runId, shouldPoll])

  const stop = async () => {
    if (!run || actionPendingRef.current || !active) return
    const attemptKey = workflowAttemptKey(run)
    const cancelAlreadySent = cancelFingerprintRef.current === attemptKey
    actionPendingRef.current = true
    setStopping(true)
    setRequestError(undefined)
    try {
      if (cancelAlreadySent) {
        try {
          const reconciled =
            await consoleClient.knowledgeFs.getKnowledgeSpacesByIdSourceWorkflowsByRunId({
              params: { id: knowledgeSpaceId, runId: run.id },
            })
          if (!isCancelConfirmed(reconciled)) {
            setRequestError('CANCEL_FAILED')
            return
          }
          cancelFingerprintRef.current = undefined
          setRun(reconciled)
        } catch {
          setRequestError('CANCEL_FAILED')
        }
        return
      }

      cancelFingerprintRef.current = attemptKey
      try {
        const canceled =
          await consoleClient.knowledgeFs.postKnowledgeSpacesByIdSourceWorkflowsByRunIdCancel({
            body: { reason: 'user_requested' },
            params: { id: knowledgeSpaceId, runId: run.id },
          })
        cancelFingerprintRef.current = undefined
        setRun(canceled)
      } catch (error) {
        if (isDefinitiveRequestFailure(error)) {
          cancelFingerprintRef.current = undefined
          setRequestError('CANCEL_FAILED')
          return
        }
        try {
          const reconciled =
            await consoleClient.knowledgeFs.getKnowledgeSpacesByIdSourceWorkflowsByRunId({
              params: { id: knowledgeSpaceId, runId: run.id },
            })
          if (!isCancelConfirmed(reconciled)) {
            setRequestError('CANCEL_FAILED')
          } else {
            cancelFingerprintRef.current = undefined
            setRun(reconciled)
          }
        } catch {
          setRequestError('CANCEL_FAILED')
        }
      }
    } finally {
      actionPendingRef.current = false
      setStopping(false)
    }
  }

  const dispatchOperation = (operation: Promise<void>) => {
    onPendingOperation?.(operation)
    void operation
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
    if (run && isSuccessful(run.state)) {
      const currentKey = configurationKey(configuration)
      dispatchOperation(
        startPreview(configuration, draftRef.current?.configurationKey === currentKey),
      )
      return
    }
    if (run && (isFailed(run.state) || isCanceled(run.state))) {
      const currentKey = configurationKey(configuration)
      if (draftRef.current?.configurationKey === currentKey) {
        dispatchOperation(retryRun())
        return
      }
    }
    dispatchOperation(startPreview(configuration))
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

  const showFailure = Boolean(
    requestError === 'START_FAILED' ||
    requestError === 'RETRY_FAILED' ||
    requestError === 'POLL_FAILED' ||
    (run && isFailed(run.state)),
  )
  const showZero = Boolean(run && isSuccessful(run.state) && pagesLoaded && pages.length === 0)
  const showSuccess = Boolean(run && isSuccessful(run.state) && pages.length > 0)
  const showCanceled = Boolean(run && isCanceled(run.state))
  const errorCode = run?.lastErrorCode ?? requestError
  const is403 = errorCode?.includes('403')
  const isTimeout =
    errorCode?.toUpperCase().includes('TIMEOUT') ||
    (run ? ['timed_out', 'timeout'].includes(normalizedState(run.state)) : false)
  const isProviderError = errorCode?.toUpperCase().includes('PROVIDER')

  return (
    <section aria-label={t(($) => $['newKnowledge.crawlAndPreview'])}>
      <p role="status" className="sr-only">
        {t(($) => $['newKnowledge.providerConnected'], { provider: providerName })}
      </p>
      <Form onFormSubmit={handleSubmit}>
        <div className={cn('mt-4 space-y-4', locked && 'opacity-70')}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field
              name="root-url"
              className="gap-1.5"
              disabled={locked}
              invalid={urlTouched && !normalizedURL}
              touched={urlTouched}
            >
              <FieldLabel>
                {t(($) => $['newKnowledge.rootUrl'])}
                <span aria-hidden className="ml-0.5 text-text-destructive">
                  *
                </span>
              </FieldLabel>
              <Input
                ref={rootUrlInputRef}
                name="root-url"
                type="url"
                required
                value={rootUrl}
                autoComplete="off"
                placeholder={t(($) => $['newKnowledge.rootUrlPlaceholder'])}
                onBlur={() => setUrlTouched(true)}
                onValueChange={setRootUrl}
              />
              <FieldError id={rootUrlErrorId} match={urlTouched && !normalizedURL}>
                {t(($) => $['newKnowledge.invalidRootUrl'])}
              </FieldError>
            </Field>
            <Field name="source-name" className="gap-1.5" disabled={locked}>
              <FieldLabel>
                {t(($) => $['newKnowledge.sourceName'])}
                <span aria-hidden className="ml-0.5 text-text-destructive">
                  *
                </span>
              </FieldLabel>
              <Input
                ref={sourceNameInputRef}
                name="source-name"
                type="text"
                required
                maxLength={MAX_SOURCE_NAME_LENGTH}
                value={sourceName}
                autoComplete="off"
                placeholder={t(($) => $['newKnowledge.sourceNamePlaceholder'])}
                onValueChange={setSourceName}
              />
              <FieldError match="valueMissing">
                {t(($) => $['newKnowledge.sourceNameRequired'])}
              </FieldError>
            </Field>
          </div>
          <div className="overflow-hidden rounded-lg border border-components-option-card-option-border bg-background-default">
            <button
              type="button"
              aria-expanded={optionsExpanded}
              disabled={locked}
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
              {!optionsExpanded && includeSubpages && pageLimit === DEFAULT_PAGE_LIMIT && (
                <span className="ml-auto system-xs-regular text-text-tertiary">
                  {t(($) => $['newKnowledge.usingDefaults'])}
                </span>
              )}
            </button>
            {optionsExpanded && (
              <div className="grid grid-cols-1 gap-3 border-t border-divider-subtle p-3 sm:grid-cols-2">
                <Field name="include-subpages" className="block" disabled={locked}>
                  <FieldLabel className="flex h-9 items-center gap-2 system-xs-regular text-text-secondary">
                    <Checkbox
                      name="include-subpages"
                      checked={includeSubpages}
                      onCheckedChange={setIncludeSubpages}
                    />
                    {t(($) => $['newKnowledge.includeSubpages'])}
                  </FieldLabel>
                </Field>
                <Field
                  name="page-limit"
                  className="grid grid-cols-[1fr_6rem] items-center gap-2"
                  disabled={locked}
                >
                  <FieldLabel className="system-xs-regular text-text-secondary">
                    {t(($) => $['newKnowledge.maxPages'])}
                  </FieldLabel>
                  <NumberField
                    disabled={locked}
                    min={1}
                    max={MAX_PAGE_LIMIT}
                    value={pageLimit}
                    onValueChange={(value) => setPageLimit(value ?? 1)}
                  >
                    <NumberFieldGroup>
                      <NumberFieldInput name="page-limit" autoComplete="off" />
                    </NumberFieldGroup>
                  </NumberField>
                </Field>
              </div>
            )}
          </div>
        </div>

        {!showSuccess && (
          <Button
            type="submit"
            variant="primary"
            className="mt-4 w-full"
            disabled={locked && requestError !== 'POLL_FAILED'}
            loading={starting}
          >
            {primaryLabel}
          </Button>
        )}
      </Form>

      <div className="mt-4">
        {!run && !requestError && <EmptyPreview />}
        {run && active && !pollPaused && (
          <div className="overflow-hidden rounded-xl border border-divider-regular">
            <div className="flex flex-wrap items-center gap-2 px-4 py-3">
              <span
                aria-hidden
                className="i-ri-loader-4-line size-4 animate-spin text-text-accent motion-reduce:animate-none"
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
                onClick={() => dispatchOperation(stop())}
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
                aria-label={t(($) => $['newKnowledge.crawlProgress'], { host: previewHost })}
                className="block h-1 w-full accent-state-accent-solid"
              />
            )}
            <CrawlPageList pages={pages} loading />
          </div>
        )}
        {showSuccess && (
          <div className="overflow-hidden rounded-xl border border-divider-regular">
            <div className="flex flex-wrap items-center gap-2 px-4 py-3">
              <p
                role="status"
                aria-live="polite"
                className="min-w-0 flex-1 truncate system-xs-semibold text-text-primary"
                title={completedStatusText}
              >
                {completedStatusText}
              </p>
              <Button
                type="button"
                variant="tertiary"
                size="small"
                className="ml-auto shrink-0"
                disabled={starting || !configuration}
                loading={starting}
                onClick={handlePrimaryAction}
              >
                {t(($) => $['newKnowledge.reCrawl'])}
              </Button>
            </div>
            <CrawlPageList pages={pages} />
          </div>
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
              {t(($) => $['newKnowledge.crawlFailed'], { host: previewHost })}
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
              {t(($) => $['newKnowledge.noPagesFound'], { host: previewHost })}
            </p>
            <p className="mt-2 max-w-lg system-xs-regular text-text-tertiary">
              {t(($) => $['newKnowledge.noPagesFoundDescription'])}
            </p>
          </div>
        )}
      </div>
    </section>
  )
}
