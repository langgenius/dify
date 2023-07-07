export type Inputs = Record<string, string | number | object>

export type PromptVariable = {
  key: string
  name: string
  type: string // "string" | "number" | "select",
  default?: string | number
  required: boolean
  options?: string[]
  max_length?: number
}

export type CompletionParams = {
  max_tokens: number
  temperature: number
  top_p: number
  presence_penalty: number
  frequency_penalty: number
}

export type ModelId = 'gpt-3.5-turbo' | 'text-davinci-003'

export type PromptConfig = {
  prompt_template: string
  prompt_variables: PromptVariable[]
}

export type MoreLikeThisConfig = {
  enabled: boolean
}

export type SuggestedQuestionsAfterAnswerConfig = MoreLikeThisConfig

export type SpeechToTextConfig = MoreLikeThisConfig

// frontend use. Not the same as backend
export type ModelConfig = {
  provider: string // LLM Provider: for example "OPENAI"
  model_id: string
  configs: PromptConfig
  opening_statement: string | null
  more_like_this: {
    enabled: boolean
  } | null
  suggested_questions_after_answer: {
    enabled: boolean
  } | null
  speech_to_text: {
    enabled: boolean
  } | null
  dataSets: any[]
}

export type DebugRequestBody = {
  inputs: Inputs
  query: string
  completion_params: CompletionParams
  model_config: ModelConfig
}

export type DebugResponse = {
  id: string
  answer: string
  created_at: string
}

export type DebugResponseStream = {
  id: string
  data: string
  created_at: string
}

export type FeedBackRequestBody = {
  message_id: string
  rating: 'like' | 'dislike'
  content?: string
  from_source: 'api' | 'log'
}

export type FeedBackResponse = {
  message_id: string
  rating: 'like' | 'dislike'
}

// Log session list
export type LogSessionListQuery = {
  keyword?: string
  start?: string // format datetime(YYYY-mm-dd HH:ii)
  end?: string // format datetime(YYYY-mm-dd HH:ii)
  page: number
  limit: number // default 20. 1-100
}

export type LogSessionListResponse = {
  data: {
    id: string
    conversation_id: string
    query: string // user's query question
    message: string // prompt send to LLM
    answer: string
    creat_at: string
  }[]
  total: number
  page: number
}

// log session detail and debug
export type LogSessionDetailResponse = {
  id: string
  cnversation_id: string
  model_provider: string
  query: string
  inputs: Record<string, string | number | object>[]
  message: string
  message_tokens: number // number of tokens in message
  answer: string
  answer_tokens: number // number of tokens in answer
  provider_response_latency: number // used time in ms
  from_source: 'api' | 'log'
}

export type SavedMessage = {
  id: string
  answer: string
}
