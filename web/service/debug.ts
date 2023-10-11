import type { IOnCompleted, IOnData, IOnError, IOnMessageEnd } from './base'
import { get, post, ssePost } from './base'
import type { ChatPromptConfig, CompletionPromptConfig } from '@/models/debug'
import type { ModelModeType } from '@/types/app'

export type AutomaticRes = {
  prompt: string
  variables: string[]
  opening_statement: string
}

export const sendChatMessage = async (appId: string, body: Record<string, any>, { onData, onCompleted, onError, getAbortController, onMessageEnd }: {
  onData: IOnData
  onCompleted: IOnCompleted
  onMessageEnd: IOnMessageEnd
  onError: IOnError
  getAbortController?: (abortController: AbortController) => void
}) => {
  return ssePost(`apps/${appId}/chat-messages`, {
    body: {
      ...body,
      response_mode: 'streaming',
    },
  }, { onData, onCompleted, onError, getAbortController, onMessageEnd })
}

export const stopChatMessageResponding = async (appId: string, taskId: string) => {
  return post(`apps/${appId}/chat-messages/${taskId}/stop`)
}

export const sendCompletionMessage = async (appId: string, body: Record<string, any>, { onData, onCompleted, onError }: {
  onData: IOnData
  onCompleted: IOnCompleted
  onError: IOnError
}) => {
  return ssePost(`apps/${appId}/completion-messages`, {
    body: {
      ...body,
      response_mode: 'streaming',
    },
  }, { onData, onCompleted, onError })
}

export const fetchSuggestedQuestions = (appId: string, messageId: string) => {
  return get(`apps/${appId}/chat-messages/${messageId}/suggested-questions`)
}

export const fetchConvesationMessages = (appId: string, conversation_id: string) => {
  return get(`apps/${appId}/chat-messages`, {
    params: {
      conversation_id,
    },
  })
}

export const generateRule = (body: Record<string, any>) => {
  return post<AutomaticRes>('/rule-generate', {
    body,
  })
}

export const fetchModelParams = (providerName: string, modelId: string) => {
  return get(`workspaces/current/model-providers/${providerName}/models/parameter-rules`, {
    params: {
      model_name: modelId,
    },
  })
}

export const fetchPromptTemplate = ({
  appMode,
  mode,
  modelName,
}: { appMode: string; mode: ModelModeType; modelName: string }) => {
  return get<Promise<{ chat_prompt_config: ChatPromptConfig; completion_prompt_config: CompletionPromptConfig }>>('/app/prompt-templates', {
    params: {
      app_mode: appMode,
      model_mode: mode,
      model_name: modelName,
    },
  })
}
