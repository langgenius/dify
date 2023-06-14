import type { IOnCompleted, IOnData, IOnError } from './base'
import {
  del as consoleDel, get as consoleGet, post as consolePost,
  delPublic as del, getPublic as get, postPublic as post, ssePost,
} from './base'
import type { Feedbacktype } from '@/app/components/app/chat'

function getAction(action: 'get' | 'post' | 'del', isInstalledApp: boolean) {
  switch (action) {
    case 'get':
      return isInstalledApp ? consoleGet : get
    case 'post':
      return isInstalledApp ? consolePost : post
    case 'del':
      return isInstalledApp ? consoleDel : del
  }
}

function getUrl(url: string, isInstalledApp: boolean, installedAppId: string) {
  return isInstalledApp ? `installed-apps/${installedAppId}/${url.startsWith('/') ? url.slice(1) : url}` : url
}

export const sendChatMessage = async (body: Record<string, any>, { onData, onCompleted, onError, getAbortController }: {
  onData: IOnData
  onCompleted: IOnCompleted
  onError: IOnError
  getAbortController?: (abortController: AbortController) => void
}, isInstalledApp: boolean, installedAppId = '') => {
  return ssePost(getUrl('chat-messages', isInstalledApp, installedAppId), {
    body: {
      ...body,
      response_mode: 'streaming',
    },
  }, { onData, onCompleted, isPublicAPI: !isInstalledApp, onError, getAbortController })
}

export const stopChatMessageResponding = async (appId: string, taskId: string, isInstalledApp: boolean, installedAppId = '') => {
  return getAction('post', isInstalledApp)(getUrl(`chat-messages/${taskId}/stop`, isInstalledApp, installedAppId))
}

export const sendCompletionMessage = async (body: Record<string, any>, { onData, onCompleted, onError }: {
  onData: IOnData
  onCompleted: IOnCompleted
  onError: IOnError
}, isInstalledApp: boolean, installedAppId = '') => {
  return ssePost(getUrl('completion-messages', isInstalledApp, installedAppId), {
    body: {
      ...body,
      response_mode: 'streaming',
    },
  }, { onData, onCompleted, isPublicAPI: !isInstalledApp, onError })
}

export const fetchAppInfo = async () => {
  return get('/site')
}

export const fetchConversations = async (isInstalledApp: boolean, installedAppId = '', last_id?: string) => {
  return getAction('get', isInstalledApp)(getUrl('conversations', isInstalledApp, installedAppId), { params: { ...{ limit: 20 }, ...(last_id ? { last_id } : {}) } })
}

export const fetchChatList = async (conversationId: string, isInstalledApp: boolean, installedAppId = '') => {
  return getAction('get', isInstalledApp)(getUrl('messages', isInstalledApp, installedAppId), { params: { conversation_id: conversationId, limit: 20, last_id: '' } })
}

// Abandoned API interface
// export const fetchAppVariables = async () => {
//   return get(`variables`)
// }

// init value. wait for server update
export const fetchAppParams = async (isInstalledApp: boolean, installedAppId = '') => {
  return (getAction('get', isInstalledApp))(getUrl('parameters', isInstalledApp, installedAppId))
}

export const updateFeedback = async ({ url, body }: { url: string; body: Feedbacktype }, isInstalledApp: boolean, installedAppId = '') => {
  return (getAction('post', isInstalledApp))(getUrl(url, isInstalledApp, installedAppId), { body })
}

export const fetchMoreLikeThis = async (messageId: string, isInstalledApp: boolean, installedAppId = '') => {
  return (getAction('get', isInstalledApp))(getUrl(`/messages/${messageId}/more-like-this`, isInstalledApp, installedAppId), {
    params: {
      response_mode: 'blocking',
    },
  })
}

export const saveMessage = (messageId: string, isInstalledApp: boolean, installedAppId = '') => {
  return (getAction('post', isInstalledApp))(getUrl('/saved-messages', isInstalledApp, installedAppId), { body: { message_id: messageId } })
}

export const fetchSavedMessage = async (isInstalledApp: boolean, installedAppId = '') => {
  return (getAction('get', isInstalledApp))(getUrl('/saved-messages', isInstalledApp, installedAppId))
}

export const removeMessage = (messageId: string, isInstalledApp: boolean, installedAppId = '') => {
  return (getAction('del', isInstalledApp))(getUrl(`/saved-messages/${messageId}`, isInstalledApp, installedAppId))
}

export const fetchSuggestedQuestions = (messageId: string, isInstalledApp: boolean, installedAppId = '') => {
  return (getAction('get', isInstalledApp))(getUrl(`/messages/${messageId}/suggested-questions`, isInstalledApp, installedAppId))
}
