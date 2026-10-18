import type {
  AnnotationEnableStatus,
  EmbeddingModelConfig,
} from '@/app/components/app/annotation/type'
import { ANNOTATION_DEFAULT } from '@/config'
import { post } from './base'
import { consoleClient } from './console'

export const updateAnnotationStatus = (
  appId: string,
  action: AnnotationEnableStatus,
  embeddingModel?: EmbeddingModelConfig,
  score?: number,
) =>
  consoleClient.apps.byAppId.annotationReply.byAction.post({
    params: { app_id: appId, action },
    body: {
      score_threshold: score ?? ANNOTATION_DEFAULT.score_threshold,
      // Disabling does not use the embedding model; the API still requires the fields.
      embedding_provider_name: embeddingModel?.embedding_provider_name ?? '',
      embedding_model_name: embeddingModel?.embedding_model_name ?? '',
    },
  })

// Multipart uploads are not described by the generated contract yet.
export const annotationBatchImport = (appId: string, body: FormData) =>
  post<{ job_id: string; job_status: string }>(
    `/apps/${appId}/annotations/batch-import`,
    { body },
    { bodyStringify: false, deleteContentType: true },
  )
