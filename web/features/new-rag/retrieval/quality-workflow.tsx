'use client'

import type { GoldenQuestionDraft, GoldenQuestionEvidenceOption } from '../quality/types'
import type { RetrievalEvidence } from './model'
import type { BadCaseReason, QualityDecision } from './results'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useAtomValueRawSync } from 'jotai'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import { consoleQuery } from '@/service/console'
import { getHttpErrorStatus } from '@/service/http-error'
import { useRequestErrorDescriber } from '@/service/use-request-error-message'
import { getErrorMessage } from '@/utils/error-message'
import { GoldenQuestionDialog } from '../quality/golden-question-dialog'
import { newKnowledgeQualityBadCasesPath, newKnowledgeQualityPath } from '../routes'
import { useKnowledgeSpacePermission } from '../space/context'
import { QualityActions } from './results'
import { retrievalResultFactsAtom, retrievalRuntimeQueryFactsAtom } from './state/graph'
import { retrievalKnowledgeSpaceIdAtom } from './state/inputs'

type GoldenQuestionPromotion = {
  evidenceOptions: GoldenQuestionEvidenceOption[]
  resultKey: string
  value: GoldenQuestionDraft
}

function goldenQuestionEvidenceOptions(
  evidence: readonly RetrievalEvidence[],
): GoldenQuestionEvidenceOption[] {
  const options = new Map<string, GoldenQuestionEvidenceOption>()
  for (const item of evidence) {
    if (!item.chunkId) continue
    const sectionPath = item.documentName
      ? item.title === item.documentName
        ? [item.documentName]
        : [item.documentName, item.title]
      : [item.title]
    options.set(item.chunkId, {
      node_id: item.chunkId,
      ...(item.score === undefined ? {} : { score: item.score }),
      section_path: sectionPath,
      text: item.text,
    })
  }
  return [...options.values()]
}

export function RetrievalQualityWorkflow() {
  const { t } = useTranslation(['dataset'])
  const describeRequestError = useRequestErrorDescriber()
  const queryClient = useQueryClient()
  const { mutateAsync: createBadCase } = useMutation(
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.quality.badCases.post.mutationOptions({
      meta: { errorToast: false },
    }),
  )
  const { mutateAsync: createGoldenQuestion } = useMutation(
    consoleQuery.knowledgeFs.spaces.byControlSpaceId.goldenQuestions.post.mutationOptions({
      // The promotion dialog shows the failure next to its submit button.
      meta: { errorToast: false },
    }),
  )
  const canEditQuality = useKnowledgeSpacePermission('knowledge_space_edit')
  const knowledgeSpaceId = useAtomValueRawSync(retrievalKnowledgeSpaceIdAtom)
  const {
    currentEvidence,
    resultKey,
    selectedDataError,
    selectedFailed,
    selectedIsLoading,
    selectedOpenBadCaseId,
    selectedQuery,
    selectedResearchActive,
    selectedTraceId,
  } = useAtomValueRawSync(retrievalResultFactsAtom)
  const { refetchTraces } = useAtomValueRawSync(retrievalRuntimeQueryFactsAtom)
  const [qualityDecisions, setQualityDecisions] = useState<Record<string, QualityDecision>>({})
  const [qualityPendingKey, setQualityPendingKey] = useState<string>()
  const [goldenPromotion, setGoldenPromotion] = useState<GoldenQuestionPromotion>()
  const [goldenPromotionError, setGoldenPromotionError] = useState<{ error: unknown }>()

  const startGoldenPromotion = () => {
    if (!resultKey || !selectedQuery) return
    setGoldenPromotionError(undefined)
    setGoldenPromotion({
      evidenceOptions: goldenQuestionEvidenceOptions(currentEvidence),
      resultKey,
      value: {
        annotation: '',
        expectedEvidenceIds: [],
        matchPolicy: 'all',
        question: selectedQuery,
        tags: ['retrieval-test'],
      },
    })
  }

  const saveBadCase = async (reason: BadCaseReason) => {
    // A bad case is keyed by its trace; image-only traces have no query text but are still valid.
    if (!resultKey || !selectedTraceId) return
    setQualityPendingKey(resultKey)
    try {
      try {
        await createBadCase({
          body: {
            reason,
            tags: ['retrieval-test'],
            trace_id: selectedTraceId,
          },
          params: { control_space_id: knowledgeSpaceId },
        })
      } catch (error) {
        // 409: the trace already has an unresolved bad case, so the record is in the wanted state.
        if (getHttpErrorStatus(error) !== 409) throw error
        // A successful create leaves the list to the invalidation fallback; this one failed.
        void queryClient.invalidateQueries({
          queryKey: consoleQuery.knowledgeFs.spaces.byControlSpaceId.quality.badCases.get.key({
            input: { params: { control_space_id: knowledgeSpaceId } },
            type: 'infinite',
          }),
        })
      }
      setQualityDecisions((current) => ({ ...current, [resultKey]: 'bad-case' }))
      void refetchTraces()
    } catch (error) {
      toast.error(getErrorMessage(error) ?? t(($) => $.unknownError, { ns: 'dataset' }))
    } finally {
      setQualityPendingKey(undefined)
    }
  }

  const submitGoldenPromotion = async (draft: GoldenQuestionDraft) => {
    if (!goldenPromotion) return
    const promotion = goldenPromotion
    setGoldenPromotionError(undefined)
    setQualityPendingKey(promotion.resultKey)
    try {
      await createGoldenQuestion({
        body: {
          annotation: draft.annotation,
          expected_evidence_ids: draft.expectedEvidenceIds,
          match_policy: draft.matchPolicy,
          question: draft.question,
          tags: draft.tags,
        },
        params: { control_space_id: knowledgeSpaceId },
      })
      setQualityDecisions((current) => ({ ...current, [promotion.resultKey]: 'golden' }))
      setGoldenPromotion(undefined)
    } catch (error) {
      setGoldenPromotionError({ error })
    } finally {
      setQualityPendingKey(undefined)
    }
  }

  const actionsVisible = Boolean(
    canEditQuality &&
    !selectedIsLoading &&
    !selectedFailed &&
    !selectedDataError &&
    !selectedResearchActive &&
    resultKey,
  )
  const qualityDecision = resultKey
    ? (qualityDecisions[resultKey] ?? (selectedOpenBadCaseId ? 'bad-case' : undefined))
    : undefined

  return (
    <>
      {actionsVisible && resultKey && (
        <QualityActions
          badCaseAvailable={Boolean(selectedTraceId)}
          noResults={currentEvidence.length === 0}
          decision={qualityDecision}
          onBadCase={saveBadCase}
          onGolden={startGoldenPromotion}
          pending={qualityPendingKey === resultKey}
          qualityHref={
            qualityDecision === 'bad-case'
              ? newKnowledgeQualityBadCasesPath(knowledgeSpaceId)
              : newKnowledgeQualityPath(knowledgeSpaceId)
          }
        />
      )}
      {canEditQuality && goldenPromotion && (
        <GoldenQuestionDialog
          key={goldenPromotion.resultKey}
          evidenceOptions={goldenPromotion.evidenceOptions}
          error={
            goldenPromotionError &&
            describeRequestError(
              goldenPromotionError.error,
              t(($) => $.unknownError, { ns: 'dataset' }),
            )
          }
          initialValue={goldenPromotion.value}
          knowledgeSpaceId={knowledgeSpaceId}
          mode="promote"
          open
          pending={qualityPendingKey === goldenPromotion.resultKey}
          onOpenChange={(open) => {
            if (!open) {
              setGoldenPromotion(undefined)
              setGoldenPromotionError(undefined)
            }
          }}
          onSubmit={submitGoldenPromotion}
        />
      )}
    </>
  )
}
