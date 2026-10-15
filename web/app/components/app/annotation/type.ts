import type { Annotation, AnnotationHitHistory } from '@dify/contracts/api/console/apps/types.gen'

export type AnnotationItemBasic = {
  message_id?: string
  question: string
  answer: string
}

export type AnnotationItem = Annotation

export type HitHistoryItem = AnnotationHitHistory

export type EmbeddingModelConfig = {
  embedding_provider_name: string
  embedding_model_name: string
}

export const AnnotationEnableStatus = {
  enable: 'enable',
  disable: 'disable',
} as const

export type AnnotationEnableStatus =
  (typeof AnnotationEnableStatus)[keyof typeof AnnotationEnableStatus]

export const JobStatus = {
  completed: 'completed',
} as const
