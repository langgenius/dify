import type { TransferMethod, TtsAutoPlay } from '@/types/app'

export type EnabledOrDisabled = {
  enabled?: boolean
}

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
    number_limits?: number
    transfer_methods?: TransferMethod[]
  }
}

export enum FeatureEnum {
  opening = 'opening',
  suggested = 'suggested',
  text2speech = 'text2speech',
  speech2text = 'speech2text',
  citation = 'citation',
  moderation = 'moderation',
  file = 'file',
}

export type Features = {
  [FeatureEnum.opening]?: OpeningStatement
  [FeatureEnum.suggested]?: SuggestedQuestionsAfterAnswer
  [FeatureEnum.text2speech]?: TextToSpeech
  [FeatureEnum.speech2text]?: SpeechToText
  [FeatureEnum.citation]?: RetrieverResource
  [FeatureEnum.moderation]?: SensitiveWordAvoidance
  [FeatureEnum.file]?: FileUpload
}

export type OnFeaturesChange = (features: Features) => void
