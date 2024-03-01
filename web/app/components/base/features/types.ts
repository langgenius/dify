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
