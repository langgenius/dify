'use client'

import type { KnowledgeFsBadCaseResponse } from '@dify/contracts/api/console/knowledge-fs/types.gen'
import type { GoldenQuestionDraft } from './types'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@langgenius/dify-ui/dropdown-menu'
import { toast } from '@langgenius/dify-ui/toast'
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useRouter } from '@/next/navigation'
import { consoleClient, consoleQuery } from '@/service/client'
import { newKnowledgeRetrievalTestPath } from '../routes'
import { GoldenQuestionDialog } from './golden-question-dialog'
import {
  formatQualityUpdatedAt,
  goldenQuestionPayload,
  qualityPageSize,
  visibleQualityTags,
} from './quality-model'
import { QualityQueryState } from './quality-query-state'
import { QualityRowMenuTrigger } from './quality-row-menu-trigger'

type BadCasesPanelProps = {
  canEdit: boolean
  knowledgeSpaceId: string
}

function BadCaseReason({
  question,
  reason,
  tags,
}: {
  question?: string
  reason: string
  tags: string[]
}) {
  const { t } = useTranslation('dataset')
  const normalized = reason.toLowerCase()
  if (normalized === 'low-score' || (normalized.includes('low') && normalized.includes('score')))
    return t(($) => $['newKnowledge.qualityPage.reasonValues.lowScore'])
  if (normalized.includes('outdated'))
    return t(($) => $['newKnowledge.qualityPage.reasonValues.outdatedContent'])
  if (
    (tags.includes('retrieval-test') && reason.trim() === question?.trim()) ||
    normalized.includes('retrieval') ||
    normalized.includes('miss')
  )
    return t(($) => $['newKnowledge.qualityPage.reasonValues.retrievalMiss'])
  if (normalized.includes('coverage') || normalized.includes('evidence'))
    return t(($) => $['newKnowledge.qualityPage.reasonValues.coverageGap'])
  return reason
}

function BadCaseStatus({ status }: { status: KnowledgeFsBadCaseResponse['status'] }) {
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

export function BadCasesPanel({ canEdit, knowledgeSpaceId }: BadCasesPanelProps) {
  const { t } = useTranslation('dataset')
  const router = useRouter()
  const queryClient = useQueryClient()
  const [pendingId, setPendingId] = useState<string>()
  const [dialog, setDialog] = useState<{
    id: string
    key: string
    value: GoldenQuestionDraft
  }>()
  const [dialogError, setDialogError] = useState<string>()
  const [dialogSubmitting, setDialogSubmitting] = useState(false)
  const promotedGoldenQuestionIdsRef = useRef(new Map<string, string>())
  const badCaseQueryOptions =
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.quality.badCases.get.infiniteOptions({
      input: (pageParam) => ({
        params: { control_space_id: knowledgeSpaceId },
        query: {
          limit: qualityPageSize,
          ...(typeof pageParam === 'string' ? { cursor: pageParam } : {}),
        },
      }),
      getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
      initialPageParam: null as string | null,
    })
  const goldenQueryOptions =
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.goldenQuestions.get.infiniteOptions({
      input: (pageParam) => ({
        params: { control_space_id: knowledgeSpaceId },
        query: {
          limit: qualityPageSize,
          ...(typeof pageParam === 'string' ? { cursor: pageParam } : {}),
        },
      }),
      getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
      initialPageParam: null as string | null,
    })
  const query = useInfiniteQuery(badCaseQueryOptions)
  const createGoldenMutation = useMutation(
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.goldenQuestions.post.mutationOptions(),
  )
  const deleteGoldenMutation = useMutation(
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.goldenQuestions.byQuestionId.delete.mutationOptions(),
  )
  const items = (query.data?.pages.flatMap((page) => page.data) ?? []).filter(
    (item) => item.status !== 'dismissed',
  )

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
  const markBadCaseDismissed = async (
    badCase: KnowledgeFsBadCaseResponse,
    tags: string[] = badCase.tags,
  ) => {
    try {
      await consoleClient.knowledgeFs.spaces.byControlSpaceId.quality.badCases.byBadCaseId.patch({
        body: {
          expected_revision: badCase.revision,
          status: 'dismissed',
          tags,
        },
        params: { bad_case_id: badCase.id, control_space_id: knowledgeSpaceId },
      })
    } catch (error) {
      const refreshed = await getBadCase(badCase.id).catch(() => undefined)
      if (refreshed?.status !== 'dismissed') throw error
    }
  }

  const submitPromotion = async (draft: GoldenQuestionDraft) => {
    if (!dialog) return
    setDialogError(undefined)
    setDialogSubmitting(true)
    try {
      const badCase = await getBadCase(dialog.id)
      let goldenQuestionId = promotedGoldenQuestionIdsRef.current.get(badCase.id)
      if (!goldenQuestionId) {
        const createdGoldenQuestion = await createGoldenMutation.mutateAsync({
          body: {
            ...goldenQuestionPayload(draft),
            source_bad_case_id: badCase.id,
          },
          params: { control_space_id: knowledgeSpaceId },
        })
        goldenQuestionId = createdGoldenQuestion.id
        promotedGoldenQuestionIdsRef.current.set(badCase.id, goldenQuestionId)
      }
      try {
        await markBadCaseDismissed(badCase, visibleQualityTags(badCase.tags))
        promotedGoldenQuestionIdsRef.current.delete(badCase.id)
      } catch (error) {
        try {
          await deleteGoldenMutation.mutateAsync({
            params: { control_space_id: knowledgeSpaceId, question_id: goldenQuestionId },
          })
          promotedGoldenQuestionIdsRef.current.delete(badCase.id)
        } catch {
          // Keep the created ID so retrying resumes dismissal without creating a duplicate.
        }
        throw error
      }
      toast.success(t(($) => $['newKnowledge.qualityPage.promotedToast']))
      await invalidateQuality()
      setDialog(undefined)
    } catch {
      setDialogError(t(($) => $.unknownError))
    } finally {
      setDialogSubmitting(false)
    }
  }

  const replayBadCase = async (item: KnowledgeFsBadCaseResponse) => {
    setPendingId(item.id)
    try {
      const reference =
        await consoleClient.knowledgeFs.spaces.byControlSpaceId.quality.badCases.byBadCaseId.traceReference.get(
          { params: { bad_case_id: item.id, control_space_id: knowledgeSpaceId } },
        )
      const search = new URLSearchParams({ retest: reference.trace_id, trace: reference.trace_id })
      router.push(`${newKnowledgeRetrievalTestPath(knowledgeSpaceId)}?${search.toString()}`)
    } catch {
      toast.error(t(($) => $.unknownError))
    } finally {
      setPendingId(undefined)
    }
  }
  const ignoreBadCase = async (item: KnowledgeFsBadCaseResponse) => {
    setPendingId(item.id)
    try {
      const badCase = await getBadCase(item.id)
      await markBadCaseDismissed(badCase)
      await queryClient.invalidateQueries({ queryKey: badCaseQueryOptions.queryKey })
    } catch {
      toast.error(t(($) => $.unknownError))
    } finally {
      setPendingId(undefined)
    }
  }
  const openTrace = async (badCaseId: string) => {
    try {
      const reference =
        await consoleClient.knowledgeFs.spaces.byControlSpaceId.quality.badCases.byBadCaseId.traceReference.get(
          { params: { bad_case_id: badCaseId, control_space_id: knowledgeSpaceId } },
        )
      router.push(`${newKnowledgeRetrievalTestPath(knowledgeSpaceId)}?trace=${reference.trace_id}`)
    } catch {
      toast.error(t(($) => $.unknownError))
    }
  }
  const openPromotion = (item: KnowledgeFsBadCaseResponse) =>
    setDialog({
      id: item.id,
      key: `promote-${item.id}-${Date.now()}`,
      value: {
        annotation: '',
        expectedEvidenceIds: [],
        matchPolicy: 'all',
        question: item.question ?? '',
        tags: visibleQualityTags(item.tags),
      },
    })

  return (
    <>
      <QualityQueryState
        error={query.isError}
        loading={query.isLoading}
        onRetry={() => void query.refetch()}
      >
        {items.length ? (
          <div className="mt-2.5 w-full overflow-x-auto pt-3">
            <div className="grid min-w-202 grid-cols-[minmax(240px,624px)_140px_180px_120px_80px] items-center gap-3 py-2.5 text-[11px] leading-4 font-medium text-text-tertiary">
              <span>{t(($) => $['newKnowledge.qualityPage.question'])}</span>
              <span>{t(($) => $['newKnowledge.qualityPage.statusLabel'])}</span>
              <span>{t(($) => $['newKnowledge.qualityPage.reason'])}</span>
              <span>{t(($) => $['newKnowledge.qualityPage.updated'])}</span>
              <span />
            </div>
            {items.map((item) => (
              <div
                key={item.id}
                className="grid h-12 min-w-202 grid-cols-[minmax(240px,624px)_140px_180px_120px_80px] items-center gap-3 border-t border-divider-subtle"
              >
                <span className="truncate system-sm-medium text-text-primary">{item.question}</span>
                <BadCaseStatus status={item.status} />
                <span className="system-xs-regular text-text-secondary">
                  <BadCaseReason question={item.question} reason={item.reason} tags={item.tags} />
                </span>
                <span className="system-xs-regular text-text-secondary">
                  {formatQualityUpdatedAt(item.updated_at)}
                </span>
                <DropdownMenu modal={false}>
                  <QualityRowMenuTrigger
                    disabled={pendingId === item.id}
                    label={t(($) => $['newKnowledge.qualityPage.questionActions'], {
                      question: item.question ?? '',
                    })}
                  />
                  <DropdownMenuContent placement="bottom-end" sideOffset={4} className="w-[200px]">
                    {canEdit &&
                      (item.status === 'fixed' ? (
                        <DropdownMenuItem
                          className="gap-2 px-3"
                          onClick={() => openPromotion(item)}
                        >
                          <span aria-hidden className="i-ri-star-line size-4" />
                          {t(($) => $['newKnowledge.qualityPage.toGolden'])}
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem
                          className="gap-2 px-3"
                          disabled={item.status === 'replaying' || pendingId === item.id}
                          onClick={() => void replayBadCase(item)}
                        >
                          <span aria-hidden className="i-ri-restart-line size-4" />
                          {t(($) => $['newKnowledge.qualityPage.replay'])}
                        </DropdownMenuItem>
                      ))}
                    <DropdownMenuItem
                      className="gap-2 px-3"
                      disabled={pendingId === item.id}
                      onClick={() => void openTrace(item.id)}
                    >
                      <span aria-hidden className="i-ri-arrow-right-up-line size-4" />
                      {t(($) => $['newKnowledge.qualityPage.openTrace'])}
                    </DropdownMenuItem>
                    {canEdit && item.status !== 'fixed' && (
                      <DropdownMenuItem
                        className="gap-2 px-3"
                        disabled={pendingId === item.id}
                        onClick={() => openPromotion(item)}
                      >
                        <span aria-hidden className="i-ri-star-line size-4" />
                        {t(($) => $['newKnowledge.qualityPage.toGolden'])}
                      </DropdownMenuItem>
                    )}
                    {canEdit && <DropdownMenuSeparator />}
                    {canEdit && (
                      <DropdownMenuItem
                        className="gap-2 px-3"
                        disabled={pendingId === item.id}
                        onClick={() => void ignoreBadCase(item)}
                      >
                        <span aria-hidden className="i-ri-eye-off-line size-4" />
                        {t(($) => $['newKnowledge.qualityPage.ignore'])}
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ))}
            {query.hasNextPage && (
              <div className="flex min-w-202 justify-center border-t border-divider-subtle py-4">
                <Button
                  loading={query.isFetchingNextPage}
                  disabled={query.isFetchingNextPage}
                  onClick={() => void query.fetchNextPage()}
                >
                  {t(($) => $['newKnowledge.loadMore'])}
                </Button>
              </div>
            )}
          </div>
        ) : (
          <div className="mt-2.5 flex h-140 flex-col items-center justify-center text-center">
            <span aria-hidden className="i-ri-check-line size-7 text-text-tertiary" />
            <h2 className="mt-3 system-md-semibold text-text-primary">
              {t(($) => $['newKnowledge.qualityPage.badCasesEmptyTitle'])}
            </h2>
            <p className="mt-1 max-w-136 system-xs-regular text-text-tertiary">
              {t(($) => $['newKnowledge.qualityPage.badCasesEmptyDescription'])}
            </p>
            {query.hasNextPage && (
              <Button
                className="mt-4"
                loading={query.isFetchingNextPage}
                disabled={query.isFetchingNextPage}
                onClick={() => void query.fetchNextPage()}
              >
                {t(($) => $['newKnowledge.loadMore'])}
              </Button>
            )}
          </div>
        )}
      </QualityQueryState>

      {dialog && (
        <GoldenQuestionDialog
          key={dialog.key}
          initialValue={dialog.value}
          knowledgeSpaceId={knowledgeSpaceId}
          mode="promote"
          open
          error={dialogError}
          pending={
            dialogSubmitting || createGoldenMutation.isPending || deleteGoldenMutation.isPending
          }
          onOpenChange={(open) => {
            if (!open) {
              setDialog(undefined)
              setDialogError(undefined)
            }
          }}
          onSubmit={submitPromotion}
        />
      )}
    </>
  )
}
