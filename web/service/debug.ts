import type { IOnCompleted, IOnData, IOnError, IOnFile, IOnMessageEnd, IOnMessageReplace, IOnThought } from './base'
import type { ModelParameterRule } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { ChatPromptConfig, CompletionPromptConfig } from '@/models/debug'
import type { AppModeEnum, ModelModeType } from '@/types/app'
import Cookies from 'js-cookie'
import Toast from '@/app/components/base/toast'
import { API_PREFIX, CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from '@/config'
import { get, post, ssePost } from './base'
import { getBaseOptions } from './fetch'

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

export type ToolRecommendation = {
  requested_capability: string
  unconfigured_tools: Array<{
    provider_id: string
    tool_name: string
    description: string
  }>
  configured_alternatives: Array<{
    provider_id: string
    tool_name: string
    description: string
  }>
  recommendation: string
}

export type BackendNodeSpec = {
  id: string
  type: string
  title?: string
  config?: Record<string, any>
  position?: { x: number, y: number }
}

export type BackendEdgeSpec = {
  source: string
  target: string
  sourceHandle?: string
  targetHandle?: string
}

export type FlowchartGenRes = {
  intent?: 'generate' | 'off_topic' | 'error'
  flowchart: string
  nodes?: BackendNodeSpec[]
  edges?: BackendEdgeSpec[]
  message?: string
  warnings?: string[]
  suggestions?: string[]
  tool_recommendations?: ToolRecommendation[]
  error?: string
}

export type CodeGenRes = {
  code: string
  language: string[]
  error?: string
}

export const sendChatMessage = async (appId: string, body: Record<string, any>, { onData, onCompleted, onThought, onFile, onError, getAbortController, onMessageEnd, onMessageReplace }: {
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

export const generateFlowchart = (body: Record<string, any>) => {
  return post<FlowchartGenRes>('/flowchart-generate', {
    body,
  })
}

export type FlowchartStreamCallbacks = {
  onStage?: (data: { stage: string, message: string }) => void
  onComplete?: (data: FlowchartGenRes) => void
  onError?: (error: string, errorCode?: string) => void
  getAbortController?: (controller: AbortController) => void
}

export const generateFlowchartStream = async (
  body: Record<string, any>,
  callbacks: FlowchartStreamCallbacks,
) => {
  const { onStage, onComplete, onError, getAbortController } = callbacks
  const abortController = new AbortController()
  getAbortController?.(abortController)

  // Use base options for credentials and CORS settings
  const baseOptions = getBaseOptions()
  const options: RequestInit = {
    ...baseOptions,
    method: 'POST',
    headers: new Headers({
      'Content-Type': 'application/json',
      [CSRF_HEADER_NAME]: Cookies.get(CSRF_COOKIE_NAME()) || '',
    }),
    body: JSON.stringify(body),
    signal: abortController.signal,
  }

  try {
    const response = await globalThis.fetch(`${API_PREFIX}/flowchart-generate/stream`, options)

    if (!response.ok) {
      try {
        const errorData = await response.json()
        const errorMessage = errorData.message || 'Request failed'
        Toast.notify({ type: 'error', message: errorMessage })
        onError?.(errorMessage, errorData.code)
      }
      catch {
        Toast.notify({ type: 'error', message: 'Request failed' })
        onError?.('Request failed')
      }
      return
    }

    const reader = response.body?.getReader()
    if (!reader)
      return

    const decoder = new TextDecoder('utf-8')
    let buffer = ''
    let done = false

    while (!done) {
      const result = await reader.read()
      done = result.done

      if (result.value) {
        buffer += decoder.decode(result.value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data: '))
            continue

          try {
            const data = JSON.parse(line.substring(6))

            if (data.event === 'stage') {
              onStage?.({ stage: data.stage, message: data.message })
            }
            else if (data.event === 'complete') {
              onComplete?.(data as FlowchartGenRes)
            }
            else if (data.event === 'error') {
              Toast.notify({ type: 'error', message: data.error })
              onError?.(data.error, data.error_code)
            }
          }
          catch {
            // Ignore parse errors for incomplete chunks
          }
        }
      }
    }
  }
  catch (error) {
    // Ignore abort errors and read-only property errors (page leave)
    if (error instanceof Error) {
      const isAbortError = error.name === 'AbortError' || error.message.includes('AbortError')
      const isReadOnlyError = error.message.includes('TypeError: Cannot assign to read only property')
      if (!isAbortError && !isReadOnlyError) {
        Toast.notify({ type: 'error', message: error.message })
        onError?.(error.message)
      }
    }
  }
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
