export type EnabledOrDisabled = {
  enabled: boolean
}

export type OpeningStatement = EnabledOrDisabled & {
  opening_statement?: string
  suggested_questions?: string[]
}

export type SuggestedQuestionsAfterAnswer = EnabledOrDisabled

export type TextToSpeech = EnabledOrDisabled & {
  language?: string
  voice?: string
}

export type SpeechToText = EnabledOrDisabled

export type RetrieverResource = EnabledOrDisabled

export type SensitiveWordAvoidance = EnabledOrDisabled & {
  type?: string
  config?: any
}

export type AnnotationReply = EnabledOrDisabled & {
  id?: string
  score_threshold?: number
  embedding_model?: {
    embedding_model_name: string
    embedding_provider_name: string
  }
}

export enum FeatureEnum {
  opening = 'opening',
  suggested = 'suggested',
  text2speech = 'text2speech',
  speech2text = 'speech2text',
  citation = 'citation',
  moderation = 'moderation',
  annotation = 'annotation',
}

export type Features = {
  [FeatureEnum.opening]: OpeningStatement
  [FeatureEnum.suggested]: SuggestedQuestionsAfterAnswer
  [FeatureEnum.text2speech]: TextToSpeech
  [FeatureEnum.speech2text]: SpeechToText
  [FeatureEnum.citation]: RetrieverResource
  [FeatureEnum.moderation]: SensitiveWordAvoidance
  [FeatureEnum.annotation]: AnnotationReply
}
