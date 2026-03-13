import type { IOnCompleted, IOnData, IOnError, IOnMessageReplace } from './base'
import type { ModelParameterRule } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { ChatPromptConfig, CompletionPromptConfig } from '@/models/debug'
import type { AppModeEnum, ModelModeType } from '@/types/app'
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

export const stopChatMessageResponding = async (appId: string, taskId: string) => {
  return post(`apps/${appId}/chat-messages/${taskId}/stop`)
}

export const sendCompletionMessage = async (appId: string, body: Record<string, any>, { onData, onCompleted, onError, onMessageReplace }: {
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

export const fetchSuggestedQuestions = (appId: string, messageId: string, getAbortController?: any) => {
  return get(
    `apps/${appId}/chat-messages/${messageId}/suggested-questions`,
    {},
    {
      getAbortController,
    },
  )
}

export const fetchConversationMessages = (appId: string, conversation_id: string, getAbortController?: any) => {
  return get(`apps/${appId}/chat-messages`, {
    params: {
      conversation_id,
    },
  }, {
    getAbortController,
  })
}

export const generateBasicAppFirstTimeRule = (body: Record<string, any>) => {
  return post<BasicAppFirstRes>('/rule-generate', {
    body,
  })
}

export const generateRule = (body: Record<string, any>) => {
  return post<GenRes>('/instruction-generate', {
    body,
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
  return get<Promise<any>>(`/apps/${appId}/messages/${messageId}`)
}
