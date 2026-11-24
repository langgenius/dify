import type {
  MessageFeedbackPayload,
  PostInstalledAppsByInstalledAppIdChatMessagesData,
  PostInstalledAppsByInstalledAppIdCompletionMessagesData,
  PostInstalledAppsByInstalledAppIdWorkflowsRunData,
  SimpleConversation,
} from '@dify/contracts/api/console/installed-apps/types.gen'
import type {
  PostTrialAppsByAppIdChatMessagesData,
  PostTrialAppsByAppIdCompletionMessagesData,
  PostTrialAppsByAppIdWorkflowsRunData,
} from '@dify/contracts/api/console/trial-apps/types.gen'
import type {
  PostChatMessagesData,
  PostCompletionMessagesData,
  PostWorkflowsRunData,
} from '@dify/contracts/api/web/types.gen'
import type {
  IOnCompleted,
  IOnData,
  IOnError,
  IOnMessageReplace,
  StreamCallbacks,
  StreamSender,
} from './event-stream'
import type { ChatConfig } from '@/app/components/base/chat/types'
import type { LegacyHumanInputFormData as HumanInputFormData } from '@/features/human-input/form/types'
import type { AccessMode } from '@/models/access-control'
import type { AppConversationData, AppData, AppMeta, ConversationItem } from '@/models/share'
import type { HumanInputFormData as WorkflowHumanInputFormData } from '@/types/workflow'
import { zWebAppHumanInputV2SubmitPayload } from '@dify/contracts/api/web/zod.gen'
import { WEB_APP_SHARE_CODE_HEADER_NAME } from '@/config'
import {
  captureAppAccessScope,
  hasAppAccessError,
  isAppAccessError,
  isAppAccessScopeCurrent,
} from '@/features/app-access-error/state'
import { consoleClient } from '@/service/console'
import { selectAppParameters } from '@/service/console/app-parameters-select'
import {
  del as consoleDel,
  get as consoleGet,
  patch as consolePatch,
  post as consolePost,
  delPublic as del,
  getPublic as get,
  patchPublic as patch,
  postPublic as post,
  upload,
} from './base'
import { streamEvents } from './event-stream'
import { resolveWebAppAddress } from './webapp-address'
import { getOrCreateWebAppSessionId, getWebAppAccessToken } from './webapp-auth'
import { webAppClient } from './webapp-client'

export const AppSourceType = {
  webApp: 'webApp',
  installedApp: 'installedApp',
  tryApp: 'tryApp',
} as const

export type AppSourceType = (typeof AppSourceType)[keyof typeof AppSourceType]

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

function getUrl(url: string, appSourceType: AppSourceType, appId: string) {
  const hasPrefix = appSourceType !== AppSourceType.webApp
  return hasPrefix
    ? `${apiPrefix[appSourceType]}/${appId}/${url.startsWith('/') ? url.slice(1) : url}`
    : url
}

export const stopChatMessageResponding = async (
  appId: string,
  taskId: string,
  appSourceType: AppSourceType,
  installedAppId = '',
  options?: Pick<StreamCallbacks, 'silent'>,
) => {
  if (appSourceType === AppSourceType.installedApp)
    return consoleClient.installedApps.byInstalledAppId.chatMessages.byTaskId.stop.post(
      {
        params: { installed_app_id: installedAppId, task_id: taskId },
      },
      { context: options },
    )
  if (appSourceType === AppSourceType.tryApp)
    return consoleClient.trialApps.byAppId.chatMessages.byTaskId.stop.post(
      {
        params: { app_id: installedAppId, task_id: taskId },
      },
      { context: options },
    )
  return webAppClient.chatMessages.byTaskId.stop.post(
    { params: { task_id: taskId } },
    { context: options },
  )
}

// The app's input form builds these bodies, so they are passed through as the contract bodies.

/** Streams a chat message for a WebApp, installed app or trial app. */
export function chatMessagesSender(appSourceType: AppSourceType, appId: string): StreamSender {
  if (appSourceType === AppSourceType.installedApp)
    return (body, options) =>
      consoleClient.installedApps.byInstalledAppId.chatMessages.post(
        {
          params: { installed_app_id: appId },
          body: body as PostInstalledAppsByInstalledAppIdChatMessagesData['body'],
        },
        options,
      )
  if (appSourceType === AppSourceType.tryApp)
    return (body, options) =>
      consoleClient.trialApps.byAppId.chatMessages.post(
        { params: { app_id: appId }, body: body as PostTrialAppsByAppIdChatMessagesData['body'] },
        options,
      )
  return (body, options) =>
    webAppClient.chatMessages.post({ body: body as PostChatMessagesData['body'] }, options)
}

function completionMessagesSender(appSourceType: AppSourceType, appId: string): StreamSender {
  if (appSourceType === AppSourceType.installedApp)
    return (body, options) =>
      consoleClient.installedApps.byInstalledAppId.completionMessages.post(
        {
          params: { installed_app_id: appId },
          body: body as PostInstalledAppsByInstalledAppIdCompletionMessagesData['body'],
        },
        options,
      )
  if (appSourceType === AppSourceType.tryApp)
    return (body, options) =>
      consoleClient.trialApps.byAppId.completionMessages.post(
        {
          params: { app_id: appId },
          body: body as PostTrialAppsByAppIdCompletionMessagesData['body'],
        },
        options,
      )
  return (body, options) =>
    webAppClient.completionMessages.post(
      { body: body as PostCompletionMessagesData['body'] },
      options,
    )
}

function workflowRunSender(appSourceType: AppSourceType, appId: string): StreamSender {
  if (appSourceType === AppSourceType.installedApp)
    return (body, options) =>
      consoleClient.installedApps.byInstalledAppId.workflows.run.post(
        {
          params: { installed_app_id: appId },
          body: body as PostInstalledAppsByInstalledAppIdWorkflowsRunData['body'],
        },
        options,
      )
  if (appSourceType === AppSourceType.tryApp)
    return (body, options) =>
      consoleClient.trialApps.byAppId.workflows.run.post(
        { params: { app_id: appId }, body: body as PostTrialAppsByAppIdWorkflowsRunData['body'] },
        options,
      )
  return (body, options) =>
    webAppClient.workflows.run.post({ body: body as PostWorkflowsRunData['body'] }, options)
}

export const sendCompletionMessage = async (
  body: Record<string, unknown>,
  {
    onData,
    onCompleted,
    onError,
    onMessageReplace,
    getAbortController,
  }: {
    onData: IOnData
    onCompleted: IOnCompleted
    onError: IOnError
    onMessageReplace: IOnMessageReplace
    getAbortController?: (abortController: AbortController) => void
  },
  appSourceType: AppSourceType,
  installedAppId = '',
) => {
  const send = completionMessagesSender(appSourceType, installedAppId)
  return streamEvents((options) => send({ ...body, response_mode: 'streaming' }, options), {
    onData,
    onCompleted,
    isPublicAPI: getIsPublicAPI(appSourceType),
    onError,
    onMessageReplace,
    getAbortController,
  })
}

export const sendWorkflowMessage = async (
  body: Record<string, unknown>,
  otherOptions: StreamCallbacks,
  appSourceType: AppSourceType,
  appId = '',
) => {
  const send = workflowRunSender(appSourceType, appId)
  return streamEvents((options) => send({ ...body, response_mode: 'streaming' }, options), {
    ...otherOptions,
    isPublicAPI: getIsPublicAPI(appSourceType),
  })
}

export const stopWorkflowMessage = async (
  _appId: string,
  taskId: string,
  appSourceType: AppSourceType,
  installedAppId = '',
  options?: Pick<StreamCallbacks, 'silent'>,
) => {
  if (!taskId) return
  if (appSourceType === AppSourceType.installedApp)
    return consoleClient.installedApps.byInstalledAppId.workflows.tasks.byTaskId.stop.post(
      {
        params: { installed_app_id: installedAppId, task_id: taskId },
      },
      { context: options },
    )
  if (appSourceType === AppSourceType.tryApp)
    return consoleClient.trialApps.byAppId.workflows.tasks.byTaskId.stop.post(
      {
        params: { app_id: installedAppId, task_id: taskId },
      },
      { context: options },
    )
  return webAppClient.workflows.tasks.byTaskId.stop.post(
    { params: { task_id: taskId } },
    { context: options },
  )
}

export const fetchAppInfo = async () => {
  return webAppClient.site.get() as Promise<AppData>
}

const selectConversation = (conversation: SimpleConversation): ConversationItem => ({
  id: conversation.id,
  name: conversation.name,
  inputs: conversation.inputs,
  introduction: conversation.introduction ?? '',
})

export const fetchConversations = async (
  appSourceType: AppSourceType,
  installedAppId = '',
  last_id?: string,
  pinned?: boolean,
  limit?: number,
) => {
  if (appSourceType === AppSourceType.installedApp) {
    const response = await consoleClient.installedApps.byInstalledAppId.conversations.get({
      params: { installed_app_id: installedAppId },
      query: {
        limit: limit || 20,
        ...(last_id ? { last_id } : {}),
        ...(pinned !== undefined ? { pinned } : {}),
      },
    })
    return { ...response, data: response.data.map(selectConversation) }
  }
  if (appSourceType === AppSourceType.webApp)
    return webAppClient.conversations.get({
      query: {
        limit: limit || 20,
        ...(last_id ? { last_id } : {}),
        ...(pinned !== undefined ? { pinned } : {}),
      },
    }) as Promise<AppConversationData>
  return getAction('get', appSourceType)(getUrl('conversations', appSourceType, installedAppId), {
    params: {
      limit: limit || 20,
      ...(last_id ? { last_id } : {}),
      ...(pinned !== undefined ? { pinned } : {}),
    },
  }) as Promise<AppConversationData>
}

export const pinConversation = async (
  appSourceType: AppSourceType,
  installedAppId = '',
  id: string,
) => {
  if (appSourceType === AppSourceType.installedApp)
    return consoleClient.installedApps.byInstalledAppId.conversations.byCId.pin.patch({
      params: { installed_app_id: installedAppId, c_id: id },
    })
  if (appSourceType === AppSourceType.webApp)
    return webAppClient.conversations.byCId.pin.patch({ params: { c_id: id } })
  return getAction(
    'patch',
    appSourceType,
  )(getUrl(`conversations/${id}/pin`, appSourceType, installedAppId))
}

export const unpinConversation = async (
  appSourceType: AppSourceType,
  installedAppId = '',
  id: string,
) => {
  if (appSourceType === AppSourceType.installedApp)
    return consoleClient.installedApps.byInstalledAppId.conversations.byCId.unpin.patch({
      params: { installed_app_id: installedAppId, c_id: id },
    })
  if (appSourceType === AppSourceType.webApp)
    return webAppClient.conversations.byCId.unpin.patch({ params: { c_id: id } })
  return getAction(
    'patch',
    appSourceType,
  )(getUrl(`conversations/${id}/unpin`, appSourceType, installedAppId))
}

export const delConversation = async (
  appSourceType: AppSourceType,
  installedAppId = '',
  id: string,
) => {
  if (appSourceType === AppSourceType.installedApp)
    return consoleClient.installedApps.byInstalledAppId.conversations.byCId.delete({
      params: { installed_app_id: installedAppId, c_id: id },
    })
  if (appSourceType === AppSourceType.webApp)
    return webAppClient.conversations.byCId.delete({ params: { c_id: id } })
  return getAction(
    'del',
    appSourceType,
  )(getUrl(`conversations/${id}`, appSourceType, installedAppId))
}

export const renameConversation = async (
  appSourceType: AppSourceType,
  installedAppId = '',
  id: string,
  name: string,
) => {
  if (appSourceType === AppSourceType.installedApp)
    return consoleClient.installedApps.byInstalledAppId.conversations.byCId.name.post({
      params: { installed_app_id: installedAppId, c_id: id },
      body: { name },
    })
  if (appSourceType === AppSourceType.webApp)
    return webAppClient.conversations.byCId.name.post({ params: { c_id: id }, body: { name } })
  return getAction('post', appSourceType)(
    getUrl(`conversations/${id}/name`, appSourceType, installedAppId),
    { body: { name } },
  )
}

export const generationConversationName = async (
  appSourceType: AppSourceType,
  installedAppId = '',
  id: string,
) => {
  if (appSourceType === AppSourceType.installedApp) {
    const response =
      await consoleClient.installedApps.byInstalledAppId.conversations.byCId.name.post({
        params: { installed_app_id: installedAppId, c_id: id },
        body: { auto_generate: true },
      })
    return selectConversation(response)
  }
  if (appSourceType === AppSourceType.webApp)
    return webAppClient.conversations.byCId.name.post({
      params: { c_id: id },
      body: { auto_generate: true },
    }) as Promise<ConversationItem>
  return getAction('post', appSourceType)(
    getUrl(`conversations/${id}/name`, appSourceType, installedAppId),
    { body: { auto_generate: true } },
  ) as Promise<ConversationItem>
}

export const fetchChatList = async (
  conversationId: string,
  appSourceType: AppSourceType,
  installedAppId = '',
) => {
  if (appSourceType === AppSourceType.installedApp)
    return consoleClient.installedApps.byInstalledAppId.messages.get({
      params: { installed_app_id: installedAppId },
      query: { conversation_id: conversationId, limit: 20 },
    })
  if (appSourceType === AppSourceType.webApp)
    return webAppClient.messages.get({ query: { conversation_id: conversationId, limit: 20 } })
  return getAction('get', appSourceType)(getUrl('messages', appSourceType, installedAppId), {
    params: { conversation_id: conversationId, limit: 20, last_id: '' },
  }) as any
}

// Abandoned API interface
// export const fetchAppVariables = async () => {
//   return get(`variables`)
// }

// init value. wait for server update
export const fetchAppParams = async (appSourceType: AppSourceType, appId = '') => {
  if (appSourceType !== AppSourceType.webApp) {
    const parameters =
      appSourceType === AppSourceType.installedApp
        ? await consoleClient.installedApps.byInstalledAppId.parameters.get({
            params: { installed_app_id: appId },
          })
        : await consoleClient.trialApps.byAppId.parameters.get({ params: { app_id: appId } })
    return selectAppParameters(parameters)
  }
  return webAppClient.parameters.get() as Promise<ChatConfig>
}

export const fetchWebSAMLSSOUrl = async (appCode: string, redirectUrl: string) => {
  return getAction('get', AppSourceType.webApp)(
    getUrl('/enterprise/sso/saml/login', AppSourceType.webApp, ''),
    {
      params: {
        app_code: appCode,
        redirect_url: redirectUrl,
      },
    },
  ) as Promise<{ url: string }>
}

export const fetchWebOIDCSSOUrl = async (appCode: string, redirectUrl: string) => {
  return getAction('get', AppSourceType.webApp)(
    getUrl('/enterprise/sso/oidc/login', AppSourceType.webApp, ''),
    {
      params: {
        app_code: appCode,
        redirect_url: redirectUrl,
      },
    },
  ) as Promise<{ url: string }>
}

export const fetchWebOAuth2SSOUrl = async (appCode: string, redirectUrl: string) => {
  return getAction('get', AppSourceType.webApp)(
    getUrl('/enterprise/sso/oauth2/login', AppSourceType.webApp, ''),
    {
      params: {
        app_code: appCode,
        redirect_url: redirectUrl,
      },
    },
  ) as Promise<{ url: string }>
}

export const fetchMembersSAMLSSOUrl = async (appCode: string, redirectUrl: string) => {
  return getAction('get', AppSourceType.webApp)(
    getUrl('/enterprise/sso/members/saml/login', AppSourceType.webApp, ''),
    {
      params: {
        app_code: appCode,
        redirect_url: redirectUrl,
      },
    },
  ) as Promise<{ url: string }>
}

export const fetchMembersOIDCSSOUrl = async (appCode: string, redirectUrl: string) => {
  return getAction('get', AppSourceType.webApp)(
    getUrl('/enterprise/sso/members/oidc/login', AppSourceType.webApp, ''),
    {
      params: {
        app_code: appCode,
        redirect_url: redirectUrl,
      },
    },
  ) as Promise<{ url: string }>
}

export const fetchMembersOAuth2SSOUrl = async (appCode: string, redirectUrl: string) => {
  return getAction('get', AppSourceType.webApp)(
    getUrl('/enterprise/sso/members/oauth2/login', AppSourceType.webApp, ''),
    {
      params: {
        app_code: appCode,
        redirect_url: redirectUrl,
      },
    },
  ) as Promise<{ url: string }>
}

export const fetchAppMeta = async (appSourceType: AppSourceType, installedAppId = '') => {
  if (appSourceType === AppSourceType.installedApp) {
    const response = await consoleClient.installedApps.byInstalledAppId.meta.get({
      params: { installed_app_id: installedAppId },
    })
    return { tool_icons: response.tool_icons ?? {} }
  }
  if (appSourceType === AppSourceType.webApp) return webAppClient.meta.get() as Promise<AppMeta>
  return getAction(
    'get',
    appSourceType,
  )(getUrl('meta', appSourceType, installedAppId)) as Promise<AppMeta>
}

export const updateFeedback = async (
  { messageId, body }: { messageId: string; body: MessageFeedbackPayload },
  appSourceType: AppSourceType,
  installedAppId = '',
) => {
  if (appSourceType === AppSourceType.installedApp)
    return consoleClient.installedApps.byInstalledAppId.messages.byMessageId.feedbacks.post({
      params: { installed_app_id: installedAppId, message_id: messageId },
      body,
    })
  if (appSourceType === AppSourceType.webApp)
    return webAppClient.messages.byMessageId.feedbacks.post({
      params: { message_id: messageId },
      body,
    })
  return getAction('post', appSourceType)(
    getUrl(`/messages/${messageId}/feedbacks`, appSourceType, installedAppId),
    { body },
  )
}

export const fetchMoreLikeThis = async (
  messageId: string,
  appSourceType: AppSourceType,
  installedAppId = '',
) => {
  if (appSourceType === AppSourceType.installedApp)
    return consoleClient.installedApps.byInstalledAppId.messages.byMessageId.moreLikeThis.get({
      params: { installed_app_id: installedAppId, message_id: messageId },
      query: { response_mode: 'blocking' },
    })
  if (appSourceType === AppSourceType.webApp)
    return webAppClient.messages.byMessageId.moreLikeThis.get({
      params: { message_id: messageId },
      query: { response_mode: 'blocking' },
    })
  return getAction('get', appSourceType)(
    getUrl(`/messages/${messageId}/more-like-this`, appSourceType, installedAppId),
    {
      params: {
        response_mode: 'blocking',
      },
    },
  )
}

export const saveMessage = (
  messageId: string,
  appSourceType: AppSourceType,
  installedAppId = '',
) => {
  if (appSourceType === AppSourceType.installedApp)
    return consoleClient.installedApps.byInstalledAppId.savedMessages.post({
      params: { installed_app_id: installedAppId },
      body: { message_id: messageId },
    })
  return getAction('post', appSourceType)(
    getUrl('/saved-messages', appSourceType, installedAppId),
    { body: { message_id: messageId } },
  )
}

export const fetchSavedMessage = async (appSourceType: AppSourceType, installedAppId = '') => {
  if (appSourceType === AppSourceType.installedApp)
    return consoleClient.installedApps.byInstalledAppId.savedMessages.get(
      {
        params: { installed_app_id: installedAppId },
      },
      { context: { silent: true } },
    )
  if (appSourceType === AppSourceType.webApp)
    return webAppClient.savedMessages.get(undefined, { context: { silent: true } })
  return getAction('get', appSourceType)(
    getUrl('/saved-messages', appSourceType, installedAppId),
    {},
    {
      silent: true,
    },
  )
}

export const removeMessage = (
  messageId: string,
  appSourceType: AppSourceType,
  installedAppId = '',
) => {
  if (appSourceType === AppSourceType.installedApp)
    return consoleClient.installedApps.byInstalledAppId.savedMessages.byMessageId.delete({
      params: { installed_app_id: installedAppId, message_id: messageId },
    })
  if (appSourceType === AppSourceType.webApp)
    return webAppClient.savedMessages.byMessageId.delete({ params: { message_id: messageId } })
  return getAction(
    'del',
    appSourceType,
  )(getUrl(`/saved-messages/${messageId}`, appSourceType, installedAppId))
}

export const fetchSuggestedQuestions = async (
  messageId: string,
  appSourceType: AppSourceType,
  installedAppId = '',
) => {
  if (appSourceType === AppSourceType.installedApp)
    return consoleClient.installedApps.byInstalledAppId.messages.byMessageId.suggestedQuestions.get(
      {
        params: { installed_app_id: installedAppId, message_id: messageId },
      },
    )
  if (appSourceType === AppSourceType.tryApp)
    return consoleClient.trialApps.byAppId.messages.byMessageId.suggestedQuestions.get({
      params: { app_id: installedAppId, message_id: messageId },
    })
  return webAppClient.messages.byMessageId.suggestedQuestions.get({
    params: { message_id: messageId },
  })
}

export const audioToText = (
  appSourceType: AppSourceType,
  appId: string | undefined,
  body: FormData,
  signal?: AbortSignal,
) => {
  if (appSourceType !== AppSourceType.webApp && !appId)
    throw new Error('An app ID is required for console speech-to-text requests.')
  return getAction('post', appSourceType)(
    getUrl('/audio-to-text', appSourceType, appId ?? ''),
    { body, signal },
    { bodyStringify: false, deleteContentType: true },
  ) as Promise<{ text: string }>
}

export const textToAudioStream = (
  url: string,
  appSourceType: AppSourceType,
  body: {
    streaming: boolean
    voice?: string
    message_id?: string
    text?: string | null | undefined
  },
): Promise<Response> => {
  const agentId =
    appSourceType !== AppSourceType.webApp && /^\/agent\/([^/]+)\/text-to-audio$/.exec(url)?.[1]
  if (agentId) {
    return (
      consoleClient.agent.byAgentId.textToAudio
        .post({
          params: { agent_id: agentId },
          body: { ...body, text: body.text ?? '' },
        })
        // The shared player consumes Response streams; generated binary calls return Blobs.
        .then((audio) => new Response(audio))
    )
  }
  return getAction('post', appSourceType)<Response>(url, { body }, { needAllResponseContent: true })
}

type AccessTokenResponse = { access_token: string }

const environmentPassportRequests = new Map<string, Promise<AccessTokenResponse>>()

const requestAccessToken = ({
  userId,
  appCode,
}: {
  userId?: string
  appCode: string
}): Promise<AccessTokenResponse> => {
  const headers: Record<string, string> = { [WEB_APP_SHARE_CODE_HEADER_NAME]: appCode }
  const accessToken = getWebAppAccessToken()
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`
  return webAppClient.passport.get(
    { query: userId ? { user_id: userId } : {} },
    { context: { headers } },
  )
}

export const fetchAccessToken = (params: { userId?: string; appCode: string }) => {
  const address = resolveWebAppAddress()
  if (address?.kind !== 'environment') return requestAccessToken(params)

  const environmentParams = {
    ...params,
    userId: params.userId || getOrCreateWebAppSessionId(address),
  }

  const currentRequest = environmentPassportRequests.get(address.code)
  if (currentRequest) return currentRequest

  const request = requestAccessToken(environmentParams)
  environmentPassportRequests.set(address.code, request)
  const clearRequest = () => {
    if (environmentPassportRequests.get(address.code) === request)
      environmentPassportRequests.delete(address.code)
  }
  request.then(clearRequest, clearRequest)
  return request
}

export const getUserCanAccess = async (appId: string, isInstalledApp: boolean) => {
  if (isInstalledApp)
    return consoleClient.enterprise.webAppAuth.isUserAllowedToAccessWebApp({
      query: { appId },
    })

  return webAppClient.webapp.permission.get({ query: { appId } })
}

export const getAppAccessModeByAppCode = (appCode: string) => {
  return webAppClient.webapp.accessMode.get({ query: { appCode } }) as Promise<{
    accessMode: AccessMode
  }>
}

export const getHumanInputForm = (token: string) => {
  return webAppClient.form.humanInput.byFormToken.get({
    params: { form_token: token },
  }) as Promise<HumanInputFormData>
}

type HumanInputFormUploadTokenResponse = {
  upload_token: string
  expires_at: number
}

type HumanInputFormLocalFileUploadResponse = {
  created_at: number
  created_by: string
  extension: string
  id: string
  mime_type: string
  name: string
  preview_url: string | null
  size: number
  source_url: string
}

type HumanInputFormRemoteFileUploadResponse = {
  created_at: number
  created_by: string
  extension: string
  id: string
  mime_type: string
  name: string
  size: number
  url: string
}

type HumanInputFormLocalFileUploadParams = {
  formToken: string
  file: File
  onProgressCallback: (progress: number) => void
  onSuccessCallback: (res: HumanInputFormLocalFileUploadResponse) => void
  onErrorCallback: (error?: unknown) => void
}

const humanInputFormUploadTokenCache = new Map<string, HumanInputFormUploadTokenResponse>()
const UPLOAD_TOKEN_REFRESH_BUFFER_SECONDS = 30

const getHumanInputFormUploadToken = async (formToken: string) => {
  const cachedToken = humanInputFormUploadTokenCache.get(formToken)
  const now = Math.floor(Date.now() / 1000)

  if (cachedToken && cachedToken.expires_at > now + UPLOAD_TOKEN_REFRESH_BUFFER_SECONDS)
    return cachedToken.upload_token

  const tokenResponse: HumanInputFormUploadTokenResponse =
    await webAppClient.form.humanInput.byFormToken.uploadToken.post({
      params: { form_token: formToken },
    })
  humanInputFormUploadTokenCache.set(formToken, tokenResponse)
  return tokenResponse.upload_token
}

const uploadHumanInputFormFile = async (
  formToken: string,
  formData: FormData,
  onProgress?: (e: ProgressEvent) => void,
) => {
  const scope = captureAppAccessScope()
  const ensureCanUpload = () => {
    if (!isAppAccessScopeCurrent(scope) || hasAppAccessError(scope))
      throw new DOMException('The form upload is no longer active.', 'AbortError')
  }
  ensureCanUpload()

  let uploadToken: string
  try {
    uploadToken = await getHumanInputFormUploadToken(formToken)
  } catch (error) {
    if (!isAppAccessError(error)) ensureCanUpload()
    throw error
  }
  ensureCanUpload()

  return upload(
    {
      xhr: new XMLHttpRequest(),
      data: formData,
      headers: {
        Authorization: `bearer ${uploadToken}`,
      },
      onprogress: onProgress,
    },
    true,
    '/human-input-forms/files',
  )
}

export const uploadHumanInputFormLocalFile = async ({
  formToken,
  file,
  onProgressCallback,
  onSuccessCallback,
  onErrorCallback,
}: HumanInputFormLocalFileUploadParams) => {
  const formData = new FormData()
  formData.append('file', file)

  const onProgress = (e: ProgressEvent) => {
    if (e.lengthComputable) {
      const percent = Math.floor((e.loaded / e.total) * 100)
      onProgressCallback(percent)
    }
  }

  try {
    const response = (await uploadHumanInputFormFile(
      formToken,
      formData,
      onProgress,
    )) as HumanInputFormLocalFileUploadResponse

    onSuccessCallback(response)
  } catch (error) {
    onErrorCallback(error)
  }
}

export const uploadHumanInputFormRemoteFileInfo = async (
  formToken: string,
  url: string,
): Promise<HumanInputFormRemoteFileUploadResponse> => {
  const formData = new FormData()
  formData.append('url', url)

  return uploadHumanInputFormFile(
    formToken,
    formData,
  ) as Promise<HumanInputFormRemoteFileUploadResponse>
}

export const submitHumanInputForm = (
  token: string,
  data: {
    inputs: Record<string, unknown>
    action: string
  },
  formVersion?: WorkflowHumanInputFormData['form_version'],
) => {
  if (formVersion === '2') {
    return webAppClient.form.humanInput.v2.byFormToken.post({
      params: { form_token: token },
      body: zWebAppHumanInputV2SubmitPayload.parse(data),
    })
  }
  return webAppClient.form.humanInput.byFormToken.post({
    params: { form_token: token },
    body: { inputs: data.inputs, action: data.action },
  })
}
