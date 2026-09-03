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
import Loading from '@/app/components/base/loading'
import { useRouter } from '@/next/navigation'
import { consoleClient, consoleQuery } from '@/service/client'
import { newKnowledgeRetrievalTestPath } from '../routes'
import { useKnowledgeSpace, useKnowledgeSpacePermission } from '../space/context'
import { GoldenQuestionDialog } from './golden-question-dialog'
import {
  formatQualityUpdatedAt,
  goldenQuestionPayload,
  qualityPageSize,
  visibleQualityTags,
} from './quality-model'
import { QualityRowMenuTrigger } from './quality-row-menu-trigger'

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

type BadCasePromotionSession = {
  id: string
  value: GoldenQuestionDraft
}

function BadCasePromotionDialog({
  onOpenChange,
  session,
}: {
  onOpenChange: (session: BadCasePromotionSession | undefined) => void
  session?: BadCasePromotionSession
}) {
  const { t } = useTranslation('dataset')
  const { space } = useKnowledgeSpace()
  const knowledgeSpaceId = space.control_space_id
  const queryClient = useQueryClient()
  const [error, setError] = useState<string>()
  const [submitting, setSubmitting] = useState(false)
  const promotedGoldenQuestionIdsRef = useRef(new Map<string, string>())
  const createGoldenMutation = useMutation(
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.goldenQuestions.post.mutationOptions(),
  )
  const deleteGoldenMutation = useMutation(
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.goldenQuestions.byQuestionId.delete.mutationOptions(),
  )

  const close = () => {
    setError(undefined)
    onOpenChange(undefined)
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
    } catch (mutationError) {
      const refreshed = await getBadCase(badCase.id).catch(() => undefined)
      if (refreshed?.status !== 'dismissed') throw mutationError
    }
  }

  const submit = async (draft: GoldenQuestionDraft) => {
    if (!session) return
    setError(undefined)
    setSubmitting(true)
    try {
      const badCase = await getBadCase(session.id)
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
      } catch (mutationError) {
        try {
          await deleteGoldenMutation.mutateAsync({
            params: { control_space_id: knowledgeSpaceId, question_id: goldenQuestionId },
          })
          promotedGoldenQuestionIdsRef.current.delete(badCase.id)
        } catch {
          // Keep the created ID so retrying resumes dismissal without creating a duplicate.
        }
        throw mutationError
      }
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: consoleQuery.knowledgeFs.spaces.byControlSpaceId.goldenQuestions.get.key({
            input: { params: { control_space_id: knowledgeSpaceId } },
            type: 'infinite',
          }),
        }),
        queryClient.invalidateQueries({
          queryKey: consoleQuery.knowledgeFs.spaces.byControlSpaceId.quality.badCases.get.key({
            input: { params: { control_space_id: knowledgeSpaceId } },
            type: 'infinite',
          }),
        }),
      ])
      toast.success(t(($) => $['newKnowledge.qualityPage.promotedToast']))
      close()
    } catch {
      setError(t(($) => $.unknownError))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <GoldenQuestionDialog
      error={error}
      initialValue={
        session?.value ?? {
          annotation: '',
          expectedEvidenceIds: [],
          matchPolicy: 'all',
          question: '',
          tags: [],
        }
      }
      knowledgeSpaceId={knowledgeSpaceId}
      mode="promote"
      open={Boolean(session)}
      pending={submitting || createGoldenMutation.isPending || deleteGoldenMutation.isPending}
      sessionKey={session?.id}
      onOpenChange={(open) => {
        if (!open && !submitting) close()
      }}
      onSubmit={submit}
    />
  )
}

function BadCaseRow({
  item,
  onPromote,
}: {
  item: KnowledgeFsBadCaseResponse
  onPromote: (item: KnowledgeFsBadCaseResponse) => void
}) {
  const { t } = useTranslation('dataset')
  const { space } = useKnowledgeSpace()
  const canEdit = useKnowledgeSpacePermission('knowledge_space_edit')
  const knowledgeSpaceId = space.control_space_id
  const queryClient = useQueryClient()
  const router = useRouter()
  const [pending, setPending] = useState(false)

  const getBadCase = () =>
    consoleClient.knowledgeFs.spaces.byControlSpaceId.quality.badCases.byBadCaseId.get({
      params: { bad_case_id: item.id, control_space_id: knowledgeSpaceId },
    })
  const openTrace = async (retest: boolean) => {
    setPending(true)
    try {
      const reference =
        await consoleClient.knowledgeFs.spaces.byControlSpaceId.quality.badCases.byBadCaseId.traceReference.get(
          { params: { bad_case_id: item.id, control_space_id: knowledgeSpaceId } },
        )
      const search = new URLSearchParams(
        retest
          ? { retest: reference.trace_id, trace: reference.trace_id }
          : { trace: reference.trace_id },
      )
      router.push(`${newKnowledgeRetrievalTestPath(knowledgeSpaceId)}?${search.toString()}`)
    } catch {
      toast.error(t(($) => $.unknownError))
      setPending(false)
    }
  }
  const ignore = async () => {
    setPending(true)
    try {
      const badCase = await getBadCase()
      try {
        await consoleClient.knowledgeFs.spaces.byControlSpaceId.quality.badCases.byBadCaseId.patch({
          body: {
            expected_revision: badCase.revision,
            status: 'dismissed',
            tags: badCase.tags,
          },
          params: { bad_case_id: badCase.id, control_space_id: knowledgeSpaceId },
        })
      } catch (mutationError) {
        const refreshed = await getBadCase().catch(() => undefined)
        if (refreshed?.status !== 'dismissed') throw mutationError
      }
      await queryClient.invalidateQueries({
        queryKey: consoleQuery.knowledgeFs.spaces.byControlSpaceId.quality.badCases.get.key({
          input: { params: { control_space_id: knowledgeSpaceId } },
          type: 'infinite',
        }),
      })
    } catch {
      toast.error(t(($) => $.unknownError))
      setPending(false)
    }
  }

  return (
    <div className="grid h-12 min-w-202 grid-cols-[minmax(240px,624px)_140px_180px_120px_80px] items-center gap-3 border-t border-divider-subtle">
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
          disabled={pending}
          label={t(($) => $['newKnowledge.qualityPage.questionActions'], {
            question: item.question ?? '',
          })}
        />
        <DropdownMenuContent placement="bottom-end" sideOffset={4} className="w-50">
          {canEdit &&
            (item.status === 'fixed' ? (
              <DropdownMenuItem className="gap-2 px-3" onClick={() => onPromote(item)}>
                <span aria-hidden className="i-ri-star-line size-4" />
                {t(($) => $['newKnowledge.qualityPage.toGolden'])}
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem
                className="gap-2 px-3"
                disabled={item.status === 'replaying' || pending}
                onClick={() => void openTrace(true)}
              >
                <span aria-hidden className="i-ri-restart-line size-4" />
                {t(($) => $['newKnowledge.qualityPage.replay'])}
              </DropdownMenuItem>
            ))}
          <DropdownMenuItem
            className="gap-2 px-3"
            disabled={pending}
            onClick={() => void openTrace(false)}
          >
            <span aria-hidden className="i-ri-arrow-right-up-line size-4" />
            {t(($) => $['newKnowledge.qualityPage.openTrace'])}
          </DropdownMenuItem>
          {canEdit && item.status !== 'fixed' && (
            <DropdownMenuItem
              className="gap-2 px-3"
              disabled={pending}
              onClick={() => onPromote(item)}
            >
              <span aria-hidden className="i-ri-star-line size-4" />
              {t(($) => $['newKnowledge.qualityPage.toGolden'])}
            </DropdownMenuItem>
          )}
          {canEdit && <DropdownMenuSeparator />}
          {canEdit && (
            <DropdownMenuItem
              className="gap-2 px-3"
              disabled={pending}
              onClick={() => void ignore()}
            >
              <span aria-hidden className="i-ri-eye-off-line size-4" />
              {t(($) => $['newKnowledge.qualityPage.ignore'])}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

export function BadCasesPanel() {
  const { t } = useTranslation('dataset')
  const { space } = useKnowledgeSpace()
  const knowledgeSpaceId = space.control_space_id
  const [promotion, setPromotion] = useState<BadCasePromotionSession>()
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
  const query = useInfiniteQuery(badCaseQueryOptions)
  const items = (query.data?.pages.flatMap((page) => page.data) ?? []).filter(
    (item) => item.status !== 'dismissed',
  )

  const openPromotion = (item: KnowledgeFsBadCaseResponse) =>
    setPromotion({
      id: item.id,
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
      {query.isLoading ? (
        <div className="flex min-h-105 items-center justify-center">
          <Loading />
        </div>
      ) : query.isError ? (
        <div className="flex min-h-105 flex-col items-center justify-center gap-3 text-center">
          <span aria-hidden className="i-ri-error-warning-line size-8 text-text-warning" />
          <p role="alert" className="system-sm-medium text-text-primary">
            {t(($) => $.unknownError)}
          </p>
          <Button onClick={() => void query.refetch()}>{t(($) => $.retry)}</Button>
        </div>
      ) : items.length ? (
        <div className="mt-2.5 w-full overflow-x-auto pt-3">
          <div className="grid min-w-202 grid-cols-[minmax(240px,624px)_140px_180px_120px_80px] items-center gap-3 py-2.5 text-[11px] leading-4 font-medium text-text-tertiary">
            <span>{t(($) => $['newKnowledge.qualityPage.question'])}</span>
            <span>{t(($) => $['newKnowledge.qualityPage.statusLabel'])}</span>
            <span>{t(($) => $['newKnowledge.qualityPage.reason'])}</span>
            <span>{t(($) => $['newKnowledge.qualityPage.updated'])}</span>
            <span />
          </div>
          {items.map((item) => (
            <BadCaseRow key={item.id} item={item} onPromote={openPromotion} />
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

      <BadCasePromotionDialog session={promotion} onOpenChange={setPromotion} />
    </>
  )
}
