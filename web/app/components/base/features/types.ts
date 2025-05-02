import type { Resolution, TransferMethod, TtsAutoPlay } from '@/types/app'
import type { FileUploadConfigResponse } from '@/models/common'

export type EnabledOrDisabled = {
  enabled?: boolean
}

export type MoreLikeThis = EnabledOrDisabled

export type OpeningStatement = EnabledOrDisabled & {
  opening_statement?: string
  suggested_questions?: string[]
}

export type SuggestedQuestionsAfterAnswer = EnabledOrDisabled

export type TextToSpeech = EnabledOrDisabled & {
  language?: string
  voice?: string
  autoPlay?: TtsAutoPlay
}

export type SpeechToText = EnabledOrDisabled

export type RetrieverResource = EnabledOrDisabled

export type SensitiveWordAvoidance = EnabledOrDisabled & {
  type?: string
  config?: any
}

export type FileUpload = {
  image?: EnabledOrDisabled & {
    detail?: Resolution
    number_limits?: number
    transfer_methods?: TransferMethod[]
  }
  allowed_file_types?: string[]
  allowed_file_extensions?: string[]
  allowed_file_upload_methods?: TransferMethod[]
  number_limits?: number
  fileUploadConfig?: FileUploadConfigResponse
} & EnabledOrDisabled

export type AnnotationReplyConfig = {
  enabled: boolean
  id?: string
  score_threshold?: number
  embedding_model?: {
    embedding_provider_name: string
    embedding_model_name: string
  }
}

export enum FeatureEnum {
  moreLikeThis = 'moreLikeThis',
  opening = 'opening',
  suggested = 'suggested',
  text2speech = 'text2speech',
  speech2text = 'speech2text',
  citation = 'citation',
  moderation = 'moderation',
  file = 'file',
  annotationReply = 'annotationReply',
}

export type Features = {
  [FeatureEnum.moreLikeThis]?: MoreLikeThis
  [FeatureEnum.opening]?: OpeningStatement
  [FeatureEnum.suggested]?: SuggestedQuestionsAfterAnswer
  [FeatureEnum.text2speech]?: TextToSpeech
  [FeatureEnum.speech2text]?: SpeechToText
  [FeatureEnum.citation]?: RetrieverResource
  [FeatureEnum.moderation]?: SensitiveWordAvoidance
  [FeatureEnum.file]?: FileUpload
  [FeatureEnum.annotationReply]?: AnnotationReplyConfig
}

export type OnFeaturesChange = (features?: Features) => void
