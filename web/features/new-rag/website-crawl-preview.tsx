'use client'

import type {
  GetKnowledgeSpacesByIdSourceWorkflowsByRunIdPagesResponse,
  Source,
  SourceWorkflowRun,
} from '@dify/contracts/knowledge-fs/types.gen'
import type { FormEvent } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
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
  source?: Source
}

const PAGE_SIZE = 200
const MAX_CURSOR_PAGES = 100
const POLL_INTERVAL_MS = 1500
const DEFAULT_PAGE_LIMIT = 100
const MAX_PAGE_LIMIT = 1000
const MAX_SOURCE_NAME_LENGTH = 200
const SUCCESS_STATES = new Set(['complete', 'completed', 'success', 'succeeded'])
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

function workflowFingerprint(run: SourceWorkflowRun) {
  return `${run.id}:${run.executionAttempts}:${run.updatedAt}:${normalizedState(run.state)}`
}

function createRequestId() {
  return globalThis.crypto.randomUUID()
}

async function listWorkflowPages(knowledgeSpaceId: string, runId: string) {
  const pages = new Map<string, PreviewPage>()
  const seenCursors = new Set<string>()
  let cursor: string | undefined
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
  } while (cursor)

  return [...pages.values()]
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

function CrawlPageList({ pages }: { pages: PreviewPage[] }) {
  if (!pages.length) return null

  return (
    <ul className="max-h-64 divide-y divide-divider-subtle overflow-y-auto" aria-live="polite">
      {pages.map((page) => (
        <li key={page.pageId} className="flex items-start gap-2.5 px-4 py-2.5">
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
    </ul>
  )
}

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
}: {
  connection: ConnectionReference
  knowledgeSpaceId: string
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
  const host = normalizedURL?.host ?? ''
  const completedCount = Math.max(run?.progressCompleted ?? 0, pages.length)

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
          return draft
        }
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
      } catch (error) {
        const reconciled = await findProvisionalSource(knowledgeSpaceId, draft.clientRequestId)
        if (!reconciled) throw error
        draft.source = reconciled
      }
      return draft
    },
    [connection.id, connection.providerId, knowledgeSpaceId],
  )

  const startPreview = useCallback(
    async (nextConfiguration: CrawlConfiguration) => {
      if (actionPendingRef.current) return
      actionPendingRef.current = true
      setStarting(true)
      setRequestError(undefined)
      setPollPaused(false)
      setPages([])
      setPagesLoaded(false)
      setRun(undefined)
      try {
        const draft = await ensureProvisionalSource(nextConfiguration)
        if (!draft.source) throw new Error('Provisional source is missing')
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
    [ensureProvisionalSource, knowledgeSpaceId],
  )

  const retryRun = useCallback(async () => {
    if (!run || actionPendingRef.current) return
    const fingerprint = workflowFingerprint(run)
    const retryAlreadySent = retryFingerprintRef.current === fingerprint
    if (!retryAlreadySent) retryFingerprintRef.current = fingerprint
    actionPendingRef.current = true
    setStarting(true)
    setRequestError(undefined)
    setPollPaused(false)
    try {
      const retried = retryAlreadySent
        ? await consoleClient.knowledgeFs.getKnowledgeSpacesByIdSourceWorkflowsByRunId({
            params: { id: knowledgeSpaceId, runId: run.id },
          })
        : await consoleClient.knowledgeFs.postKnowledgeSpacesByIdSourceWorkflowsByRunIdRetry({
            params: { id: knowledgeSpaceId, runId: run.id },
          })
      if (retryAlreadySent && workflowFingerprint(retried) === fingerprint) {
        retryFingerprintRef.current = undefined
        setRequestError('RETRY_FAILED')
        return
      }
      setPages([])
      setPagesLoaded(false)
      setRun(retried)
    } catch {
      try {
        const reconciled =
          await consoleClient.knowledgeFs.getKnowledgeSpacesByIdSourceWorkflowsByRunId({
            params: { id: knowledgeSpaceId, runId: run.id },
          })
        if (workflowFingerprint(reconciled) === fingerprint) {
          retryFingerprintRef.current = undefined
          setRequestError('RETRY_FAILED')
        } else {
          setPages([])
          setPagesLoaded(false)
          setRun(reconciled)
        }
      } catch {
        setRequestError('RETRY_FAILED')
      }
    } finally {
      actionPendingRef.current = false
      setStarting(false)
    }
  }, [knowledgeSpaceId, run])

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
        let nextPages: PreviewPage[]
        try {
          nextPages = await listWorkflowPages(knowledgeSpaceId, runId)
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
        setRun(nextRun)
        setPages(nextPages)
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
    const fingerprint = workflowFingerprint(run)
    const cancelAlreadySent = cancelFingerprintRef.current === fingerprint
    if (!cancelAlreadySent) cancelFingerprintRef.current = fingerprint
    actionPendingRef.current = true
    setStopping(true)
    setRequestError(undefined)
    try {
      const canceled = cancelAlreadySent
        ? await consoleClient.knowledgeFs.getKnowledgeSpacesByIdSourceWorkflowsByRunId({
            params: { id: knowledgeSpaceId, runId: run.id },
          })
        : await consoleClient.knowledgeFs.postKnowledgeSpacesByIdSourceWorkflowsByRunIdCancel({
            body: { reason: 'user_requested' },
            params: { id: knowledgeSpaceId, runId: run.id },
          })
      if (cancelAlreadySent && workflowFingerprint(canceled) === fingerprint) {
        cancelFingerprintRef.current = undefined
        setRequestError('CANCEL_FAILED')
        return
      }
      setRun(canceled)
    } catch {
      try {
        const reconciled =
          await consoleClient.knowledgeFs.getKnowledgeSpacesByIdSourceWorkflowsByRunId({
            params: { id: knowledgeSpaceId, runId: run.id },
          })
        if (workflowFingerprint(reconciled) === fingerprint) {
          cancelFingerprintRef.current = undefined
          setRequestError('CANCEL_FAILED')
        } else {
          setRun(reconciled)
        }
      } catch {
        setRequestError('CANCEL_FAILED')
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
        {t(($) => $['newKnowledge.providerConnected'])}
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
                maxLength={MAX_SOURCE_NAME_LENGTH}
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
                    onChange={(event) =>
                      setPageLimit(
                        Number.isFinite(event.target.valueAsNumber)
                          ? event.target.valueAsNumber
                          : 1,
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
            disabled={!configuration || (locked && requestError !== 'POLL_FAILED')}
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
            <div className="flex items-center gap-2 px-4 py-3" role="status" aria-live="polite">
              <span
                aria-hidden
                className="i-ri-loader-4-line size-4 animate-spin text-text-accent"
              />
              <span className="system-xs-medium text-text-primary">
                {t(($) => $['newKnowledge.crawlingPages'], {
                  count: completedCount,
                  host,
                })}
              </span>
              <Button
                type="button"
                variant="tertiary"
                size="small"
                className="ml-auto"
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
                className="block h-1 w-full accent-state-accent-solid"
              />
            )}
            <CrawlPageList pages={pages} />
            {!pages.length && (
              <div className="space-y-3 px-4 pb-4" aria-hidden>
                <div className="h-8 animate-pulse rounded-md bg-background-section" />
                <div className="h-8 animate-pulse rounded-md bg-background-section" />
              </div>
            )}
          </div>
        )}
        {showSuccess && (
          <div className="overflow-hidden rounded-xl border border-divider-regular">
            <div className="flex items-center gap-2 px-4 py-3">
              <p role="status" aria-live="polite" className="system-xs-semibold text-text-primary">
                {t(($) => $['newKnowledge.pagesCrawled'], { count: pages.length, host })}
              </p>
              <Button
                type="button"
                variant="tertiary"
                size="small"
                className="ml-auto"
                disabled={!configuration}
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
              {t(($) => $['newKnowledge.crawlFailed'], { host })}
            </p>
            <p className="mt-1 max-w-lg system-xs-regular text-text-tertiary">
              {is403
                ? t(($) => $['newKnowledge.crawlFailed403'])
                : isTimeout
                  ? t(($) => $['newKnowledge.crawlFailedTimeout'])
                  : isProviderError
                    ? t(($) => $['newKnowledge.crawlFailedProvider'])
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
    </section>
  )
}
