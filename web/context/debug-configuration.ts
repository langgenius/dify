import { createContext } from 'use-context-selector'
import type { CompletionParams, Inputs, ModelConfig, MoreLikeThisConfig, PromptConfig, SuggestedQuestionsAfterAnswerConfig } from '@/models/debug'
import type { DataSet } from '@/models/datasets'

type IDebugConfiguration = {
  appId: string
  hasSetAPIKEY: boolean
  isTrailFinished: boolean
  mode: string
  conversationId: string | null // after first chat send
  setConversationId: (conversationId: string | null) => void
  introduction: string
  setIntroduction: (introduction: string) => void
  controlClearChatMessage: number
  setControlClearChatMessage: (controlClearChatMessage: number) => void
  prevPromptConfig: PromptConfig
  setPrevPromptConfig: (prevPromptConfig: PromptConfig) => void
  moreLikeThisConfig: MoreLikeThisConfig
  setMoreLikeThisConfig: (moreLikeThisConfig: MoreLikeThisConfig) => void
  suggestedQuestionsAfterAnswerConfig: SuggestedQuestionsAfterAnswerConfig
  setSuggestedQuestionsAfterAnswerConfig: (suggestedQuestionsAfterAnswerConfig: SuggestedQuestionsAfterAnswerConfig) => void
  formattingChanged: boolean
  setFormattingChanged: (formattingChanged: boolean) => void
  inputs: Inputs
  setInputs: (inputs: Inputs) => void
  query: string // user question
  setQuery: (query: string) => void
  // Belows are draft infos
  completionParams: CompletionParams
  setCompletionParams: (completionParams: CompletionParams) => void
  // model_config
  modelConfig: ModelConfig
  setModelConfig: (modelConfig: ModelConfig) => void
  dataSets: DataSet[]
  setDataSets: (dataSet: DataSet[]) => void
}

const DebugConfigurationContext = createContext<IDebugConfiguration>({
  appId: '',
  hasSetAPIKEY: false,
  isTrailFinished: false,
  mode: '',
  conversationId: '',
  setConversationId: () => { },
  introduction: '',
  setIntroduction: () => { },
  controlClearChatMessage: 0,
  setControlClearChatMessage: () => { },
  prevPromptConfig: {
    prompt_template: '',
    prompt_variables: [],
  },
  setPrevPromptConfig: () => { },
  moreLikeThisConfig: {
    enabled: false,
  },
  setMoreLikeThisConfig: () => { },
  suggestedQuestionsAfterAnswerConfig: {
    enabled: false,
  },
  setSuggestedQuestionsAfterAnswerConfig: () => { },
  formattingChanged: false,
  setFormattingChanged: () => { },
  inputs: {},
  setInputs: () => { },
  query: '',
  setQuery: () => { },
  completionParams: {
    max_tokens: 16,
    temperature: 1, // 0-2
    top_p: 1,
    presence_penalty: 1, // -2-2
    frequency_penalty: 1, // -2-2
  },
  setCompletionParams: () => { },
  modelConfig: {
    provider: 'OPENAI', // 'OPENAI'
    model_id: 'gpt-3.5-turbo', // 'gpt-3.5-turbo'
    configs: {
      prompt_template: '',
      prompt_variables: [],
    },
  },
  setModelConfig: () => { },
  dataSets: [],
  setDataSets: () => { },
})

export default DebugConfigurationContext
