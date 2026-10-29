import type {
  MessageFeedbackPayload,
  SimpleConversation,
} from '@dify/contracts/api/console/installed-apps/types.gen'
import type { IOnCompleted, IOnData, IOnError, IOnMessageReplace, IOtherOptions } from './base'
import type { FormData as HumanInputFormData } from '@/app/(humanInputLayout)/form/[token]/form'
import type { ChatConfig } from '@/app/components/base/chat/types'
import type { AccessMode } from '@/models/access-control'
import type { AppConversationData, AppData, AppMeta, ConversationItem } from '@/models/share'
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
  ssePost,
  upload,
} from './base'
import { resolveWebAppAddress } from './webapp-address'
import { getOrCreateWebAppSessionId, getWebAppAccessToken } from './webapp-auth'

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

export function getUrl(url: string, appSourceType: AppSourceType, appId: string) {
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
) => {
  if (appSourceType === AppSourceType.installedApp)
    return consoleClient.installedApps.byInstalledAppId.chatMessages.byTaskId.stop.post({
      params: { installed_app_id: installedAppId, task_id: taskId },
    })
  if (appSourceType === AppSourceType.tryApp)
    return consoleClient.trialApps.byAppId.chatMessages.byTaskId.stop.post({
      params: { app_id: installedAppId, task_id: taskId },
    })
  return post(getUrl(`chat-messages/${taskId}/stop`, appSourceType, installedAppId))
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
  return ssePost(
    getUrl('completion-messages', appSourceType, installedAppId),
    {
      body: {
        ...body,
        response_mode: 'streaming',
      },
    },
    {
      onData,
      onCompleted,
      isPublicAPI: getIsPublicAPI(appSourceType),
      onError,
      onMessageReplace,
      getAbortController,
    },
  )
}

export const sendWorkflowMessage = async (
  body: Record<string, unknown>,
  otherOptions: IOtherOptions,
  appSourceType: AppSourceType,
  appId = '',
) => {
  return ssePost(
    getUrl('workflows/run', appSourceType, appId),
    {
      body: {
        ...body,
        response_mode: 'streaming',
      },
    },
    {
      ...otherOptions,
      isPublicAPI: getIsPublicAPI(appSourceType),
    },
  )
}

export const stopWorkflowMessage = async (
  _appId: string,
  taskId: string,
  appSourceType: AppSourceType,
  installedAppId = '',
) => {
  if (!taskId) return
  if (appSourceType === AppSourceType.installedApp)
    return consoleClient.installedApps.byInstalledAppId.workflows.tasks.byTaskId.stop.post({
      params: { installed_app_id: installedAppId, task_id: taskId },
    })
  if (appSourceType === AppSourceType.tryApp)
    return consoleClient.trialApps.byAppId.workflows.tasks.byTaskId.stop.post({
      params: { app_id: installedAppId, task_id: taskId },
    })
  return post(getUrl(`workflows/tasks/${taskId}/stop`, appSourceType, installedAppId))
}

export const fetchAppInfo = async () => {
  return get('/site') as Promise<AppData>
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
  return get<ChatConfig>('parameters')
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
  return get(getUrl(`/messages/${messageId}/suggested-questions`, appSourceType, installedAppId))
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

const requestAccessToken = ({ userId, appCode }: { userId?: string; appCode: string }) => {
  const headers = new Headers()
  headers.append(WEB_APP_SHARE_CODE_HEADER_NAME, appCode)
  const accessToken = getWebAppAccessToken()
  if (accessToken) headers.append('Authorization', `Bearer ${accessToken}`)
  const params = new URLSearchParams()
  if (userId) params.append('user_id', userId)
  const url = `/passport?${params.toString()}`
  return get<AccessTokenResponse>(url, { headers }) as Promise<AccessTokenResponse>
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

  return get<{ result: boolean }>(`/webapp/permission?appId=${appId}`)
}

export const getAppAccessModeByAppCode = (appCode: string) => {
  return get<{ accessMode: AccessMode }>(`/webapp/access-mode?appCode=${appCode}`)
}

export const getHumanInputForm = (token: string) => {
  return get<HumanInputFormData>(`/form/human_input/${token}`)
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

  const tokenResponse = await post<HumanInputFormUploadTokenResponse>(
    `/form/human_input/${formToken}/upload-token`,
  )
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
) => {
  return post(`/form/human_input/${token}`, { body: data })
}
