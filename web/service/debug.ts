import type { PostInstructionGenerateData } from '@dify/contracts/api/console/instruction-generate/types.gen'
import type { PostRuleGenerateData } from '@dify/contracts/api/console/rule-generate/types.gen'
import type { IOnCompleted, IOnData, IOnError, IOnMessageReplace } from './base'
import type { ChatPromptConfig, CompletionPromptConfig } from '@/models/debug'
import type { AppModeEnum, Model, ModelModeType } from '@/types/app'
import { ssePost } from './base'
import { consoleClient } from './console'
import { narrowResponse } from './console/narrow-response'

type BasicAppFirstRes = {
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

export const stopChatMessageResponding = async (appId: string, taskId: string) => {
  return consoleClient.apps.byAppId.chatMessages.byTaskId.stop.post({
    params: { app_id: appId, task_id: taskId },
  })
}

export const sendCompletionMessage = async (
  appId: string,
  body: Record<string, any>,
  handlers: {
    onData: IOnData
    onCompleted: IOnCompleted
    onError: IOnError
    onMessageReplace: IOnMessageReplace
    onNotifyError?: IOnError
  },
) => {
  return ssePost(
    `apps/${appId}/completion-messages`,
    {
      body: {
        ...body,
        response_mode: 'streaming',
      },
    },
    handlers,
  )
}

const createAbortSignal = (getAbortController?: (abortController: AbortController) => void) => {
  const abortController = new AbortController()
  getAbortController?.(abortController)
  return abortController.signal
}

export const fetchSuggestedQuestions = (
  appId: string,
  messageId: string,
  getAbortController?: (abortController: AbortController) => void,
) => {
  return consoleClient.apps.byAppId.chatMessages.byMessageId.suggestedQuestions.get(
    { params: { app_id: appId, message_id: messageId } },
    { signal: createAbortSignal(getAbortController) },
  )
}

export const fetchConversationMessages = (
  appId: string,
  conversation_id: string,
  getAbortController?: (abortController: AbortController) => void,
) => {
  return consoleClient.apps.byAppId.chatMessages.get(
    { params: { app_id: appId }, query: { conversation_id } },
    { signal: createAbortSignal(getAbortController) },
  )
}

// The model selector keeps an unset mode as '' and generators may omit the flow id; the
// backend validates both, so the UI request shapes are passed through as the contract bodies.
type RuleGenerateRequest = Omit<PostRuleGenerateData['body'], 'model_config'> & {
  model_config: Model
}

type InstructionGenerateRequest = Omit<
  PostInstructionGenerateData['body'],
  'model_config' | 'flow_id'
> & {
  model_config: Model
  flow_id?: string
}

export const generateBasicAppFirstTimeRule = (body: RuleGenerateRequest) => {
  return narrowResponse<BasicAppFirstRes>(
    consoleClient.ruleGenerate.post({ body: body as PostRuleGenerateData['body'] }),
  )
}

export const generateRule = (body: InstructionGenerateRequest) => {
  return narrowResponse<GenRes>(
    consoleClient.instructionGenerate.post({ body: body as PostInstructionGenerateData['body'] }),
  )
}

export const fetchPromptTemplate = ({
  appMode,
  mode,
  modelName,
  hasSetDataSet,
}: {
  appMode: AppModeEnum
  mode: ModelModeType
  modelName: string
  hasSetDataSet: boolean
}) => {
  return narrowResponse<{
    chat_prompt_config: ChatPromptConfig
    completion_prompt_config: CompletionPromptConfig
    stop: []
  }>(
    consoleClient.app.promptTemplates.get({
      query: {
        app_mode: appMode,
        model_mode: mode,
        model_name: modelName,
        has_context: String(hasSetDataSet),
      },
    }),
  )
}

export const fetchTextGenerationMessage = ({
  appId,
  messageId,
}: {
  appId: string
  messageId: string
}) => {
  return consoleClient.apps.byAppId.messages.byMessageId.get({
    params: { app_id: appId, message_id: messageId },
  })
}
