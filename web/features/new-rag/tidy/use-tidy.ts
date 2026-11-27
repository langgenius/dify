/**
 * Server state behind the Tidy page: one hook per surface, so each part of the page asks for
 * what it shows. The actions reject on failure; the surface that started one reports it.
 */
import type {
  KnowledgeFsTidyFindingListResponse,
  KnowledgeFsTidySummaryResponse,
} from '@dify/contracts/api/console/knowledge-fs/types.gen'
import type { Cards } from './card-parts'
import type { FindingKind, FindingStatus, FindingTab } from './kinds'
import type { PlannedAction, RewriteRequest } from './review'
import {
  queryOptions,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { parseAsInteger, parseAsString, parseAsStringLiteral, useQueryState } from 'nuqs'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/console'
import { getHttpErrorStatus } from '@/service/http-error'
import {
  DEFAULT_FINDING_STATUS,
  DEFAULT_FINDING_TAB,
  FILTERABLE_STATUSES,
  FINDING_TABS,
  kindsOfTab,
} from './kinds'
import { planRequests } from './review'

const api = consoleQuery.knowledgeFs.spaces.byControlSpaceId.tidy
const SILENT = { meta: { errorToast: false } } as const
/**
 * What the page shows is read again whenever it is opened (the page itself, or a tab, status or
 * page of a list) and when the window regains focus, whatever the age of the cache: between
 * those and the reviewer's own actions (which invalidate it), an idle page asks for nothing but
 * the summary.
 */
const WATCHED = { ...SILENT, refetchOnMount: 'always', refetchOnWindowFocus: 'always' } as const
/** A scan changes the page on its own, so while one runs everything on it is read this often. */
const SCAN_POLL_MS = 15_000
/**
 * With Tidy on and nothing to scan, only the summary is polled, to notice a scan the page did not
 * start: documents published elsewhere, or work queued a moment after Tidy was enabled or a retry
 * was asked for (the reload that follows those actions can come before the queue shows it). One
 * small request a minute is cheap for a tab left open, and a new scan is still picked up within
 * that minute; the lists start polling with it. With Tidy off nothing is polled.
 */
const IDLE_SUMMARY_POLL_MS = 60_000
/** Cursor value of a list whose last page was already shown. */
const END = 'end'
/**
 * How many API pages of open findings one list loads at once, so that copies and document pairs
 * are grouped over all of them. The API decides how many findings a page holds, so this bounds
 * the requests rather than the findings. A longer list is shown in parts, and no part may speak
 * for a whole group.
 */
export const OPEN_FINDING_PAGE_CAP = 20

type FindingPages = {
  pages: KnowledgeFsTidyFindingListResponse[]
  /** What the summary counted for this list when it was loaded; undefined before a summary. */
  total: number | undefined
}

/** Whether documents wait for a scan or are in one: the only time the page changes by itself. */
export function scanIsActive(summary: KnowledgeFsTidySummaryResponse | undefined) {
  return Boolean(summary && summary.documents.pending + summary.documents.scanning > 0)
}

function countOf(
  summary: KnowledgeFsTidySummaryResponse | undefined,
  status: FindingStatus,
  kind: FindingKind | undefined,
) {
  return summary?.findings
    .filter((row) => row.status === status && (!kind || row.kind === kind))
    .reduce((total, row) => total + row.count, 0)
}

/**
 * One list of findings from `cursor` on. Only open findings are grouped, so only they are loaded
 * past the first page: up to `OPEN_FINDING_PAGE_CAP` pages, following `nextCursor`.
 *
 * The list is polled while a scan can add to it (`live`), and re-reading every page each time
 * would multiply the requests. A poll reads the first page only and keeps the pages behind it
 * while nothing says they changed: the first page is the same and so is the count in the
 * (separately polled) summary. A change deeper in the list that leaves both as they were is
 * therefore seen only on the next full load. After an action of the reviewer's own the list is
 * invalidated and every page is read again.
 */
function findingPagesOptions(
  spaceId: string,
  status: FindingStatus,
  kind: FindingKind | undefined,
  cursor: string | null,
  live: boolean,
) {
  const params = { control_space_id: spaceId }
  const limit = status === 'open' ? OPEN_FINDING_PAGE_CAP : 1
  const page = (at: string | null) =>
    api.findings.get.queryOptions({
      input: {
        params,
        query: { status, ...(kind ? { kind } : {}), ...(at ? { cursor: at } : {}) },
      },
    })
  return queryOptions({
    // Under the key of the findings endpoint, so whatever invalidates its queries reloads this.
    queryKey: [...api.findings.get.key(), 'pages', { params, status, kind, cursor, limit }],
    // The pages are parts of this one cached list, so they are requested without a cache entry
    // each: an invalidated list must not be answered from a page request started before it.
    queryFn: async (context): Promise<FindingPages> => {
      const { client, queryKey, signal } = context
      const first = await page(cursor).queryFn(context)
      const total = countOf(
        client.getQueryData(api.summary.get.queryKey({ input: { params } })),
        status,
        kind,
      )
      const known = client.getQueryData<FindingPages>(queryKey)
      if (
        known &&
        // A list loaded before the summary arrived has no count to compare yet; it takes this one.
        (known.total === undefined || known.total === total) &&
        !client.getQueryState(queryKey)?.isInvalidated &&
        JSON.stringify(known.pages[0]) === JSON.stringify(first)
      )
        return { pages: known.pages, total }
      const pages = [first]
      for (let next = first.nextCursor; next && pages.length < limit;) {
        signal.throwIfAborted()
        const further = await page(next).queryFn(context)
        pages.push(further)
        next = further.nextCursor
      }
      return { pages, total }
    },
    ...WATCHED,
    refetchInterval: live && SCAN_POLL_MS,
  })
}

/** The opt-in settings, scan progress, and the two actions that change how scanning runs. */
export function useTidySettings(spaceId: string) {
  const params = { control_space_id: spaceId }
  const input = { params }
  const client = useQueryClient()
  // How often each query is read depends on what the other returned, so both intervals are worked
  // out from the cache; a change to either renders this hook again.
  const enabled = client.getQueryData(api.settings.get.queryKey({ input }))?.enabled ?? false
  const scanning = enabled && scanIsActive(client.getQueryData(api.summary.get.queryKey({ input })))
  const settings = useQuery(
    api.settings.get.queryOptions({
      input,
      ...WATCHED,
      // A scan can pause itself with an error, which is reported here.
      refetchInterval: scanning && SCAN_POLL_MS,
    }),
  )
  const summary = useQuery(
    api.summary.get.queryOptions({
      input,
      ...WATCHED,
      refetchInterval: scanning ? SCAN_POLL_MS : enabled && IDLE_SUMMARY_POLL_MS,
    }),
  )
  const wasScanningRef = useRef(scanning)
  useEffect(() => {
    // The lists were last polled before the summary said the scan was over, and what the scan
    // found last can lie between the two: read them once more, now that nothing polls them.
    if (wasScanningRef.current && !scanning) {
      void client.refetchQueries({ queryKey: api.findings.get.key(), type: 'active' })
      void client.refetchQueries({ queryKey: api.scans.get.key(), type: 'active' })
    }
    wasScanningRef.current = scanning
  }, [client, scanning])
  const configure = useMutation(api.settings.patch.mutationOptions(SILENT))
  const retry = useMutation(api.retry.post.mutationOptions(SILENT))

  async function save(enabled: boolean, conflicts: boolean) {
    if (!settings.data) return
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
  }
  async function resume() {
    await retry.mutateAsync({ params })
  }
  return {
    settings,
    summary,
    /** Tidy is on and documents are being scanned or wait to be: the page changes by itself. */
    scanning,
    configure,
    retry,
    save,
    resume,
  }
}

/**
 * Documents and how far their scan got, one page at a time (`tidyScanCursor`).
 *
 * The API pages forward only, so the way back is the cursors already passed. They are kept in
 * memory, not in the URL: a link carries the page it shows, and opened anywhere else (or after a
 * reload) its Back leads to the first page.
 */
export function useTidyScans(
  spaceId: string,
  /** A scan is running or waiting (`scanning` of `useTidySettings`). */
  live: boolean,
) {
  const [cursor, setCursor] = useQueryState('tidyScanCursor', parseAsString)
  /** The cursor of every page passed on the way here, oldest first; the first page has none. */
  const [trail, setTrail] = useState<Array<string | null>>([])
  const scans = useQuery(
    api.scans.get.queryOptions({
      input: { params: { control_space_id: spaceId }, query: cursor ? { cursor } : {} },
      ...WATCHED,
      refetchInterval: live && SCAN_POLL_MS,
    }),
  )
  return {
    scans,
    paged: Boolean(cursor),
    previousPage: () => {
      void setCursor(trail.at(-1) ?? null)
      setTrail(trail.slice(0, -1))
    },
    nextPage: () => {
      setTrail([...trail, cursor])
      void setCursor(scans.data?.nextCursor ?? null)
    },
  }
}

/**
 * The review queue for the tab and status in the URL. The API filters one finding kind per
 * request, so a tab of two kinds reads two lists side by side, each with its own cursor.
 *
 * Open findings are loaded whole (see `findingPagesOptions`) and their cards are paged in the
 * browser (`tidyPage`). The cursors only move for handled findings, which come one API page at a
 * time, and for an open list longer than the cap.
 *
 * The API pages forward only, so the way back is the steps already taken. They are kept in
 * memory, not in the URL: a link carries the findings it shows, and opened anywhere else (or
 * after a reload) its Back leads to the first page.
 */
export function useTidyFindings(
  spaceId: string,
  /** A scan is running or waiting (`scanning` of `useTidySettings`). */
  live: boolean,
) {
  const [status, setStatus] = useQueryState(
    'tidyStatus',
    parseAsStringLiteral(FILTERABLE_STATUSES).withDefault(DEFAULT_FINDING_STATUS),
  )
  const [tab, setTab] = useQueryState(
    'tidyKind',
    parseAsStringLiteral(FINDING_TABS).withDefault(DEFAULT_FINDING_TAB),
  )
  const [cursor, setCursor] = useQueryState('tidyCursor', parseAsString)
  const [secondCursor, setSecondCursor] = useQueryState('tidySimilarCursor', parseAsString)
  const [page, setPage] = useQueryState('tidyPage', parseAsInteger.withDefault(1))
  /** Where every feed stood, and the page of cards shown, before each move on; oldest first. */
  const [trail, setTrail] = useState<Array<{ cursors: Array<string | null>; page: number }>>([])
  const [kind, secondKind] = kindsOfTab(tab)
  const feeds = [
    { kind, cursor, setCursor },
    ...(secondKind ? [{ kind: secondKind, cursor: secondCursor, setCursor: setSecondCursor }] : []),
  ]
  const active = feeds.filter((feed) => feed.cursor !== END)
  const lists = useQueries({
    queries: active.map((feed) =>
      findingPagesOptions(spaceId, status, feed.kind, feed.cursor, live),
    ),
  })
  const nextCursors = lists.map((list) => list.data?.pages.at(-1)?.nextCursor ?? null)
  const pages = lists.flatMap((list) => list.data?.pages ?? [])
  // A feed is partial when it does not start at the beginning or does not reach the end.
  const partialKinds =
    status === 'open'
      ? [
          ...feeds.filter((feed) => feed.cursor).map((feed) => feed.kind),
          ...active.filter((_, index) => nextCursors[index]).map((feed) => feed.kind),
        ]
      : []
  const firstPage = () => {
    void setCursor(null)
    void setSecondCursor(null)
    void setPage(null)
    setTrail([])
  }
  return {
    tab,
    status,
    selectTab: (next: FindingTab) => {
      void setTab(next)
      firstPage()
    },
    selectStatus: (next: FindingStatus) => {
      void setStatus(next)
      firstPage()
    },
    loading: lists.some((list) => list.isPending),
    failed: lists.some((list) => list.isError),
    loaded: lists.every((list) => list.data),
    // A list that changes while its pages are read can return a finding on two of them.
    items: [
      ...new Map(pages.flatMap((list) => list.items).map((item) => [item.id, item])).values(),
    ],
    cards: pages.reduce<Cards>((all, list) => ({ ...all, ...list.documents }), {}),
    /**
     * Whether some open findings of `ofKind` are not among `items`, because their list is longer
     * than the cap. Groups of that kind may then lack findings, and so documents. A feed without
     * a kind lists every kind.
     */
    partial: (ofKind?: FindingKind) =>
      partialKinds.some((listed) => !listed || !ofKind || listed === ofKind),
    /** The page of cards within `items`, from 1. */
    page,
    showPage: (next: number) => void setPage(next),
    paged: Boolean(cursor || secondCursor),
    hasNext: nextCursors.some(Boolean),
    /** Returns every list to where it stood before the last move on, at the cards shown then. */
    previousPage: () => {
      const last = trail.at(-1)
      if (!last) {
        firstPage()
        return
      }
      feeds.forEach((feed, index) => void feed.setCursor(last.cursors[index] ?? null))
      void setPage(last.page)
      setTrail(trail.slice(0, -1))
    },
    /** Moves every list on to the findings after the ones loaded; `fromPage` is the page left. */
    nextPage: (fromPage: number) => {
      setTrail([...trail, { cursors: feeds.map((feed) => feed.cursor), page: fromPage }])
      active.forEach((feed, index) => void feed.setCursor(nextCursors[index] ?? END))
      void setPage(null)
    },
  }
}

/** Reviewer decisions on findings. */
export function useTidyActions(spaceId: string) {
  const params = { control_space_id: spaceId }
  const act = useMutation(api.findings.byFindingId.actions.post.mutationOptions(SILENT))

  /**
   * Applies a plan in one request, so a keep-one merge disables every other copy or none. A plan
   * longer than one request may carry is sent in parts; each part is still all or nothing.
   */
  async function run(plan: PlannedAction[]) {
    for (const [first, ...rest] of planRequests(plan)) {
      await act.mutateAsync({
        params: { ...params, finding_id: first.finding.id },
        body: {
          ...stepOf(first),
          ...(rest.length
            ? { also: rest.map((step) => ({ findingId: step.finding.id, ...stepOf(step) })) }
            : {}),
        },
      })
    }
  }
  /** Rewrites the other document's indexed passage in place and settles the finding. */
  async function adopt(request: RewriteRequest, text: string) {
    await act.mutateAsync({
      params: { ...params, finding_id: request.finding.id },
      body: {
        action: 'adopt',
        expectedRevision: request.finding.revision,
        documentId: request.keptDocumentId,
        replacement: text,
      },
    })
  }
  return { act, run, adopt }
}

/** What to tell the reviewer when an action was refused. */
export function useActionError() {
  const { t } = useTranslation(['knowledgeSpace'])
  return (cause: unknown) =>
    getHttpErrorStatus(cause) === 409 ? t(($) => $['tidy.stale']) : t(($) => $['tidy.error'])
}

/**
 * Runs actions for one surface (the page, or one dialog) and keeps their failure on that
 * surface, so a failed dialog action is never reported on the page behind it.
 */
export function useAttempt(describe: (cause: unknown) => string) {
  const [error, setError] = useState<string>()
  return {
    error,
    clear: () => setError(undefined),
    attempt: async (action: () => Promise<void>) => {
      setError(undefined)
      try {
        await action()
      } catch (cause) {
        setError(describe(cause))
      }
    },
  }
}

function stepOf<Action extends PlannedAction['action']>(step: PlannedAction & { action: Action }) {
  return {
    action: step.action,
    expectedRevision: step.finding.revision,
    ...(step.documentId ? { documentId: step.documentId } : {}),
  }
}
