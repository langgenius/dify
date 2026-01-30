import type {
  IOnCompleted,
  IOnData,
  IOnError,
  IOnIterationFinished,
  IOnIterationNext,
  IOnIterationStarted,
  IOnLoopFinished,
  IOnLoopNext,
  IOnLoopStarted,
  IOnMessageReplace,
  IOnNodeFinished,
  IOnNodeStarted,
  IOnTextChunk,
  IOnTextReplace,
  IOnWorkflowFinished,
  IOnWorkflowStarted,
} from './base'
import type { FeedbackType } from '@/app/components/base/chat/chat/type'
import type { ChatConfig } from '@/app/components/base/chat/types'
import type { AccessMode } from '@/models/access-control'
import type {
  AppConversationData,
  AppData,
  AppMeta,
  ConversationItem,
} from '@/models/share'
import { WEB_APP_SHARE_CODE_HEADER_NAME } from '@/config'
import {
  del as consoleDel,
  get as consoleGet,
  patch as consolePatch,
  post as consolePost,
  delPublic as del,
  getPublic as get,
  patchPublic as patch,
  postPublic as post,
  ssePost,
} from './base'
import { getWebAppAccessToken } from './webapp-auth'

export enum AppSourceType {
  webApp = 'webApp',
  installedApp = 'installedApp',
  tryApp = 'tryApp',
}

const apiPrefix = {
  [AppSourceType.webApp]: '',
  [AppSourceType.installedApp]: 'installed-apps',
  [AppSourceType.tryApp]: 'trial-apps',
}

function getIsPublicAPI(appSourceType: AppSourceType) {
  return appSourceType === AppSourceType.webApp
}

function getAction(action: 'get' | 'post' | 'del' | 'patch', appSourceType: AppSourceType) {
  const isNeedLogin = !getIsPublicAPI(appSourceType)
  switch (action) {
    case 'get':
      return isNeedLogin ? consoleGet : get
    case 'post':
      return isNeedLogin ? consolePost : post
    case 'patch':
      return isNeedLogin ? consolePatch : patch
    case 'del':
      return isNeedLogin ? consoleDel : del
  }
}

export function getUrl(url: string, appSourceType: AppSourceType, appId: string) {
  const hasPrefix = appSourceType !== AppSourceType.webApp
  return hasPrefix ? `${apiPrefix[appSourceType]}/${appId}/${url.startsWith('/') ? url.slice(1) : url}` : url
}

export const stopChatMessageResponding = async (appId: string, taskId: string, appSourceType: AppSourceType, installedAppId = '') => {
  return getAction('post', appSourceType)(getUrl(`chat-messages/${taskId}/stop`, appSourceType, installedAppId))
}

export const sendCompletionMessage = async (body: Record<string, any>, { onData, onCompleted, onError, onMessageReplace, getAbortController }: {
  onData: IOnData
  onCompleted: IOnCompleted
  onError: IOnError
  onMessageReplace: IOnMessageReplace
  getAbortController?: (abortController: AbortController) => void
}, appSourceType: AppSourceType, installedAppId = '') => {
  return ssePost(getUrl('completion-messages', appSourceType, installedAppId), {
    body: {
      ...body,
      response_mode: 'streaming',
    },
  }, { onData, onCompleted, isPublicAPI: getIsPublicAPI(appSourceType), onError, onMessageReplace, getAbortController })
}

export const sendWorkflowMessage = async (
  body: Record<string, any>,
  {
    onWorkflowStarted,
    onNodeStarted,
    onNodeFinished,
    onWorkflowFinished,
    onIterationStart,
    onIterationNext,
    onIterationFinish,
    onLoopStart,
    onLoopNext,
    onLoopFinish,
    onTextChunk,
    onTextReplace,
  }: {
    onWorkflowStarted: IOnWorkflowStarted
    onNodeStarted: IOnNodeStarted
    onNodeFinished: IOnNodeFinished
    onWorkflowFinished: IOnWorkflowFinished
    onIterationStart: IOnIterationStarted
    onIterationNext: IOnIterationNext
    onIterationFinish: IOnIterationFinished
    onLoopStart: IOnLoopStarted
    onLoopNext: IOnLoopNext
    onLoopFinish: IOnLoopFinished
    onTextChunk: IOnTextChunk
    onTextReplace: IOnTextReplace
  },
  appSourceType: AppSourceType,
  appId = '',
) => {
  return ssePost(getUrl('workflows/run', appSourceType, appId), {
    body: {
      ...body,
      response_mode: 'streaming',
    },
  }, {
    onNodeStarted,
    onWorkflowStarted,
    onWorkflowFinished,
    isPublicAPI: getIsPublicAPI(appSourceType),
    onNodeFinished,
    onIterationStart,
    onIterationNext,
    onIterationFinish,
    onLoopStart,
    onLoopNext,
    onLoopFinish,
    onTextChunk,
    onTextReplace,
  })
}

export const stopWorkflowMessage = async (_appId: string, taskId: string, appSourceType: AppSourceType, installedAppId = '') => {
  if (!taskId)
    return
  return getAction('post', appSourceType)(getUrl(`workflows/tasks/${taskId}/stop`, appSourceType, installedAppId))
}

export const fetchAppInfo = async () => {
  return get('/site') as Promise<AppData>
}

export const fetchConversations = async (appSourceType: AppSourceType, installedAppId = '', last_id?: string, pinned?: boolean, limit?: number) => {
  return getAction('get', appSourceType)(getUrl('conversations', appSourceType, installedAppId), { params: { limit: limit || 20, ...(last_id ? { last_id } : {}), ...(pinned !== undefined ? { pinned } : {}) } }) as Promise<AppConversationData>
}

export const pinConversation = async (appSourceType: AppSourceType, installedAppId = '', id: string) => {
  return getAction('patch', appSourceType)(getUrl(`conversations/${id}/pin`, appSourceType, installedAppId))
}

export const unpinConversation = async (appSourceType: AppSourceType, installedAppId = '', id: string) => {
  return getAction('patch', appSourceType)(getUrl(`conversations/${id}/unpin`, appSourceType, installedAppId))
}

export const delConversation = async (appSourceType: AppSourceType, installedAppId = '', id: string) => {
  return getAction('del', appSourceType)(getUrl(`conversations/${id}`, appSourceType, installedAppId))
}

export const renameConversation = async (appSourceType: AppSourceType, installedAppId = '', id: string, name: string) => {
  return getAction('post', appSourceType)(getUrl(`conversations/${id}/name`, appSourceType, installedAppId), { body: { name } })
}

export const generationConversationName = async (appSourceType: AppSourceType, installedAppId = '', id: string) => {
  return getAction('post', appSourceType)(getUrl(`conversations/${id}/name`, appSourceType, installedAppId), { body: { auto_generate: true } }) as Promise<ConversationItem>
}

export const fetchChatList = async (conversationId: string, appSourceType: AppSourceType, installedAppId = '') => {
  return getAction('get', appSourceType)(getUrl('messages', appSourceType, installedAppId), { params: { conversation_id: conversationId, limit: 20, last_id: '' } }) as any
}

// Abandoned API interface
// export const fetchAppVariables = async () => {
//   return get(`variables`)
// }

// init value. wait for server update
export const fetchAppParams = async (appSourceType: AppSourceType, appId = '') => {
  return (getAction('get', appSourceType))(getUrl('parameters', appSourceType, appId)) as Promise<ChatConfig>
}

export const fetchWebSAMLSSOUrl = async (appCode: string, redirectUrl: string) => {
  return (getAction('get', AppSourceType.webApp))(getUrl('/enterprise/sso/saml/login', AppSourceType.webApp, ''), {
    params: {
      app_code: appCode,
      redirect_url: redirectUrl,
    },
  }) as Promise<{ url: string }>
}

export const fetchWebOIDCSSOUrl = async (appCode: string, redirectUrl: string) => {
  return (getAction('get', AppSourceType.webApp))(getUrl('/enterprise/sso/oidc/login', AppSourceType.webApp, ''), {
    params: {
      app_code: appCode,
      redirect_url: redirectUrl,
    },

  }) as Promise<{ url: string }>
}

export const fetchWebOAuth2SSOUrl = async (appCode: string, redirectUrl: string) => {
  return (getAction('get', AppSourceType.webApp))(getUrl('/enterprise/sso/oauth2/login', AppSourceType.webApp, ''), {
    params: {
      app_code: appCode,
      redirect_url: redirectUrl,
    },
  }) as Promise<{ url: string }>
}

export const fetchMembersSAMLSSOUrl = async (appCode: string, redirectUrl: string) => {
  return (getAction('get', AppSourceType.webApp))(getUrl('/enterprise/sso/members/saml/login', AppSourceType.webApp, ''), {
    params: {
      app_code: appCode,
      redirect_url: redirectUrl,
    },
  }) as Promise<{ url: string }>
}

export const fetchMembersOIDCSSOUrl = async (appCode: string, redirectUrl: string) => {
  return (getAction('get', AppSourceType.webApp))(getUrl('/enterprise/sso/members/oidc/login', AppSourceType.webApp, ''), {
    params: {
      app_code: appCode,
      redirect_url: redirectUrl,
    },

  }) as Promise<{ url: string }>
}

export const fetchMembersOAuth2SSOUrl = async (appCode: string, redirectUrl: string) => {
  return (getAction('get', AppSourceType.webApp))(getUrl('/enterprise/sso/members/oauth2/login', AppSourceType.webApp, ''), {
    params: {
      app_code: appCode,
      redirect_url: redirectUrl,
    },
  }) as Promise<{ url: string }>
}

export const fetchAppMeta = async (appSourceType: AppSourceType, installedAppId = '') => {
  return (getAction('get', appSourceType))(getUrl('meta', appSourceType, installedAppId)) as Promise<AppMeta>
}

export const updateFeedback = async ({ url, body }: { url: string, body: FeedbackType }, appSourceType: AppSourceType, installedAppId = '') => {
  return (getAction('post', appSourceType))(getUrl(url, appSourceType, installedAppId), { body })
}

export const fetchMoreLikeThis = async (messageId: string, appSourceType: AppSourceType, installedAppId = '') => {
  return (getAction('get', appSourceType))(getUrl(`/messages/${messageId}/more-like-this`, appSourceType, installedAppId), {
    params: {
      response_mode: 'blocking',
    },
  })
}

export const saveMessage = (messageId: string, appSourceType: AppSourceType, installedAppId = '') => {
  return (getAction('post', appSourceType))(getUrl('/saved-messages', appSourceType, installedAppId), { body: { message_id: messageId } })
}

export const fetchSavedMessage = async (appSourceType: AppSourceType, installedAppId = '') => {
  return (getAction('get', appSourceType))(getUrl('/saved-messages', appSourceType, installedAppId), {}, {
    silent: true,
  })
}

export const removeMessage = (messageId: string, appSourceType: AppSourceType, installedAppId = '') => {
  return (getAction('del', appSourceType))(getUrl(`/saved-messages/${messageId}`, appSourceType, installedAppId))
}

export const fetchSuggestedQuestions = (messageId: string, appSourceType: AppSourceType, installedAppId = '') => {
  return (getAction('get', appSourceType))(getUrl(`/messages/${messageId}/suggested-questions`, appSourceType, installedAppId))
}

export const audioToText = (url: string, appSourceType: AppSourceType, body: FormData) => {
  return (getAction('post', appSourceType))(url, { body }, { bodyStringify: false, deleteContentType: true }) as Promise<{ text: string }>
}

export const textToAudioStream = (url: string, appSourceType: AppSourceType, header: { content_type: string }, body: { streaming: boolean, voice?: string, message_id?: string, text?: string | null | undefined }) => {
  return (getAction('post', appSourceType))(url, { body, header }, { needAllResponseContent: true })
}

export const textToAudio = (url: string, appSourceType: AppSourceType, body: FormData) => {
  return (getAction('post', appSourceType))(url, { body }, { bodyStringify: false, deleteContentType: true }) as Promise<{ data: string }>
}

export const fetchAccessToken = async ({ userId, appCode }: { userId?: string, appCode: string }) => {
  const headers = new Headers()
  headers.append(WEB_APP_SHARE_CODE_HEADER_NAME, appCode)
  const accessToken = getWebAppAccessToken()
  if (accessToken)
    headers.append('Authorization', `Bearer ${accessToken}`)
  const params = new URLSearchParams()
  if (userId)
    params.append('user_id', userId)
  const url = `/passport?${params.toString()}`
  return get<{ access_token: string }>(url, { headers }) as Promise<{ access_token: string }>
}

export const getUserCanAccess = (appId: string, isInstalledApp: boolean) => {
  if (isInstalledApp)
    return consoleGet<{ result: boolean }>(`/enterprise/webapp/permission?appId=${appId}`)

  return get<{ result: boolean }>(`/webapp/permission?appId=${appId}`)
}

export const getAppAccessModeByAppCode = (appCode: string) => {
  return get<{ accessMode: AccessMode }>(`/webapp/access-mode?appCode=${appCode}`)
}
