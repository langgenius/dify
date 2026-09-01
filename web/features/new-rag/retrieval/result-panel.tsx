'use client'

import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { useAtomValue, useSetAtom } from 'jotai'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Link from '@/next/link'
import { newKnowledgeQualityPath } from '../routes'
import { RecordTime, ResearchProcess } from './history'
import { researchTaskIsActive } from './model'
import { RetrievalQualityWorkflow } from './quality-workflow'
import { EmptyState, EvidenceCard, FailedResult, ResearchAnswer, ResultSkeleton } from './results'
import {
  loadMoreSelectedRetrievalEvidenceAtom,
  retrievalResultFactsAtom,
  retrySelectedRetrievalDataAtom,
} from './state/graph'
import { retrievalKnowledgeSpaceIdAtom } from './state/inputs'
import { cancelRetrievalResearchAtom, retryFastRetrievalAtom } from './state/runtime'

type ResearchExpansionState = Partial<Record<'active' | 'terminal', boolean>>

function RetrievalResultSession() {
  const { t } = useTranslation('dataset')
  const knowledgeSpaceId = useAtomValue(retrievalKnowledgeSpaceIdAtom)
  const {
    currentEvidence,
    currentEvidenceDocumentCount,
    hasMoreEvidencePages,
    localError,
    researchAnswer,
    researchEvents,
    researchHasNextPage,
    researchIsFetchingNextPage,
    researchPlan,
    selected,
    selectedCreatedAt,
    selectedDataError,
    selectedFailed,
    selectedHasNoResults,
    selectedIsLoading,
    selectedMode,
    selectedResearchActive,
    selectedResearchTask,
    traceHasNextPage,
    traceIsFetchingNextPage,
  } = useAtomValue(retrievalResultFactsAtom)
  const retryFast = useSetAtom(retryFastRetrievalAtom)
  const retrySelectedData = useSetAtom(retrySelectedRetrievalDataAtom)
  const loadMoreEvidence = useSetAtom(loadMoreSelectedRetrievalEvidenceAtom)
  const cancelResearch = useSetAtom(cancelRetrievalResearchAtom)
  const [researchExpanded, setResearchExpanded] = useState<ResearchExpansionState>({})
  const [showAll, setShowAll] = useState(false)
  const [selectedCitation, setSelectedCitation] = useState<{
    citationIndex: number
    requestId: number
    taskId: string
  }>()
  const selectedResearchTaskId = selectedResearchTask?.id
  const selectedResearchDefaultExpanded = researchTaskIsActive(selectedResearchTask)
  const selectedResearchExpansionPhase = selectedResearchDefaultExpanded ? 'active' : 'terminal'
  const selectedResearchExpanded = selectedResearchTask
    ? (researchExpanded[selectedResearchExpansionPhase] ?? selectedResearchDefaultExpanded)
    : false
  const initialEvidenceCount = selectedMode === 'research' ? 5 : 3
  const visibleEvidence = showAll ? currentEvidence : currentEvidence.slice(0, initialEvidenceCount)
  const selectedCitationIndex =
    selectedCitation && selectedCitation.taskId === selectedResearchTaskId
      ? selectedCitation.citationIndex
      : undefined

  const toggleSelectedResearchProcess = () => {
    if (!selectedResearchTask) return
    setResearchExpanded((current) => ({
      ...current,
      [selectedResearchExpansionPhase]: !(
        current[selectedResearchExpansionPhase] ?? selectedResearchDefaultExpanded
      ),
    }))
  }

  const jumpToResearchCitation = useCallback(
    (citationIndex: number) => {
      if (!selectedResearchTaskId || citationIndex < 0 || citationIndex >= currentEvidence.length)
        return
      setShowAll(true)
      setSelectedCitation((current) => ({
        citationIndex,
        requestId: (current?.requestId ?? 0) + 1,
        taskId: selectedResearchTaskId,
      }))
    },
    [currentEvidence.length, selectedResearchTaskId],
  )

  useEffect(() => {
    if (selectedCitationIndex === undefined || !selectedCitation) return
    const target = document.getElementById(`research-evidence-${selectedCitationIndex + 1}`)
    if (!target) return
    target.scrollIntoView({ behavior: 'smooth', block: 'center' })
    target.focus({ preventScroll: true })
  }, [selectedCitation, selectedCitationIndex, visibleEvidence.length])

  return (
    <>
      <div className="flex h-5 shrink-0 items-center gap-2 overflow-hidden pl-3">
        <h2 className="shrink-0 system-sm-semibold leading-5 text-text-primary">
          {selected?.kind === 'research'
            ? t(($) => $['newKnowledge.retrievalTest.researchResult'])
            : t(($) => $['newKnowledge.retrievalTest.result'])}
        </h2>
        <span className="shrink-0 rounded-md bg-divider-regular px-1.5 py-0.5 text-[11px] leading-4 font-medium text-text-tertiary capitalize">
          {selectedMode ? t(($) => $[`newKnowledge.settings.retrievalMode.${selectedMode}`]) : ''}
        </span>
        {!selectedIsLoading && selectedCreatedAt && (
          <span className="shrink-0 text-[11px] leading-4 text-text-tertiary">
            <RecordTime key={selectedCreatedAt} value={selectedCreatedAt} />
          </span>
        )}
        <span className="min-w-0 flex-1" />
        {selectedResearchTask && (
          <button
            type="button"
            aria-pressed={selectedResearchExpanded}
            className="flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 system-xs-medium text-text-tertiary outline-hidden hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid"
            onClick={toggleSelectedResearchProcess}
          >
            <span aria-hidden className="i-ri-search-eye-line size-3.5" />
            {t(($) => $['newKnowledge.retrievalTest.processLog'])}
          </button>
        )}
        {selectedResearchTask?.stage === 'completed' && (
          <Link
            href={newKnowledgeQualityPath(knowledgeSpaceId)}
            className="flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 system-xs-medium text-text-tertiary outline-hidden hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid"
          >
            <span aria-hidden className="i-ri-equalizer-2-line size-3.5" />
            {t(($) => $['newKnowledge.retrievalTest.quality'])}
          </Link>
        )}
      </div>

      <div className="min-h-0 flex-1 scrollbar-none overflow-y-auto">
        {selectedResearchTask && (
          <ResearchProcess
            task={selectedResearchTask}
            plan={researchPlan}
            events={researchEvents}
            evidenceCount={currentEvidence.length}
            documentCount={currentEvidenceDocumentCount}
            expanded={selectedResearchExpanded}
            onToggle={toggleSelectedResearchProcess}
            onCancel={
              selectedResearchActive ? () => cancelResearch(selectedResearchTask.id) : undefined
            }
          />
        )}

        {selectedResearchTask && researchAnswer.answer && (
          <ResearchAnswer
            answer={researchAnswer.answer}
            citationCount={currentEvidence.length}
            onCitationClick={jumpToResearchCitation}
            streaming={selectedResearchActive && !researchAnswer.persisted}
          />
        )}

        {selectedIsLoading && <ResultSkeleton />}

        {selectedFailed && (
          <FailedResult
            description={localError || t(($) => $['newKnowledge.retrievalTest.failedDescription'])}
            onRetry={retryFast}
          />
        )}

        {selectedDataError && (
          <FailedResult
            description={t(($) => $['newKnowledge.retrievalTest.failedDescription'])}
            onRetry={retrySelectedData}
          />
        )}

        {!selectedIsLoading &&
          !selectedFailed &&
          !selectedDataError &&
          !selectedResearchActive &&
          !researchAnswer.answer &&
          (selectedHasNoResults || currentEvidence.length === 0) && (
            <EmptyState
              kind="no-results"
              title={t(($) => $['newKnowledge.retrievalTest.noChunksTitle'])}
              description={t(($) => $['newKnowledge.retrievalTest.noChunksDescription'])}
            />
          )}

        {currentEvidence.length > 0 && (
          <div className={cn(selectedResearchTask && 'mt-3')}>
            {selectedResearchActive && (
              <h3 className="flex h-6 items-start pb-2 pl-3 system-xs-medium text-text-tertiary">
                {t(($) => $['newKnowledge.retrievalTest.foundSoFar'], {
                  count: currentEvidence.length,
                })}
              </h3>
            )}
            <div className="space-y-3">
              {visibleEvidence.map((evidence, index) => (
                <EvidenceCard
                  key={evidence.id}
                  citationTargetId={
                    selectedResearchTask ? `research-evidence-${index + 1}` : undefined
                  }
                  citationTargeted={selectedCitationIndex === index}
                  evidence={evidence}
                  index={index}
                />
              ))}
              {selectedResearchTask && selectedResearchActive && (
                <div className="h-16.5 animate-pulse rounded-xl bg-components-panel-bg px-3 py-3.5 opacity-60 motion-reduce:animate-none">
                  <div className="flex items-start justify-between">
                    <div className="h-3 w-30 rounded-xs bg-divider-regular" />
                    <div className="h-4 w-14 rounded-md bg-divider-subtle" />
                  </div>
                  <div className="mt-2.5 h-3 w-full rounded-xs bg-divider-subtle" />
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {!showAll && (currentEvidence.length > initialEvidenceCount || hasMoreEvidencePages) && (
        <div className="shrink-0 pl-1">
          <button
            type="button"
            className="flex items-center gap-1 rounded-md px-1.5 py-1 system-xs-medium text-text-tertiary outline-hidden hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid"
            onClick={() => setShowAll(true)}
          >
            {t(($) => $['newKnowledge.retrievalTest.showAllChunks'], {
              count: currentEvidence.length,
            })}
            <span aria-hidden className="i-ri-arrow-down-s-line size-3.5" />
          </button>
        </div>
      )}

      {showAll && (traceHasNextPage || researchHasNextPage) && (
        <div className="shrink-0 pl-1">
          <Button
            loading={traceIsFetchingNextPage || researchIsFetchingNextPage}
            disabled={traceIsFetchingNextPage || researchIsFetchingNextPage}
            onClick={loadMoreEvidence}
          >
            {t(($) => $['newKnowledge.loadMore'])}
          </Button>
        </div>
      )}
    </>
  )
}

export function RetrievalResultPanel() {
  const { t } = useTranslation('dataset')
  const { resultKey, selected } = useAtomValue(retrievalResultFactsAtom)

  return (
    <section className="min-h-0 min-w-0 flex-1 overflow-hidden rounded-2xl bg-background-body p-5">
      {!selected && (
        <EmptyState
          title={t(($) => $['newKnowledge.retrievalTest.emptyTitle'])}
          description={t(($) => $['newKnowledge.retrievalTest.emptyDescription'])}
        />
      )}
      {selected && resultKey && (
        <div className="flex h-full min-h-0 flex-col gap-3">
          <RetrievalResultSession key={resultKey} />
          <RetrievalQualityWorkflow />
        </div>
      )}
    </section>
  )
}
