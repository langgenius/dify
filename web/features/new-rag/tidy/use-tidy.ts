/**
 * Server state behind the Tidy page: one hook per surface, so each part of the page asks for
 * what it shows. The actions reject on failure; the surface that started one reports it.
 */
import type { FindingStatus, FindingTab } from './kinds'
import type { PlannedAction, RewriteRequest } from './review'
import type { Cards } from './review-cards'
import { skipToken, useMutation, useQuery } from '@tanstack/react-query'
import { parseAsString, parseAsStringLiteral, useQueryState } from 'nuqs'
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
 * request, so a tab of two kinds pages two lists side by side, each with its own cursor.
 */
export function useTidyFindings(spaceId: string) {
  const params = { control_space_id: spaceId }
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
  const [kind, secondKind] = kindsOfTab(tab)
  const firstActive = cursor !== END
  const secondActive = secondKind !== undefined && secondCursor !== END
  const first = useQuery(
    api.findings.get.queryOptions({
      input: {
        params,
        query: { status, ...(kind ? { kind } : {}), ...(cursor ? { cursor } : {}) },
      },
      ...POLLED,
      enabled: firstActive,
    }),
  )
  const second = useQuery(
    api.findings.get.queryOptions({
      input: secondKind
        ? {
            params,
            query: { status, kind: secondKind, ...(secondCursor ? { cursor: secondCursor } : {}) },
          }
        : skipToken,
      ...POLLED,
      enabled: secondActive,
    }),
  )
  const lists = [...(firstActive ? [first] : []), ...(secondActive ? [second] : [])]
  const firstPage = () => {
    void setCursor(null)
    void setSecondCursor(null)
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
    items: lists.flatMap((list) => list.data?.items ?? []),
    cards: lists.reduce<Cards>((all, list) => ({ ...all, ...list.data?.documents }), {}),
    paged: Boolean(cursor || secondCursor),
    hasNext: lists.some((list) => list.data?.nextCursor),
    firstPage,
    nextPage: () => {
      if (firstActive) void setCursor(first.data?.nextCursor ?? END)
      if (secondActive) void setSecondCursor(second.data?.nextCursor ?? END)
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
