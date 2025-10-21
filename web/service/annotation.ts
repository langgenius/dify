import type { Fetcher } from 'swr'
import { del, get, post } from './base'
import type { AnnotationEnableStatus, AnnotationItemBasic, EmbeddingModelConfig } from '@/app/components/app/annotation/type'
import { ANNOTATION_DEFAULT } from '@/config'

export const fetchAnnotationConfig = (appId: string) => {
  return get(`apps/${appId}/annotation-setting`)
}
export const updateAnnotationStatus = (appId: string, action: AnnotationEnableStatus, embeddingModel?: EmbeddingModelConfig, score?: number) => {
  let body: any = {
    score_threshold: score || ANNOTATION_DEFAULT.score_threshold,
  }
  if (embeddingModel) {
    body = {
      ...body,
      ...embeddingModel,
    }
  }

  return post(`apps/${appId}/annotation-reply/${action}`, {
    body,
  })
}

export const updateAnnotationScore = (appId: string, settingId: string, score: number) => {
  return post(`apps/${appId}/annotation-settings/${settingId}`, {
    body: { score_threshold: score },
  })
}

export const queryAnnotationJobStatus = (appId: string, action: AnnotationEnableStatus, jobId: string) => {
  return get(`apps/${appId}/annotation-reply/${action}/status/${jobId}`)
}

export const fetchAnnotationList = (appId: string, params: Record<string, any>) => {
  return get(`apps/${appId}/annotations`, { params })
}

export const fetchExportAnnotationList = (appId: string) => {
  return get(`apps/${appId}/annotations/export`)
}

export const addAnnotation = (appId: string, body: AnnotationItemBasic) => {
  return post(`apps/${appId}/annotations`, { body })
}

export const annotationBatchImport: Fetcher<{ job_id: string; job_status: string }, { url: string; body: FormData }> = ({ url, body }) => {
  return post<{ job_id: string; job_status: string }>(url, { body }, { bodyStringify: false, deleteContentType: true })
}

export const checkAnnotationBatchImportProgress: Fetcher<{ job_id: string; job_status: string }, { jobID: string; appId: string }> = ({ jobID, appId }) => {
  return get<{ job_id: string; job_status: string }>(`/apps/${appId}/annotations/batch-import-status/${jobID}`)
}

export const editAnnotation = (appId: string, annotationId: string, body: AnnotationItemBasic) => {
  return post(`apps/${appId}/annotations/${annotationId}`, { body })
}

export const delAnnotation = (appId: string, annotationId: string) => {
  return del(`apps/${appId}/annotations/${annotationId}`)
}

export const delAnnotations = (appId: string, annotationIds: string[]) => {
  const params = annotationIds.map(id => `annotation_id=${id}`).join('&')
  return del(`/apps/${appId}/annotations?${params}`)
}

export const fetchHitHistoryList = (appId: string, annotationId: string, params: Record<string, any>) => {
  return get(`apps/${appId}/annotations/${annotationId}/hit-histories`, { params })
}

export const clearAllAnnotations = (appId: string): Promise<any> => {
  return del(`apps/${appId}/annotations`)
}
