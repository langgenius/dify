import { createStore } from 'zustand'
import type {
  AnnotationReply,
  OpeningStatement,
  RetrieverResource,
  SensitiveWordAvoidance,
  SpeechToText,
  SuggestedQuestionsAfterAnswer,
  TextToSpeech,
} from './types'

export type FeaturesModal = {
  showFeaturesModal: boolean
  setShowFeaturesModal: (showFeaturesModal: boolean) => void
}

export type FeaturesState = {
  openingStatement: OpeningStatement
  suggestedQuestionsAfterAnswer: SuggestedQuestionsAfterAnswer
  textToSpeech: TextToSpeech
  speechToText: SpeechToText
  citation: RetrieverResource
  moderation: SensitiveWordAvoidance
  annotation: AnnotationReply
}

export type FeaturesAction = {
  setOpeningStatement: (openingStatement: OpeningStatement) => void
  setSuggestedQuestionsAfterAnswer: (suggestedQuestionsAfterAnswer: SuggestedQuestionsAfterAnswer) => void
  setTextToSpeech: (textToSpeech: TextToSpeech) => void
  setSpeechToText: (speechToText: SpeechToText) => void
  setCitation: (citation: RetrieverResource) => void
  setModeration: (moderation: SensitiveWordAvoidance) => void
  setAnnotation: (annotation: AnnotationReply) => void
}

export type FeatureStoreState = FeaturesState & FeaturesAction & FeaturesModal

export type FeaturesStore = ReturnType<typeof createFeaturesStore>

export const createFeaturesStore = (initProps?: Partial<FeaturesState>) => {
  const DEFAULT_PROPS: FeaturesState = {
    openingStatement: {
      enabled: false,
    },
    suggestedQuestionsAfterAnswer: {
      enabled: false,
    },
    textToSpeech: {
      enabled: false,
    },
    speechToText: {
      enabled: false,
    },
    citation: {
      enabled: false,
    },
    moderation: {
      enabled: false,
    },
    annotation: {
      enabled: false,
    },
  }
  return createStore<FeatureStoreState>()(set => ({
    ...DEFAULT_PROPS,
    ...initProps,
    setOpeningStatement: openingStatement => set(() => ({ openingStatement })),
    setSuggestedQuestionsAfterAnswer: suggestedQuestionsAfterAnswer => set(() => ({ suggestedQuestionsAfterAnswer })),
    setSpeechToText: speechToText => set(() => ({ speechToText })),
    setTextToSpeech: textToSpeech => set(() => ({ textToSpeech })),
    setCitation: citation => set(() => ({ citation })),
    setModeration: moderation => set(() => ({ moderation })),
    setAnnotation: annotation => set(() => ({ annotation })),

    showFeaturesModal: false,
    setShowFeaturesModal: showFeaturesModal => set(() => ({ showFeaturesModal })),
  }))
}
