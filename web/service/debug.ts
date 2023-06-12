import type { IOnCompleted, IOnData, IOnError } from './base'
import { get, post, ssePost } from './base'

export const sendChatMessage = async (appId: string, body: Record<string, any>, { onData, onCompleted, onError, getAbortController }: {
  onData: IOnData
  onCompleted: IOnCompleted
  onError: IOnError
  getAbortController?: (abortController: AbortController) => void
}) => {
  return ssePost(`apps/${appId}/chat-messages`, {
    body: {
      ...body,
      response_mode: 'streaming',
    },
  }, { onData, onCompleted, onError, getAbortController })
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
  return post('/rule-generate', {
    body,
  })
}
