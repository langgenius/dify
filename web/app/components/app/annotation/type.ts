export type AnnotationItemBasic = {
  message_id?: string
  question: string
  answer: string
}

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
