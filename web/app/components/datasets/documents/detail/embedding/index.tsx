import type { FC } from 'react'
import type { IndexingType } from '../../../create/step-two'
import type { RETRIEVE_METHOD } from '@/types/app'
import * as React from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useContext } from 'use-context-selector'
import { ToastContext } from '@/app/components/base/toast'
import { useProcessRule } from '@/service/knowledge/use-dataset'
import { useDocumentContext } from '../context'
import { ProgressBar, RuleDetail, SegmentProgress, StatusHeader } from './components'
import { useEmbeddingStatus, usePauseIndexing, useResumeIndexing } from './hooks'
import EmbeddingSkeleton from './skeleton'

type EmbeddingDetailProps = {
  datasetId?: string
  documentId?: string
  indexingType?: IndexingType
  retrievalMethod?: RETRIEVE_METHOD
  detailUpdate: VoidFunction
}

const EmbeddingDetail: FC<EmbeddingDetailProps> = ({
  datasetId: dstId,
  documentId: docId,
  detailUpdate,
  indexingType,
  retrievalMethod,
}) => {
  const { t } = useTranslation()
  const { notify } = useContext(ToastContext)

  const contextDatasetId = useDocumentContext(s => s.datasetId)
  const contextDocumentId = useDocumentContext(s => s.documentId)
  const datasetId = dstId ?? contextDatasetId
  const documentId = docId ?? contextDocumentId

  const {
    data: indexingStatus,
    isEmbedding,
    isCompleted,
    isPaused,
    isError,
    percent,
    resetStatus,
    refetch,
  } = useEmbeddingStatus({
    datasetId,
    documentId,
    onComplete: detailUpdate,
  })

  const { data: ruleDetail } = useProcessRule(documentId)

  const handleSuccess = useCallback(() => {
    notify({ type: 'success', message: t('actionMsg.modifiedSuccessfully', { ns: 'common' }) })
  }, [notify, t])

  const handleError = useCallback(() => {
    notify({ type: 'error', message: t('actionMsg.modifiedUnsuccessfully', { ns: 'common' }) })
  }, [notify, t])

  const pauseMutation = usePauseIndexing({
    datasetId,
    documentId,
    onSuccess: () => {
      handleSuccess()
      resetStatus()
    },
    onError: handleError,
  })

  const resumeMutation = useResumeIndexing({
    datasetId,
    documentId,
    onSuccess: () => {
      handleSuccess()
      refetch()
      detailUpdate()
    },
    onError: handleError,
  })

  const handlePause = useCallback(() => {
    pauseMutation.mutate()
  }, [pauseMutation])

  const handleResume = useCallback(() => {
    resumeMutation.mutate()
  }, [resumeMutation])

  return (
    <>
      <div className="flex flex-col gap-y-2 px-16 py-12">
        <StatusHeader
          isEmbedding={isEmbedding}
          isCompleted={isCompleted}
          isPaused={isPaused}
          isError={isError}
          onPause={handlePause}
          onResume={handleResume}
          isPauseLoading={pauseMutation.isPending}
          isResumeLoading={resumeMutation.isPending}
        />
        <ProgressBar
          percent={percent}
          isEmbedding={isEmbedding}
          isCompleted={isCompleted}
          isPaused={isPaused}
          isError={isError}
        />
        <SegmentProgress
          completedSegments={indexingStatus?.completed_segments}
          totalSegments={indexingStatus?.total_segments}
          percent={percent}
        />
        <RuleDetail
          sourceData={ruleDetail}
          indexingType={indexingType}
          retrievalMethod={retrievalMethod}
        />
      </div>
      <EmbeddingSkeleton />
    </>
  )
}

export default React.memo(EmbeddingDetail)
