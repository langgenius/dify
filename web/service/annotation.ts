import { del, get, post } from './base'
import type { AnnotationEnableStatus, AnnotationItemBasic } from '@/app/components/app/annotation/type'

export const updateAnnotationStatus = (appId: string, action: AnnotationEnableStatus) => {
  return post(`apps/${appId}/annotation-reply/${action}`)
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

export const editAnnotation = (appId: string, annotationId: string, body: AnnotationItemBasic) => {
  return post(`apps/${appId}/annotations/${annotationId}`, { body })
}

export const delAnnotation = (appId: string, annotationId: string) => {
  return del(`apps/${appId}/annotations/${annotationId}`)
}

export const fetchHitHistoryList = (appId: string, annotationId: string, params: Record<string, any>) => {
  return get(`apps/${appId}/annotations/${annotationId}/hit-histories`, { params })
}
