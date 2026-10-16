import type { AdvancedPromptTemplateResponse } from '@dify/contracts/api/console/app/types.gen'
import type { AppMode } from '@dify/contracts/api/console/apps/types.gen'
import type { PostInstructionGenerateData } from '@dify/contracts/api/console/instruction-generate/types.gen'
import type { PostRuleGenerateData } from '@dify/contracts/api/console/rule-generate/types.gen'
import type { IOnCompleted, IOnData, IOnError, IOnMessageReplace } from './base'
import type { Model, ModelModeType } from '@/types/app'
import { ssePost } from './base'
import { consoleClient } from './console'

export type GenRes = {
  modified: string
  message?: string // tip for human
  variables?: string[] // only for basic app first time rule
  opening_statement?: string // only for basic app first time rule
  error?: string
}

const getString = (record: Record<string, unknown>, key: string) => {
  const value = record[key]
  return typeof value === 'string' ? value : undefined
}

/**
 * The instruction generator answers with the generated rule, generated code or an LLM-written
 * JSON object, depending on what is being edited; read the fields the editors understand.
 */
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const toGenRes = (value: unknown): GenRes & { code?: string } => {
  const fields = isRecord(value) ? value : {}
  const variables = fields.variables
  return {
    modified: getString(fields, 'modified') ?? getString(fields, 'prompt') ?? '',
    message: getString(fields, 'message'),
    variables: Array.isArray(variables)
      ? variables.filter((item): item is string => typeof item === 'string')
      : undefined,
    opening_statement: getString(fields, 'opening_statement'),
    code: getString(fields, 'code'),
    error: getString(fields, 'error') || undefined,
  }
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
  return consoleClient.ruleGenerate.post({ body: body as PostRuleGenerateData['body'] })
}

export const generateRule = (body: InstructionGenerateRequest) => {
  return consoleClient.instructionGenerate
    .post({ body: body as PostInstructionGenerateData['body'] })
    .then(toGenRes)
}

// A completion template without history prefixes keeps them empty, as the console's default does.
const toPromptTemplates = ({
  chat_prompt_config,
  completion_prompt_config,
  stop,
}: AdvancedPromptTemplateResponse) => ({
  chat_prompt_config: chat_prompt_config ?? undefined,
  completion_prompt_config: completion_prompt_config
    ? {
        prompt: completion_prompt_config.prompt,
        conversation_histories_role: completion_prompt_config.conversation_histories_role ?? {
          user_prefix: '',
          assistant_prefix: '',
        },
      }
    : undefined,
  stop: stop ?? [],
})

export const fetchPromptTemplate = ({
  appMode,
  mode,
  modelName,
  hasSetDataSet,
}: {
  appMode: AppMode
  mode: ModelModeType
  modelName: string
  hasSetDataSet: boolean
}) => {
  return consoleClient.app.promptTemplates
    .get({
      query: {
        app_mode: appMode,
        model_mode: mode,
        model_name: modelName,
        has_context: String(hasSetDataSet),
      },
    })
    .then(toPromptTemplates)
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
