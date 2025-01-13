import React, { useState } from 'react'
import produce from 'immer'
import type { AnnotationReplyConfig } from '@/models/debug'
import { queryAnnotationJobStatus, updateAnnotationStatus } from '@/service/annotation'
import type { EmbeddingModelConfig } from '@/app/components/app/annotation/type'
import { AnnotationEnableStatus, JobStatus } from '@/app/components/app/annotation/type'
import { sleep } from '@/utils'
import { ANNOTATION_DEFAULT } from '@/config'
import { useProviderContext } from '@/context/provider-context'

type Params = {
  appId: string
  annotationConfig: AnnotationReplyConfig
  setAnnotationConfig: (annotationConfig: AnnotationReplyConfig) => void
}
const useAnnotationConfig = ({
  appId,
  annotationConfig,
  setAnnotationConfig,
}: Params) => {
  const { plan, enableBilling } = useProviderContext()
  const isAnnotationFull = (enableBilling && plan.usage.annotatedResponse >= plan.total.annotatedResponse)
  const [isShowAnnotationFullModal, setIsShowAnnotationFullModal] = useState(false)
  const [isShowAnnotationConfigInit, doSetIsShowAnnotationConfigInit] = React.useState(false)
  const setIsShowAnnotationConfigInit = (isShow: boolean) => {
    if (isShow) {
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
      if (isCompleted)
        break

      await sleep(2000)
    }
  }

  const handleEnableAnnotation = async (embeddingModel: EmbeddingModelConfig, score?: number) => {
    if (isAnnotationFull)
      return

    const { job_id: jobId }: any = await updateAnnotationStatus(appId, AnnotationEnableStatus.enable, embeddingModel, score)
    await ensureJobCompleted(jobId, AnnotationEnableStatus.enable)
    setAnnotationConfig(produce(annotationConfig, (draft: AnnotationReplyConfig) => {
      draft.enabled = true
      draft.embedding_model = embeddingModel
      if (!draft.score_threshold)
        draft.score_threshold = ANNOTATION_DEFAULT.score_threshold
    }))
  }

  const setScore = (score: number, embeddingModel?: EmbeddingModelConfig) => {
    setAnnotationConfig(produce(annotationConfig, (draft: AnnotationReplyConfig) => {
      draft.score_threshold = score
      if (embeddingModel)
        draft.embedding_model = embeddingModel
    }))
  }

  const handleDisableAnnotation = async (embeddingModel: EmbeddingModelConfig) => {
    if (!annotationConfig.enabled)
      return

    await updateAnnotationStatus(appId, AnnotationEnableStatus.disable, embeddingModel)
    setAnnotationConfig(produce(annotationConfig, (draft: AnnotationReplyConfig) => {
      draft.enabled = false
    }))
  }

  return {
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
