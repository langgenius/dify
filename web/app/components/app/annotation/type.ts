export type AnnotationItemBasic = {
  question: string
  answer: string
}

export type AnnotationItem = {
  id: string
  question: string
  answer: string
  created_at: string
  hit_count: number
}

export type HitHistoryItem = {
  id: string
  question: string
  source: string
  score: number
  created_at: string
}

export type EmbeddingModelConfig = {
  embedding_provider_name: string
  embedding_model_name: string
}

export enum AnnotationEnableStatus {
  enable = 'enable',
  disable = 'disable',
}

export enum JobStatus {
  waiting = 'waiting',
  processing = 'processing',
  completed = 'completed',
}
