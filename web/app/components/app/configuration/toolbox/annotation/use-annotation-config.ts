import React from 'react'
import produce from 'immer'
import type { AnnotationReplyConfig } from '@/models/debug'
import { queryAnnotationJobStatus, updateAnnotationStatus } from '@/service/annotation'
import type { EmbeddingModelConfig } from '@/app/components/app/annotation/type'
import { AnnotationEnableStatus, JobStatus } from '@/app/components/app/annotation/type'
import { sleep } from '@/utils'
import { ANNOTATION_DEFAULT } from '@/config'
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
  const [isShowAnnotationConfigInit, setIsShowAnnotationConfigInit] = React.useState(false)

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

  const handleEnableAnnotation = async (embeddingModel: EmbeddingModelConfig) => {
    if (annotationConfig.enabled)
      return

    const { job_id: jobId }: any = await updateAnnotationStatus(appId, AnnotationEnableStatus.enable, embeddingModel)
    await ensureJobCompleted(jobId, AnnotationEnableStatus.enable)
    setAnnotationConfig(produce(annotationConfig, (draft: AnnotationReplyConfig) => {
      draft.enabled = true
      draft.embedding_model = embeddingModel
      if (!draft.score_threshold)
        draft.score_threshold = ANNOTATION_DEFAULT.score_threshold
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
  }
}

export default useAnnotationConfig
