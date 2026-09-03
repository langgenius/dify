'use client'

import type { GoldenQuestionDraft, GoldenQuestionEvidenceOption } from '../quality/types'
import type { RetrievalEvidence } from './model'
import type { BadCaseReason, QualityDecision } from './results'
import { toast } from '@langgenius/dify-ui/toast'
import { useQueryClient } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { consoleClient, consoleQuery } from '@/service/client'
import { GoldenQuestionDialog } from '../quality/golden-question-dialog'
import { newKnowledgeQualityPath } from '../routes'
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
  const { t } = useTranslation('dataset')
  const queryClient = useQueryClient()
  const canEditQuality = useKnowledgeSpacePermission('knowledge_space_edit')
  const knowledgeSpaceId = useAtomValue(retrievalKnowledgeSpaceIdAtom)
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
  } = useAtomValue(retrievalResultFactsAtom)
  const { refetchTraces } = useAtomValue(retrievalRuntimeQueryFactsAtom)
  const [qualityDecisions, setQualityDecisions] = useState<Record<string, QualityDecision>>({})
  const [qualityPendingKey, setQualityPendingKey] = useState<string>()
  const [goldenPromotion, setGoldenPromotion] = useState<GoldenQuestionPromotion>()
  const [goldenPromotionError, setGoldenPromotionError] = useState<string>()

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
    if (!resultKey || !selectedQuery) return
    setQualityPendingKey(resultKey)
    try {
      if (!selectedTraceId) {
        toast.error(t(($) => $.unknownError))
        return
      }
      await consoleClient.knowledgeFs.spaces.byControlSpaceId.quality.badCases.post({
        body: {
          reason,
          tags: ['retrieval-test'],
          trace_id: selectedTraceId,
        },
        params: { control_space_id: knowledgeSpaceId },
      })
      setQualityDecisions((current) => ({ ...current, [resultKey]: 'bad-case' }))
      void refetchTraces()
    } catch (error) {
      // 409: the trace already has an unresolved bad case, so the record is in the wanted state.
      if (error instanceof Response && error.status === 409) {
        setQualityDecisions((current) => ({ ...current, [resultKey]: 'bad-case' }))
        void refetchTraces()
        return
      }
      toast.error(t(($) => $.unknownError))
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
      await consoleClient.knowledgeFs.spaces.byControlSpaceId.goldenQuestions.post({
        body: {
          annotation: draft.annotation,
          expected_evidence_ids: draft.expectedEvidenceIds,
          match_policy: draft.matchPolicy,
          question: draft.question,
          tags: draft.tags,
        },
        params: { control_space_id: knowledgeSpaceId },
      })
      await queryClient.invalidateQueries({
        queryKey: consoleQuery.knowledgeFs.spaces.byControlSpaceId.goldenQuestions.get.key({
          input: { params: { control_space_id: knowledgeSpaceId } },
          type: 'infinite',
        }),
      })
      setQualityDecisions((current) => ({ ...current, [promotion.resultKey]: 'golden' }))
      setGoldenPromotion(undefined)
    } catch {
      setGoldenPromotionError(t(($) => $.unknownError))
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

  return (
    <>
      {actionsVisible && resultKey && (
        <QualityActions
          badCaseAvailable={Boolean(selectedTraceId)}
          noResults={currentEvidence.length === 0}
          decision={qualityDecisions[resultKey] ?? (selectedOpenBadCaseId ? 'bad-case' : undefined)}
          onBadCase={saveBadCase}
          onGolden={startGoldenPromotion}
          pending={qualityPendingKey === resultKey}
          qualityHref={newKnowledgeQualityPath(knowledgeSpaceId)}
        />
      )}
      {canEditQuality && goldenPromotion && (
        <GoldenQuestionDialog
          key={goldenPromotion.resultKey}
          evidenceOptions={goldenPromotion.evidenceOptions}
          error={goldenPromotionError}
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
