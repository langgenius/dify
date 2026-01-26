import type { IOnCompleted, IOnData, IOnError, IOnFile, IOnMessageEnd, IOnMessageReplace, IOnThought } from './base'
import type { FileEntity } from '@/app/components/base/file-uploader/types'
import type { ModelParameterRule } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { ChatPromptConfig, CompletionPromptConfig } from '@/models/debug'
import type { AppModeEnum, CompletionParams, ModelModeType } from '@/types/app'
import { get, post, ssePost } from './base'

export type BasicAppFirstRes = {
  prompt: string
  variables: string[]
  opening_statement: string
  error?: string
}

export type GenRes = {
  modified: string
  message?: string // tip for human
  variables?: string[] // only for basic app first time rule
  opening_statement?: string // only for basic app first time rule
  error?: string
}

export type CodeGenRes = {
  code: string
  language: string[]
  error?: string
}

export type ContextGenerateMessage = {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  tool_call_id?: string
}

// FIXME
export type ContextGenerateAvailableVar = {
  value_selector: string[]
  type: string
  description?: string
  node_id?: string
  node_title?: string
  node_type?: string
  schema?: Record<string, unknown> | null
}

export type ContextGenerateParameterInfo = {
  name: string
  type?: string
  description?: string
  required?: boolean
  options?: string[]
  min?: number
  max?: number
  default?: string | number | boolean | null
  multiple?: boolean
  label?: string
}

export type ContextGenerateCodeContext = {
  code: string
  outputs?: Record<string, { type: string }>
  variables?: ContextGenerateVariable[]
}

export type ContextGenerateRequest = {
  language?: 'python3' | 'javascript'
  prompt_messages: ContextGenerateMessage[]
  model_config: {
    provider: string
    name: string
    completion_params?: CompletionParams
  }
  available_vars: ContextGenerateAvailableVar[]
  parameter_info: ContextGenerateParameterInfo
  code_context?: ContextGenerateCodeContext | null
}

export type ContextGenerateVariable = {
  variable: string
  value_selector: string[]
}

export type ContextGenerateResponse = {
  variables: ContextGenerateVariable[]
  code_language: string
  code: string
  outputs: Record<string, { type: string }>
  message: string
  error: string
}

export type ContextGenerateSuggestedQuestionsRequest = {
  language: string
  model_config?: {
    provider: string
    name: string
    completion_params?: CompletionParams
  }
  available_vars: ContextGenerateAvailableVar[]
  parameter_info: ContextGenerateParameterInfo
}

export type ContextGenerateSuggestedQuestionsResponse = {
  questions: string[]
  error: string
}

export type TextGenerationMessageFile = FileEntity & {
  belongs_to?: 'assistant' | 'user' | string
}

export type TextGenerationMessageItem = {
  role: 'assistant' | 'user' | 'system'
  text: string
  files?: TextGenerationMessageFile[]
}

export type TextGenerationMessageResponse = {
  id?: string
  answer?: string
  message: string | TextGenerationMessageItem | TextGenerationMessageItem[]
  message_files?: TextGenerationMessageFile[]
}

export const sendChatMessage = async (appId: string, body: Record<string, unknown>, { onData, onCompleted, onThought, onFile, onError, getAbortController, onMessageEnd, onMessageReplace }: {
  onData: IOnData
  onCompleted: IOnCompleted
  onFile: IOnFile
  onThought: IOnThought
  onMessageEnd: IOnMessageEnd
  onMessageReplace: IOnMessageReplace
  onError: IOnError
  getAbortController?: (abortController: AbortController) => void
}) => {
  return ssePost(`apps/${appId}/chat-messages`, {
    body: {
      ...body,
      response_mode: 'streaming',
    },
  }, { onData, onCompleted, onThought, onFile, onError, getAbortController, onMessageEnd, onMessageReplace })
}

export const stopChatMessageResponding = async (appId: string, taskId: string) => {
  return post(`apps/${appId}/chat-messages/${taskId}/stop`)
}

export const sendCompletionMessage = async (appId: string, body: Record<string, unknown>, { onData, onCompleted, onError, onMessageReplace }: {
  onData: IOnData
  onCompleted: IOnCompleted
  onError: IOnError
  onMessageReplace: IOnMessageReplace
}) => {
  return ssePost(`apps/${appId}/completion-messages`, {
    body: {
      ...body,
      response_mode: 'streaming',
    },
  }, { onData, onCompleted, onError, onMessageReplace })
}

export const fetchSuggestedQuestions = (appId: string, messageId: string, getAbortController?: (abortController: AbortController) => void) => {
  return get(
    `apps/${appId}/chat-messages/${messageId}/suggested-questions`,
    {},
    {
      getAbortController,
    },
  )
}

export const fetchConversationMessages = (appId: string, conversation_id: string, getAbortController?: (abortController: AbortController) => void) => {
  return get(`apps/${appId}/chat-messages`, {
    params: {
      conversation_id,
    },
  }, {
    getAbortController,
  })
}

export const generateBasicAppFirstTimeRule = (body: Record<string, unknown>) => {
  return post<BasicAppFirstRes>('/rule-generate', {
    body,
  })
}

export const generateRule = (body: Record<string, unknown>) => {
  return post<GenRes>('/instruction-generate', {
    body,
  })
}

export const generateContext = (body: ContextGenerateRequest) => {
  return post<ContextGenerateResponse>('/context-generate', {
    body,
  })
}

export const fetchContextGenerateSuggestedQuestions = (
  body: ContextGenerateSuggestedQuestionsRequest,
  getAbortController?: (abortController: AbortController) => void,
) => {
  return post<ContextGenerateSuggestedQuestionsResponse>('/context-generate/suggested-questions', {
    body,
  }, {
    getAbortController,
    silent: true,
  })
}

export const fetchModelParams = (providerName: string, modelId: string) => {
  return get(`workspaces/current/model-providers/${providerName}/models/parameter-rules`, {
    params: {
      model: modelId,
    },
  }) as Promise<{ data: ModelParameterRule[] }>
}

export const fetchPromptTemplate = ({
  appMode,
  mode,
  modelName,
  hasSetDataSet,
}: { appMode: AppModeEnum, mode: ModelModeType, modelName: string, hasSetDataSet: boolean }) => {
  return get<Promise<{ chat_prompt_config: ChatPromptConfig, completion_prompt_config: CompletionPromptConfig, stop: [] }>>('/app/prompt-templates', {
    params: {
      app_mode: appMode,
      model_mode: mode,
      model_name: modelName,
      has_context: hasSetDataSet,
    },
  })
}

export const fetchTextGenerationMessage = ({
  appId,
  messageId,
}: { appId: string, messageId: string }) => {
  return get<Promise<TextGenerationMessageResponse>>(`/apps/${appId}/messages/${messageId}`)
}
