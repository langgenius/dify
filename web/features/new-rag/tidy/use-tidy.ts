/**
 * Server state behind the Tidy page: one hook per surface, so each part of the page asks for
 * what it shows. The actions reject on failure; the surface that started one reports it.
 */
import type {
  KnowledgeFsTidyFindingListResponse,
  KnowledgeFsTidySummaryResponse,
} from '@dify/contracts/api/console/knowledge-fs/types.gen'
import type { FindingKind, FindingStatus, FindingTab } from './kinds'
import type { PlannedAction, RewriteRequest } from './review'
import type { Cards } from './review-cards'
import { queryOptions, useMutation, useQueries, useQuery } from '@tanstack/react-query'
import { parseAsInteger, parseAsString, parseAsStringLiteral, useQueryState } from 'nuqs'
import { useState } from 'react'
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
/** Scanning runs in the background, so every list on the page refreshes on its own. */
const POLLED = { meta: { errorToast: false }, refetchInterval: 15000 } as const
const SILENT = { meta: { errorToast: false } } as const
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
 * The list is polled, and re-reading every page each time would multiply the requests. A poll
 * reads the first page only and keeps the pages behind it while nothing says they changed: the
 * first page is the same and so is the count in the (separately polled) summary. A change deeper
 * in the list that leaves both as they were is therefore seen only on the next full load. After
 * an action of the reviewer's own the list is invalidated and every page is read again.
 */
function findingPagesOptions(
  spaceId: string,
  status: FindingStatus,
  kind: FindingKind | undefined,
  cursor: string | null,
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
    ...POLLED,
  })
}

/** The opt-in settings, scan progress, and the two actions that change how scanning runs. */
export function useTidySettings(spaceId: string) {
  const params = { control_space_id: spaceId }
  const settings = useQuery(api.settings.get.queryOptions({ input: { params }, ...POLLED }))
  const summary = useQuery(api.summary.get.queryOptions({ input: { params }, ...POLLED }))
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
  return { settings, summary, configure, retry, save, resume }
}

/** Documents and how far their scan got, one page at a time (`tidyScanCursor`). */
export function useTidyScans(spaceId: string) {
  const [cursor, setCursor] = useQueryState('tidyScanCursor', parseAsString)
  const scans = useQuery(
    api.scans.get.queryOptions({
      input: { params: { control_space_id: spaceId }, query: cursor ? { cursor } : {} },
      ...POLLED,
    }),
  )
  return {
    scans,
    paged: Boolean(cursor),
    firstPage: () => void setCursor(null),
    nextPage: () => void setCursor(scans.data?.nextCursor ?? null),
  }
}

/**
 * The review queue for the tab and status in the URL. The API filters one finding kind per
 * request, so a tab of two kinds reads two lists side by side, each with its own cursor.
 *
 * Open findings are loaded whole (see `findingPagesOptions`) and their cards are paged in the
 * browser (`tidyPage`). The cursors only move for handled findings, which come one API page at a
 * time, and for an open list longer than the cap.
 */
export function useTidyFindings(spaceId: string) {
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
  const [kind, secondKind] = kindsOfTab(tab)
  const feeds = [
    { kind, cursor, setCursor },
    ...(secondKind ? [{ kind: secondKind, cursor: secondCursor, setCursor: setSecondCursor }] : []),
  ]
  const active = feeds.filter((feed) => feed.cursor !== END)
  const lists = useQueries({
    queries: active.map((feed) => findingPagesOptions(spaceId, status, feed.kind, feed.cursor)),
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
    firstPage,
    /** Moves every list on to the findings after the ones loaded. */
    nextPage: () => {
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
