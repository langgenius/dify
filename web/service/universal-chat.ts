import type { IOnCompleted, IOnData, IOnError } from './base'
import {
  del, get, patch, post, ssePost,
} from './base'
import type { Feedbacktype } from '@/app/components/app/chat'

const baseUrl = 'universal-chat'

function getUrl(url: string) {
  return `${baseUrl}/${url.startsWith('/') ? url.slice(1) : url}`
}

export const sendChatMessage = async (body: Record<string, any>, { onData, onCompleted, onError, getAbortController }: {
  onData: IOnData
  onCompleted: IOnCompleted
  onError: IOnError
  getAbortController?: (abortController: AbortController) => void
}) => {
  return ssePost(getUrl('chat-messages'), {
    body: {
      ...body,
      response_mode: 'streaming',
    },
  }, { onData, onCompleted, onError, getAbortController })
}

export const stopChatMessageResponding = async (appId: string, taskId: string) => {
  return post(getUrl(`messages/${taskId}/stop`))
}

export const fetchConversations = async (last_id?: string, pinned?: boolean, limit?: number) => {
  return get(getUrl('conversations'), { params: { ...{ limit: limit || 20 }, ...(last_id ? { last_id } : {}), ...(pinned !== undefined ? { pinned } : {}) } })
}

export const pinConversation = async (id: string) => {
  return patch(getUrl(`conversations/${id}/pin`))
}

export const unpinConversation = async (id: string) => {
  return patch(getUrl(`conversations/${id}/unpin`))
}

export const delConversation = async (id: string) => {
  return del(getUrl(`conversations/${id}`))
}

export const fetchChatList = async (conversationId: string) => {
  return get(getUrl('messages'), { params: { conversation_id: conversationId, limit: 20, last_id: '' } })
}

// init value. wait for server update
export const fetchAppParams = async () => {
  return get(getUrl('parameters'))
}

export const updateFeedback = async ({ url, body }: { url: string; body: Feedbacktype }) => {
  return post(getUrl(url), { body })
}

export const fetchMoreLikeThis = async (messageId: string) => {
  return get(getUrl(`/messages/${messageId}/more-like-this`), {
    params: {
      response_mode: 'blocking',
    },
  })
}

export const fetchSuggestedQuestions = (messageId: string) => {
  return get(getUrl(`/messages/${messageId}/suggested-questions`))
}

export const audioToText = (url: string, body: FormData) => {
  return post(url, { body }, { bodyStringify: false, deleteContentType: true }) as Promise<{ text: string }>
}
