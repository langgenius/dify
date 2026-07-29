'use client'

import type { KnowledgeFsBadCaseResponse } from '@dify/contracts/api/console/knowledge-fs/types.gen'
import type { GoldenQuestionDraft } from './types'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { toast } from '@langgenius/dify-ui/toast'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import { useRouter, useSearchParams } from '@/next/navigation'
import { consoleClient, consoleQuery } from '@/service/client'
import { newKnowledgeQualityPath, newKnowledgeRetrievalTestPath } from '../routes'
import { GoldenQuestionDialog } from './golden-question-dialog'

const emptyDraft: GoldenQuestionDraft = { annotation: '', question: '', tags: [] }
const goldenLinkPrefix = 'golden-question:'
const pageSize = 50

function createIdempotencyKey() {
  return `quality-replay-${
    globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
  }`
}

function visibleTags(tags: string[]) {
  return tags.filter((tag) => !tag.startsWith(goldenLinkPrefix))
}

function linkedGoldenQuestionId(tags: string[]) {
  return tags.find((tag) => tag.startsWith(goldenLinkPrefix))?.slice(goldenLinkPrefix.length)
}

function Reason({ reason }: { reason: string }) {
  const { t } = useTranslation('dataset')
  const normalized = reason.toLowerCase()
  if (normalized.includes('outdated'))
    return t(($) => $['newKnowledge.qualityPage.reasonValues.outdatedContent'])
  if (normalized.includes('retrieval') || normalized.includes('miss'))
    return t(($) => $['newKnowledge.qualityPage.reasonValues.retrievalMiss'])
  if (normalized.includes('coverage') || normalized.includes('evidence'))
    return t(($) => $['newKnowledge.qualityPage.reasonValues.coverageGap'])
  return reason
}

function RowMenuTrigger({ disabled, label }: { disabled?: boolean; label: string }) {
  return (
    <DropdownMenuTrigger
      aria-label={label}
      disabled={disabled}
      className="ml-auto flex size-7 items-center justify-center rounded-md text-text-tertiary outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid disabled:cursor-not-allowed disabled:text-text-disabled"
    >
      <span aria-hidden className="i-ri-more-fill size-[18px]" />
    </DropdownMenuTrigger>
  )
}

function Status({ status }: { status: KnowledgeFsBadCaseResponse['status'] }) {
  const { t } = useTranslation('dataset')
  const visibleStatus = status === 'dismissed' ? 'fixed' : status
  return (
    <div className="flex h-5 items-center gap-1.5 system-xs-medium text-text-primary">
      <span
        aria-hidden
        className={cn(
          'size-1.5 rounded-sm border shadow-xs',
          visibleStatus === 'open' &&
            'border-util-colors-warning-warning-600 bg-util-colors-warning-warning-400 shadow-util-colors-warning-warning-200',
          visibleStatus === 'replaying' &&
            'border-util-colors-blue-light-blue-light-600 bg-util-colors-blue-light-blue-light-400 shadow-util-colors-blue-light-blue-light-200',
          visibleStatus === 'fixed' &&
            'border-util-colors-green-green-600 bg-util-colors-green-green-400 shadow-util-colors-green-green-200',
        )}
      />
      {t(($) => $[`newKnowledge.qualityPage.status.${visibleStatus}`])}
    </div>
  )
}

export function QualityPage({ knowledgeSpaceId }: { knowledgeSpaceId: string }) {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const router = useRouter()
  const searchParams = useSearchParams()
  const queryClient = useQueryClient()
  const activeTab = searchParams.get('tab') === 'bad-cases' ? 'bad' : 'golden'
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [deleteIds, setDeleteIds] = useState<Set<string>>()
  const [deleteSubmitting, setDeleteSubmitting] = useState(false)
  const [dialogError, setDialogError] = useState<string>()
  const [dialogSubmitting, setDialogSubmitting] = useState(false)
  const [pendingBadCaseId, setPendingBadCaseId] = useState<string>()
  const replayIdempotencyKeysRef = useRef(new Map<string, string>())
  const pendingGoldenQuestionIdsRef = useRef(new Map<string, string>())
  const [dialog, setDialog] = useState<
    | { key: string; mode: 'create'; value: GoldenQuestionDraft }
    | { id: string; key: string; mode: 'edit'; value: GoldenQuestionDraft }
    | { id: string; key: string; mode: 'promote'; value: GoldenQuestionDraft }
  >()
  const goldenQueryOptions =
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.goldenQuestions.get.infiniteOptions({
      input: (pageParam) => ({
        params: { control_space_id: knowledgeSpaceId },
        query: {
          limit: pageSize,
          ...(typeof pageParam === 'string' ? { cursor: pageParam } : {}),
        },
      }),
      getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
      initialPageParam: null as string | null,
    })
  const badCaseQueryOptions =
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.quality.badCases.get.infiniteOptions({
      input: (pageParam) => ({
        params: { control_space_id: knowledgeSpaceId },
        query: {
          limit: pageSize,
          ...(typeof pageParam === 'string' ? { cursor: pageParam } : {}),
        },
      }),
      getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
      initialPageParam: null as string | null,
    })
  const goldenQuery = useInfiniteQuery(goldenQueryOptions)
  const badCaseQuery = useInfiniteQuery(badCaseQueryOptions)
  const createGoldenMutation = useMutation(
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.goldenQuestions.post.mutationOptions(),
  )
  const updateGoldenMutation = useMutation(
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.goldenQuestions.byQuestionId.patch.mutationOptions(),
  )
  const deleteGoldenMutation = useMutation(
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.goldenQuestions.byQuestionId.delete.mutationOptions(),
  )
  const goldenQuestions = goldenQuery.data?.pages.flatMap((page) => page.data) ?? []
  const badCases = (badCaseQuery.data?.pages.flatMap((page) => page.data) ?? []).filter(
    (item) => item.status !== 'dismissed',
  )
  const unresolvedBadCases = badCases.filter((item) => item.status !== 'fixed').length
  const allSelected = goldenQuestions.length > 0 && selected.size === goldenQuestions.length
  const partiallySelected = selected.size > 0 && !allSelected
  const setTab = (tab: 'bad' | 'golden') => {
    if (tab === 'bad') setSelected(new Set())
    router.replace(
      tab === 'bad'
        ? `${newKnowledgeQualityPath(knowledgeSpaceId)}?tab=bad-cases`
        : newKnowledgeQualityPath(knowledgeSpaceId),
    )
  }
  const updated = (value: string) => {
    const time = new Date(value)
    const elapsedHours = Math.max(0, (Date.now() - time.getTime()) / 3_600_000)
    const relativeTime = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
    if (elapsedHours < 1) return relativeTime.format(0, 'minute')
    if (elapsedHours < 24) return relativeTime.format(-Math.floor(elapsedHours), 'hour')
    const elapsedDays = Math.floor(elapsedHours / 24)
    if (elapsedDays < 7) return relativeTime.format(-elapsedDays, 'day')
    return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }).format(time)
  }

  const invalidateQuality = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: goldenQueryOptions.queryKey }),
      queryClient.invalidateQueries({ queryKey: badCaseQueryOptions.queryKey }),
    ])
  }

  const getBadCase = (badCaseId: string) =>
    consoleClient.knowledgeFs.spaces.byControlSpaceId.quality.badCases.byBadCaseId.get({
      params: { bad_case_id: badCaseId, control_space_id: knowledgeSpaceId },
    })

  const ensureLinkedGoldenQuestion = async (
    item: KnowledgeFsBadCaseResponse,
    draft: GoldenQuestionDraft,
  ) => {
    const current = await getBadCase(item.id)
    const linkedId = linkedGoldenQuestionId(current.tags)

    let goldenQuestionId = pendingGoldenQuestionIdsRef.current.get(item.id)
    if (!goldenQuestionId) {
      const created = await createGoldenMutation.mutateAsync({
        body: {
          ...draft,
          source_bad_case_id: item.id,
        },
        params: { control_space_id: knowledgeSpaceId },
      })
      goldenQuestionId = created.id
      pendingGoldenQuestionIdsRef.current.set(item.id, goldenQuestionId)
    }
    if (linkedId === goldenQuestionId) {
      pendingGoldenQuestionIdsRef.current.delete(item.id)
      return { badCase: current, goldenQuestionId }
    }

    try {
      const badCase =
        await consoleClient.knowledgeFs.spaces.byControlSpaceId.quality.badCases.byBadCaseId.patch({
          body: {
            expected_revision: current.revision,
            status: current.status,
            tags: [...visibleTags(current.tags), `${goldenLinkPrefix}${goldenQuestionId}`],
          },
          params: { bad_case_id: current.id, control_space_id: knowledgeSpaceId },
        })
      pendingGoldenQuestionIdsRef.current.delete(item.id)
      return { badCase, goldenQuestionId }
    } catch (error) {
      const refreshed = await getBadCase(item.id).catch(() => undefined)
      if (refreshed && linkedGoldenQuestionId(refreshed.tags) === goldenQuestionId) {
        pendingGoldenQuestionIdsRef.current.delete(item.id)
        return { badCase: refreshed, goldenQuestionId }
      }
      throw error
    }
  }

  const submitDialog = async (draft: GoldenQuestionDraft) => {
    if (!dialog) return
    setDialogError(undefined)
    setDialogSubmitting(true)
    try {
      if (dialog.mode === 'edit') {
        await updateGoldenMutation.mutateAsync({
          body: draft,
          params: { control_space_id: knowledgeSpaceId, question_id: dialog.id },
        })
        toast.success(t(($) => $['newKnowledge.qualityPage.updatedToast']))
      } else if (dialog.mode === 'create') {
        await createGoldenMutation.mutateAsync({
          body: {
            ...draft,
          },
          params: { control_space_id: knowledgeSpaceId },
        })
        toast.success(t(($) => $['newKnowledge.qualityPage.createdToast']))
      } else {
        const badCase = badCases.find((item) => item.id === dialog.id)
        if (!badCase) throw new Error('Bad case is unavailable')
        await ensureLinkedGoldenQuestion(badCase, draft)
        toast.success(t(($) => $['newKnowledge.qualityPage.promotedToast']))
      }
      await invalidateQuality()
      setDialog(undefined)
    } catch {
      setDialogError(t(($) => $.unknownError))
    } finally {
      setDialogSubmitting(false)
    }
  }

  const deleteGolden = async (ids: Set<string>): Promise<boolean> => {
    setDeleteSubmitting(true)
    try {
      await Promise.all(
        [...ids].map((questionId) =>
          deleteGoldenMutation.mutateAsync({
            params: { control_space_id: knowledgeSpaceId, question_id: questionId },
          }),
        ),
      )
      setSelected(new Set())
      await queryClient.invalidateQueries({ queryKey: goldenQueryOptions.queryKey })
      toast.success(
        t(
          ($) =>
            $[
              ids.size === 1
                ? 'newKnowledge.qualityPage.deletedToast_one'
                : 'newKnowledge.qualityPage.deletedToast_other'
            ],
          { count: ids.size },
        ),
      )
      setDeleteIds(undefined)
      return true
    } catch {
      toast.error(t(($) => $.unknownError))
      return false
    } finally {
      setDeleteSubmitting(false)
    }
  }

  const replayBadCase = async (item: KnowledgeFsBadCaseResponse) => {
    setPendingBadCaseId(item.id)
    try {
      const { badCase, goldenQuestionId } = await ensureLinkedGoldenQuestion(item, {
        annotation: item.reason,
        question: item.question ?? '',
        tags: visibleTags(item.tags),
      })
      let idempotencyKey = replayIdempotencyKeysRef.current.get(item.id)
      if (!idempotencyKey) {
        idempotencyKey = createIdempotencyKey()
        replayIdempotencyKeysRef.current.set(item.id, idempotencyKey)
      }
      const replay =
        await consoleClient.knowledgeFs.spaces.byControlSpaceId.quality.replayRuns.post({
          body: { golden_question_ids: [goldenQuestionId] },
          headers: { 'Idempotency-Key': idempotencyKey },
          params: { control_space_id: knowledgeSpaceId },
        })
      try {
        await consoleClient.knowledgeFs.spaces.byControlSpaceId.quality.badCases.byBadCaseId.patch({
          body: {
            expected_revision: badCase.revision,
            replay_run_id: replay.id,
            status: 'replaying',
            tags: badCase.tags,
          },
          params: { bad_case_id: badCase.id, control_space_id: knowledgeSpaceId },
        })
      } catch (error) {
        const current = await getBadCase(item.id).catch(() => undefined)
        if (current?.replay_run_id !== replay.id) throw error
      }
      replayIdempotencyKeysRef.current.delete(item.id)
      await invalidateQuality()
      toast.success(t(($) => $['newKnowledge.qualityPage.replayStartedToast']))
    } catch {
      await invalidateQuality()
      toast.error(t(($) => $.unknownError))
    } finally {
      setPendingBadCaseId(undefined)
    }
  }

  const openTrace = async (badCaseId: string) => {
    try {
      const reference =
        await consoleClient.knowledgeFs.spaces.byControlSpaceId.quality.badCases.byBadCaseId.traceReference.get(
          {
            params: { bad_case_id: badCaseId, control_space_id: knowledgeSpaceId },
          },
        )
      router.push(`${newKnowledgeRetrievalTestPath(knowledgeSpaceId)}?trace=${reference.trace_id}`)
    } catch {
      toast.error(t(($) => $.unknownError))
    }
  }

  if (goldenQuery.isLoading || badCaseQuery.isLoading)
    return (
      <div className="flex min-h-[420px] items-center justify-center">
        <Loading />
      </div>
    )

  if (goldenQuery.isError || badCaseQuery.isError)
    return (
      <div className="flex min-h-[420px] flex-col items-center justify-center gap-3 text-center">
        <span aria-hidden className="i-ri-error-warning-line size-8 text-text-warning" />
        <p role="alert" className="system-sm-medium text-text-primary">
          {t(($) => $.unknownError)}
        </p>
        <Button
          onClick={() => {
            void goldenQuery.refetch()
            void badCaseQuery.refetch()
          }}
        >
          {t(($) => $.retry)}
        </Button>
      </div>
    )

  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(goldenQuestions.map((item) => item.id)))
  const toggleOne = (id: string) =>
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <main className="relative min-h-full px-8 pt-8 pb-20">
      <header>
        <h1 className="title-md-semi-bold text-text-primary">
          {t(($) => $['newKnowledge.qualityPage.title'])}
        </h1>
        <p className="mt-1 system-xs-regular text-text-tertiary">
          {t(($) => $['newKnowledge.qualityPage.description'])}
        </p>
      </header>
      <div className="mt-6 flex items-center justify-between">
        <div
          role="tablist"
          aria-label={t(($) => $['newKnowledge.qualityPage.title'])}
          className="flex h-8 items-center rounded-lg bg-background-section-burn p-0.5"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'golden'}
            className={cn(
              'h-7 rounded-md px-2.5 system-xs-medium text-text-tertiary outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid',
              activeTab === 'golden' && 'bg-background-default text-text-primary shadow-xs',
            )}
            onClick={() => setTab('golden')}
          >
            {t(($) => $['newKnowledge.qualityPage.goldenTab'], {
              count: goldenQuestions.length,
            })}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'bad'}
            className={cn(
              'h-7 rounded-md px-2.5 system-xs-medium text-text-tertiary outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid',
              activeTab === 'bad' && 'bg-background-default text-text-primary shadow-xs',
            )}
            onClick={() => setTab('bad')}
          >
            {t(($) => $['newKnowledge.qualityPage.badCasesTab'], {
              count: unresolvedBadCases,
            })}
          </button>
        </div>
        {activeTab === 'golden' && goldenQuestions.length > 0 && (
          <Button
            variant="primary"
            onClick={() =>
              setDialog({ key: `create-${Date.now()}`, mode: 'create', value: emptyDraft })
            }
          >
            <span aria-hidden className="i-ri-add-line size-4" />
            {t(($) => $['newKnowledge.qualityPage.addGolden'])}
          </Button>
        )}
      </div>

      {activeTab === 'golden' &&
        (goldenQuestions.length ? (
          <div className="mt-3 min-w-[1192px]">
            <div className="grid h-8 grid-cols-[16px_466px_180px_280px_110px_80px] items-center gap-3 system-2xs-medium-uppercase text-text-tertiary">
              <Checkbox
                aria-label={t(($) => $['newKnowledge.qualityPage.selectAll'])}
                checked={allSelected}
                indeterminate={partiallySelected}
                onCheckedChange={toggleAll}
              />
              <span>{t(($) => $['newKnowledge.qualityPage.question'])}</span>
              <span>{t(($) => $['newKnowledge.qualityPage.tags'])}</span>
              <span>{t(($) => $['newKnowledge.qualityPage.annotation'])}</span>
              <span>{t(($) => $['newKnowledge.qualityPage.updated'])}</span>
              <span />
            </div>
            {goldenQuestions.map((item) => (
              <div
                key={item.id}
                className="grid h-12 grid-cols-[16px_466px_180px_280px_110px_80px] items-center gap-3 border-t border-divider-subtle"
              >
                <Checkbox
                  aria-label={t(($) => $['newKnowledge.qualityPage.selectQuestion'], {
                    question: item.question,
                  })}
                  checked={selected.has(item.id)}
                  onCheckedChange={() => toggleOne(item.id)}
                />
                <span className="truncate system-sm-medium text-text-primary">
                  {item.question ?? ''}
                </span>
                <div className="flex min-w-0 gap-1 overflow-hidden">
                  {visibleTags(item.tags).map((tag) => (
                    <span
                      key={tag}
                      className="h-4 shrink-0 rounded-[5px] border border-divider-deep bg-components-badge-bg-dimm px-1 system-2xs-medium text-text-tertiary"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
                <Tooltip>
                  <TooltipTrigger className="block min-w-0 truncate text-left system-xs-regular text-text-secondary">
                    {item.annotation}
                  </TooltipTrigger>
                  <TooltipContent className="max-w-[268px]">{item.annotation}</TooltipContent>
                </Tooltip>
                <span className="system-xs-regular text-text-secondary">
                  {updated(item.updated_at)}
                </span>
                <DropdownMenu modal={false}>
                  <RowMenuTrigger
                    label={t(($) => $['newKnowledge.qualityPage.questionActions'], {
                      question: item.question,
                    })}
                  />
                  <DropdownMenuContent
                    placement="bottom-end"
                    sideOffset={4}
                    popupClassName="w-[200px]"
                  >
                    <DropdownMenuItem
                      className="gap-2 px-3"
                      onClick={() =>
                        setDialog({
                          id: item.id,
                          key: `edit-${item.id}-${Date.now()}`,
                          mode: 'edit',
                          value: {
                            annotation: item.annotation,
                            question: item.question,
                            tags: item.tags,
                          },
                        })
                      }
                    >
                      <span aria-hidden className="i-ri-edit-line size-4" />
                      {t(($) => $['newKnowledge.qualityPage.edit'])}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      className="gap-2 px-3"
                      onClick={() => setDeleteIds(new Set([item.id]))}
                    >
                      <span aria-hidden className="i-ri-delete-bin-line size-4" />
                      {t(($) => $['newKnowledge.qualityPage.delete'])}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ))}
            {goldenQuery.hasNextPage && (
              <div className="flex justify-center border-t border-divider-subtle py-4">
                <Button
                  loading={goldenQuery.isFetchingNextPage}
                  disabled={goldenQuery.isFetchingNextPage}
                  onClick={() => void goldenQuery.fetchNextPage()}
                >
                  {t(($) => $['newKnowledge.loadMore'])}
                </Button>
              </div>
            )}
          </div>
        ) : (
          <div className="flex min-h-[420px] flex-col items-center justify-center text-center">
            <span aria-hidden className="i-ri-star-line size-8 text-text-tertiary" />
            <h2 className="mt-4 system-md-semibold text-text-primary">
              {t(($) => $['newKnowledge.qualityPage.goldenEmptyTitle'])}
            </h2>
            <p className="mt-1 max-w-[420px] system-xs-regular text-text-tertiary">
              {t(($) => $['newKnowledge.qualityPage.goldenEmptyDescription'])}
            </p>
            <Button
              variant="primary"
              className="mt-4"
              onClick={() =>
                setDialog({ key: `create-${Date.now()}`, mode: 'create', value: emptyDraft })
              }
            >
              <span aria-hidden className="i-ri-add-line size-4" />
              {t(($) => $['newKnowledge.qualityPage.addGolden'])}
            </Button>
          </div>
        ))}

      {activeTab === 'bad' &&
        (badCases.length ? (
          <div className="mt-3 min-w-[1192px]">
            <div className="grid h-8 grid-cols-[624px_140px_180px_120px_80px] items-center gap-3 system-2xs-medium-uppercase text-text-tertiary">
              <span>{t(($) => $['newKnowledge.qualityPage.question'])}</span>
              <span>{t(($) => $['newKnowledge.qualityPage.statusLabel'])}</span>
              <span>{t(($) => $['newKnowledge.qualityPage.reason'])}</span>
              <span>{t(($) => $['newKnowledge.qualityPage.updated'])}</span>
              <span />
            </div>
            {badCases.map((item) => (
              <div
                key={item.id}
                className="grid h-12 grid-cols-[624px_140px_180px_120px_80px] items-center gap-3 border-t border-divider-subtle"
              >
                <span className="truncate system-sm-medium text-text-primary">{item.question}</span>
                <Status status={item.status} />
                <span className="system-xs-regular text-text-secondary">
                  <Reason reason={item.reason} />
                </span>
                <span className="system-xs-regular text-text-secondary">
                  {updated(item.updated_at)}
                </span>
                <DropdownMenu modal={false}>
                  <RowMenuTrigger
                    disabled={pendingBadCaseId === item.id}
                    label={t(($) => $['newKnowledge.qualityPage.questionActions'], {
                      question: item.question ?? '',
                    })}
                  />
                  <DropdownMenuContent
                    placement="bottom-end"
                    sideOffset={4}
                    popupClassName="w-[200px]"
                  >
                    {item.status === 'fixed' ? (
                      <DropdownMenuItem
                        className="gap-2 px-3"
                        onClick={() =>
                          setDialog({
                            id: item.id,
                            key: `promote-${item.id}-${Date.now()}`,
                            mode: 'promote',
                            value: {
                              annotation: '',
                              question: item.question ?? '',
                              tags: visibleTags(item.tags),
                            },
                          })
                        }
                      >
                        <span aria-hidden className="i-ri-star-line size-4" />
                        {t(($) => $['newKnowledge.qualityPage.toGolden'])}
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem
                        className="gap-2 px-3"
                        disabled={item.status === 'replaying' || pendingBadCaseId === item.id}
                        onClick={() => void replayBadCase(item)}
                      >
                        <span aria-hidden className="i-ri-restart-line size-4" />
                        {t(($) => $['newKnowledge.qualityPage.replay'])}
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem
                      className="gap-2 px-3"
                      disabled={pendingBadCaseId === item.id}
                      onClick={() => void openTrace(item.id)}
                    >
                      <span aria-hidden className="i-ri-node-tree size-4" />
                      {t(($) => $['newKnowledge.qualityPage.openTrace'])}
                    </DropdownMenuItem>
                    {item.status !== 'fixed' && (
                      <DropdownMenuItem
                        className="gap-2 px-3"
                        disabled={pendingBadCaseId === item.id}
                        onClick={() =>
                          setDialog({
                            id: item.id,
                            key: `promote-${item.id}-${Date.now()}`,
                            mode: 'promote',
                            value: {
                              annotation: '',
                              question: item.question ?? '',
                              tags: visibleTags(item.tags),
                            },
                          })
                        }
                      >
                        <span aria-hidden className="i-ri-star-line size-4" />
                        {t(($) => $['newKnowledge.qualityPage.toGolden'])}
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ))}
            {badCaseQuery.hasNextPage && (
              <div className="flex justify-center border-t border-divider-subtle py-4">
                <Button
                  loading={badCaseQuery.isFetchingNextPage}
                  disabled={badCaseQuery.isFetchingNextPage}
                  onClick={() => void badCaseQuery.fetchNextPage()}
                >
                  {t(($) => $['newKnowledge.loadMore'])}
                </Button>
              </div>
            )}
          </div>
        ) : (
          <div className="flex min-h-[420px] flex-col items-center justify-center text-center">
            <span aria-hidden className="i-ri-checkbox-circle-line size-8 text-text-tertiary" />
            <h2 className="mt-4 system-md-semibold text-text-primary">
              {t(($) => $['newKnowledge.qualityPage.badCasesEmptyTitle'])}
            </h2>
            <p className="mt-1 max-w-[480px] system-xs-regular text-text-tertiary">
              {t(($) => $['newKnowledge.qualityPage.badCasesEmptyDescription'])}
            </p>
            {badCaseQuery.hasNextPage && (
              <Button
                className="mt-4"
                loading={badCaseQuery.isFetchingNextPage}
                disabled={badCaseQuery.isFetchingNextPage}
                onClick={() => void badCaseQuery.fetchNextPage()}
              >
                {t(($) => $['newKnowledge.loadMore'])}
              </Button>
            )}
          </div>
        ))}

      {activeTab === 'golden' && selected.size > 0 && (
        <div className="fixed bottom-6 left-[calc(var(--new-rag-sidebar-width)+50%)] flex h-12 -translate-x-1/2 items-center gap-3 rounded-xl border border-components-panel-border bg-components-panel-bg px-4 shadow-xl">
          <span className="system-sm-medium text-text-primary">
            {t(
              ($) =>
                $[
                  selected.size === 1
                    ? 'newKnowledge.qualityPage.selectedCount_one'
                    : 'newKnowledge.qualityPage.selectedCount_other'
                ],
              { count: selected.size },
            )}
          </span>
          <span aria-hidden className="h-5 w-px bg-divider-regular" />
          <Button variant="ghost" onClick={() => setDeleteIds(new Set(selected))}>
            <span aria-hidden className="i-ri-delete-bin-line size-4" />
            {t(($) => $['newKnowledge.qualityPage.deleteEllipsis'])}
          </Button>
          <button
            type="button"
            aria-label={t(($) => $['newKnowledge.qualityPage.clearSelection'])}
            className="flex size-7 items-center justify-center rounded-md text-text-tertiary outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid"
            onClick={() => setSelected(new Set())}
          >
            <span aria-hidden className="i-ri-close-line size-4" />
          </button>
        </div>
      )}

      {dialog && (
        <GoldenQuestionDialog
          key={dialog.key}
          initialValue={dialog.value}
          mode={dialog.mode}
          open
          error={dialogError}
          pending={
            dialogSubmitting ||
            createGoldenMutation.isPending ||
            updateGoldenMutation.isPending ||
            deleteGoldenMutation.isPending
          }
          onOpenChange={(open) => {
            if (!open) {
              setDialog(undefined)
              setDialogError(undefined)
            }
          }}
          onSubmit={submitDialog}
        />
      )}
      <AlertDialog
        open={Boolean(deleteIds)}
        onOpenChange={(open) => {
          if (!open && !deleteSubmitting) setDeleteIds(undefined)
        }}
      >
        <AlertDialogContent>
          <div className="flex flex-col gap-2 px-6 pt-6 pb-4">
            <AlertDialogTitle className="title-2xl-semi-bold text-text-primary">
              {tCommon(($) => $['operation.deleteConfirmTitle'])}
            </AlertDialogTitle>
            <AlertDialogDescription className="system-sm-regular text-text-tertiary">
              {tCommon(($) => $['operation.confirmAction'])}
            </AlertDialogDescription>
          </div>
          <AlertDialogActions>
            <AlertDialogCancelButton variant="secondary" disabled={deleteSubmitting}>
              {tCommon(($) => $['operation.cancel'])}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton
              tone="destructive"
              loading={deleteSubmitting}
              disabled={deleteSubmitting}
              onClick={() => {
                if (deleteIds) void deleteGolden(deleteIds)
              }}
            >
              {tCommon(($) => $['operation.delete'])}
            </AlertDialogConfirmButton>
          </AlertDialogActions>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  )
}
