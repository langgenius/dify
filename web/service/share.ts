import type { IOnCompleted, IOnData, IOnError } from './base'
import { getPublic as get, postPublic as post, ssePost, delPublic as del } from './base'
import type { Feedbacktype } from '@/app/components/app/chat'

export const sendChatMessage = async (body: Record<string, any>, { onData, onCompleted, onError, getAbortController }: {
  onData: IOnData
  onCompleted: IOnCompleted
  onError: IOnError,
  getAbortController?: (abortController: AbortController) => void
}) => {
  return ssePost('chat-messages', {
    body: {
      ...body,
      response_mode: 'streaming',
    },
  }, { onData, onCompleted, isPublicAPI: true, onError, getAbortController })
}

export const sendCompletionMessage = async (body: Record<string, any>, { onData, onCompleted, onError }: {
  onData: IOnData
  onCompleted: IOnCompleted
  onError: IOnError
}) => {
  return ssePost('completion-messages', {
    body: {
      ...body,
      response_mode: 'streaming',
    },
  }, { onData, onCompleted, isPublicAPI: true, onError })
}

export const fetchAppInfo = async () => {
  return get('/site')
}

export const fetchConversations = async () => {
  return get('conversations', { params: { limit: 20, first_id: '' } })
}

export const fetchChatList = async (conversationId: string) => {
  return get('messages', { params: { conversation_id: conversationId, limit: 20, last_id: '' } })
}

// Abandoned API interface
// export const fetchAppVariables = async () => {
//   return get(`variables`)
// }

// init value. wait for server update
export const fetchAppParams = async () => {
  return get('parameters')
}

export const updateFeedback = async ({ url, body }: { url: string; body: Feedbacktype }) => {
  return post(url, { body })
}

export const fetcMoreLikeThis = async (messageId: string) => {
  return get(`/messages/${messageId}/more-like-this`, {
    params: {
      response_mode: 'blocking',
    }
  })
}

export const saveMessage = (messageId: string) => {
  return post('/saved-messages', { body: { message_id: messageId } })
}

export const fetchSavedMessage = async () => {
  return get(`/saved-messages`)
}


export const removeMessage = (messageId: string) => {
  return del(`/saved-messages/${messageId}`)
}

export const fetchSuggestedQuestions = (messageId: string) => {
  return get(`/messages/${messageId}/suggested-questions`)
}
