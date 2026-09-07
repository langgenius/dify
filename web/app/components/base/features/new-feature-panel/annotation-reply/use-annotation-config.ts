import type { EmbeddingModelConfig } from '@/app/components/app/annotation/type'
import type { AnnotationReplyConfig } from '@/models/debug'
import { useQuery } from '@tanstack/react-query'
import { produce } from 'immer'
import { useAtomValue } from 'jotai'
import * as React from 'react'
import { useState } from 'react'
import { AnnotationEnableStatus, JobStatus } from '@/app/components/app/annotation/type'
import { ANNOTATION_DEFAULT } from '@/config'
import { deploymentEditionAtom } from '@/features/system-features/state'
import { queryAnnotationJobStatus, updateAnnotationStatus } from '@/service/annotation'
import { consoleQuery } from '@/service/client'
import { sleep } from '@/utils'

type Params = {
  appId: string
  annotationConfig: AnnotationReplyConfig
  setAnnotationConfig: (annotationConfig: AnnotationReplyConfig) => void
}
const useAnnotationConfig = ({ appId, annotationConfig, setAnnotationConfig }: Params) => {
  const deploymentEdition = useAtomValue(deploymentEditionAtom)
  const { data: annotationQuota } = useQuery(
    consoleQuery.features.get.queryOptions({
      enabled: deploymentEdition === 'CLOUD' && !annotationConfig.enabled,
      select: (data) => data.annotation_quota_limit,
    }),
  )
  const isAnnotationQuotaUnavailable =
    deploymentEdition === 'CLOUD' && annotationQuota === undefined
  // A limit of 0 means unlimited.
  const isAnnotationFull =
    deploymentEdition === 'CLOUD' &&
    annotationQuota !== undefined &&
    annotationQuota.limit > 0 &&
    annotationQuota.size >= annotationQuota.limit
  const [isShowAnnotationFullModal, setIsShowAnnotationFullModal] = useState(false)
  const [isShowAnnotationConfigInit, doSetIsShowAnnotationConfigInit] = React.useState(false)
  const setIsShowAnnotationConfigInit = (isShow: boolean) => {
    if (isShow && !annotationConfig.enabled) {
      if (isAnnotationQuotaUnavailable) return
      if (isAnnotationFull) {
        setIsShowAnnotationFullModal(true)
        return
      }
    }
    doSetIsShowAnnotationConfigInit(isShow)
  }
  const ensureJobCompleted = async (jobId: string, status: AnnotationEnableStatus) => {
    let isCompleted = false
    while (!isCompleted) {
      const res: any = await queryAnnotationJobStatus(appId, status, jobId)
      isCompleted = res.job_status === JobStatus.completed
      if (isCompleted) break

      await sleep(2000)
    }
  }

  const handleEnableAnnotation = async (embeddingModel: EmbeddingModelConfig, score?: number) => {
    if (!annotationConfig.enabled && (isAnnotationQuotaUnavailable || isAnnotationFull)) return

    const { job_id: jobId }: any = await updateAnnotationStatus(
      appId,
      AnnotationEnableStatus.enable,
      embeddingModel,
      score,
    )
    await ensureJobCompleted(jobId, AnnotationEnableStatus.enable)
    setAnnotationConfig(
      produce(annotationConfig, (draft: AnnotationReplyConfig) => {
        draft.enabled = true
        draft.embedding_model = embeddingModel
        if (draft.score_threshold === undefined || draft.score_threshold === null)
          draft.score_threshold = ANNOTATION_DEFAULT.score_threshold
      }),
    )
  }

  const setScore = (score: number, embeddingModel?: EmbeddingModelConfig) => {
    setAnnotationConfig(
      produce(annotationConfig, (draft: AnnotationReplyConfig) => {
        draft.score_threshold = score
        if (embeddingModel) draft.embedding_model = embeddingModel
      }),
    )
  }

  const handleDisableAnnotation = async (embeddingModel: EmbeddingModelConfig) => {
    if (!annotationConfig.enabled) return

    await updateAnnotationStatus(appId, AnnotationEnableStatus.disable, embeddingModel)
    setAnnotationConfig(
      produce(annotationConfig, (draft: AnnotationReplyConfig) => {
        draft.enabled = false
      }),
    )
  }

  return {
    isAnnotationQuotaUnavailable,
    handleEnableAnnotation,
    handleDisableAnnotation,
    isShowAnnotationConfigInit,
    setIsShowAnnotationConfigInit,
    isShowAnnotationFullModal,
    setIsShowAnnotationFullModal,
    setScore,
  }
}

export default useAnnotationConfig
