import type {
  BannerListResponse,
  BannerResponse,
  GetExploreAppsLearnDifyResponse,
  GetExploreAppsResponse,
  RecommendedAppDetailResponse,
  RecommendedAppInfoResponse,
  RecommendedAppResponse,
} from '@dify/contracts/api/console/explore/types.gen'
import type {
  ExploreAppMetaResponse,
  InstalledAppInfoResponse,
  InstalledAppListResponse,
  InstalledAppResponse,
  Parameters,
} from '@dify/contracts/api/console/installed-apps/types.gen'
import type { ChatConfig } from '@/app/components/base/chat/types'
import type { Banner } from '@/models/app'
import type { App, AppCategory, InstalledApp } from '@/models/explore'
import type { AppMeta } from '@/models/share'
import type { AppIconType } from '@/types/app'
import { AccessMode } from '@/models/access-control'
import { PromptMode } from '@/models/debug'
import { AppModeEnum, RETRIEVE_TYPE, TtsAutoPlay } from '@/types/app'
import { consoleClient } from './client'

type ExploreAppsResponse = {
  categories: AppCategory[]
  recommended_apps: App[]
}

type LearnDifyAppsResponse = {
  recommended_apps: App[]
}

type ExploreAppDetailResponse = {
  id: string
  name: string
  icon: string
  icon_background: string
  mode: AppModeEnum
  export_data: string
  can_trial?: boolean | null
}

type InstalledAppsResponse = {
  installed_apps: InstalledApp[]
}

type AppAccessModeResponse = {
  accessMode: AccessMode
}

type InstalledAppParameters = Parameters

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const getValue = (source: object, key: string): unknown => {
  return Reflect.get(source, key)
}

const getStringProperty = (source: object, key: string, fallback = '') => {
  const value = getValue(source, key)
  return typeof value === 'string' ? value : fallback
}

const getOptionalStringProperty = (source: object, key: string) => {
  const value = getValue(source, key)
  return typeof value === 'string' ? value : undefined
}

const getNullableStringProperty = (source: object, key: string) => {
  const value = getValue(source, key)
  return typeof value === 'string' ? value : null
}

const getBooleanProperty = (source: object, key: string, fallback = false) => {
  const value = getValue(source, key)
  return typeof value === 'boolean' ? value : fallback
}

const getOptionalBooleanProperty = (source: object, key: string) => {
  const value = getValue(source, key)
  return typeof value === 'boolean' ? value : undefined
}

const getNumberProperty = (source: object, key: string, fallback = 0) => {
  const value = getValue(source, key)
  return typeof value === 'number' ? value : fallback
}

const getOptionalNumberProperty = (source: object, key: string) => {
  const value = getValue(source, key)
  return typeof value === 'number' ? value : undefined
}

const getStringArrayProperty = (source: object, key: string) => {
  const value = getValue(source, key)
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

const getArrayProperty = <T>(
  source: object,
  key: string,
  isItem: (value: unknown) => value is T,
) => {
  const value = getValue(source, key)
  return Array.isArray(value) ? value.filter(isItem) : []
}

const getOptionalArrayProperty = <T>(
  source: object,
  key: string,
  isItem: (value: unknown) => value is T,
) => {
  const value = getValue(source, key)
  return Array.isArray(value) ? value.filter(isItem) : undefined
}

const isAppMode = (value: unknown): value is AppModeEnum => {
  return value === AppModeEnum.COMPLETION
    || value === AppModeEnum.WORKFLOW
    || value === AppModeEnum.CHAT
    || value === AppModeEnum.ADVANCED_CHAT
    || value === AppModeEnum.AGENT_CHAT
}

const normalizeAppMode = (value: unknown) => {
  return isAppMode(value) ? value : AppModeEnum.CHAT
}

const isAppIconType = (value: unknown): value is AppIconType => {
  return value === 'image' || value === 'emoji' || value === 'link'
}

const isAccessMode = (value: unknown): value is AccessMode => {
  return value === AccessMode.PUBLIC
    || value === AccessMode.SPECIFIC_GROUPS_MEMBERS
    || value === AccessMode.ORGANIZATION
    || value === AccessMode.EXTERNAL_MEMBERS
}

const normalizeAccessMode = (value: unknown) => {
  return isAccessMode(value) ? value : AccessMode.PUBLIC
}

const normalizeAppIconType = (value: unknown) => {
  return isAppIconType(value) ? value : null
}

const normalizeAppBasicInfo = (
  source: RecommendedAppInfoResponse | InstalledAppInfoResponse | null | undefined,
  fallbackId: string,
): App['app'] => {
  const record = source && isRecord(source) ? source : null

  return {
    id: record ? getStringProperty(record, 'id', fallbackId) : fallbackId,
    mode: record ? normalizeAppMode(getValue(record, 'mode')) : AppModeEnum.CHAT,
    icon_type: record ? normalizeAppIconType(getValue(record, 'icon_type')) : null,
    icon: record ? getStringProperty(record, 'icon') : '',
    icon_background: record ? getStringProperty(record, 'icon_background') : '',
    icon_url: record ? getStringProperty(record, 'icon_url') : '',
    name: record ? getStringProperty(record, 'name') : '',
    description: record ? getStringProperty(record, 'description') : '',
    use_icon_as_answer_icon: record ? getBooleanProperty(record, 'use_icon_as_answer_icon') : false,
  }
}

const normalizeRecommendedApp = (app: RecommendedAppResponse): App => {
  return {
    app: normalizeAppBasicInfo(app.app, app.app_id),
    app_id: app.app_id,
    description: getStringProperty(app, 'description'),
    copyright: getStringProperty(app, 'copyright'),
    privacy_policy: getNullableStringProperty(app, 'privacy_policy'),
    custom_disclaimer: getNullableStringProperty(app, 'custom_disclaimer'),
    categories: getStringArrayProperty(app, 'categories'),
    position: getNumberProperty(app, 'position'),
    is_listed: getBooleanProperty(app, 'is_listed'),
    install_count: getNumberProperty(app, 'install_count'),
    installed: getBooleanProperty(app, 'installed'),
    editable: getBooleanProperty(app, 'editable'),
    is_agent: getBooleanProperty(app, 'is_agent'),
    can_trial: getBooleanProperty(app, 'can_trial'),
  }
}

const normalizeExploreAppsResponse = (response: GetExploreAppsResponse): ExploreAppsResponse => {
  return {
    categories: response.categories,
    recommended_apps: response.recommended_apps.map(normalizeRecommendedApp),
  }
}

const normalizeLearnDifyAppsResponse = (response: GetExploreAppsLearnDifyResponse): LearnDifyAppsResponse => {
  return {
    recommended_apps: response.recommended_apps.map(normalizeRecommendedApp),
  }
}

const normalizeAppDetail = (response: RecommendedAppDetailResponse): ExploreAppDetailResponse => {
  return {
    id: response.id,
    name: response.name,
    icon: response.icon ?? '',
    icon_background: response.icon_background ?? '',
    mode: normalizeAppMode(response.mode),
    export_data: response.export_data,
    can_trial: response.can_trial,
  }
}

const normalizeInstalledApp = (installedApp: InstalledAppResponse): InstalledApp => {
  return {
    app: normalizeAppBasicInfo(installedApp.app, installedApp.app.id),
    id: installedApp.id,
    uninstallable: installedApp.uninstallable,
    is_pinned: installedApp.is_pinned,
  }
}

const normalizeInstalledAppsResponse = (response: InstalledAppListResponse): InstalledAppsResponse => {
  return {
    installed_apps: response.installed_apps.map(normalizeInstalledApp),
  }
}

const normalizeBannerContent = (content: unknown): Banner['content'] => {
  const record = isRecord(content) ? content : {}

  return {
    'category': getStringProperty(record, 'category'),
    'title': getStringProperty(record, 'title'),
    'description': getStringProperty(record, 'description'),
    'img-src': getStringProperty(record, 'img-src'),
  }
}

const normalizeBanner = (banner: BannerResponse): Banner => {
  return {
    id: banner.id,
    content: normalizeBannerContent(banner.content),
    link: banner.link ?? '',
    sort: banner.sort,
    status: banner.status,
    created_at: banner.created_at ?? '',
  }
}

const normalizeBannersResponse = (response: BannerListResponse): Banner[] => {
  return response.map(normalizeBanner)
}

const normalizeStringRecord = (value: unknown) => {
  const record = isRecord(value) ? value : {}
  const result: Record<string, string> = {}

  Object.entries(record).forEach(([key, item]) => {
    if (typeof item === 'string')
      result[key] = item
  })

  return result
}

const normalizeAppMeta = (response: ExploreAppMetaResponse): AppMeta => {
  return {
    tool_icons: normalizeStringRecord(response.tool_icons),
  }
}

const isPromptMode = (value: unknown): value is PromptMode => {
  return value === PromptMode.simple || value === PromptMode.advanced
}

const normalizePromptMode = (value: unknown) => {
  return isPromptMode(value) ? value : PromptMode.simple
}

const isTtsAutoPlay = (value: unknown): value is TtsAutoPlay => {
  return value === TtsAutoPlay.enabled || value === TtsAutoPlay.disabled
}

const isChatPromptConfig = (value: unknown): value is NonNullable<ChatConfig['chat_prompt_config']> => {
  return isRecord(value)
}

const isCompletionPromptConfig = (value: unknown): value is NonNullable<ChatConfig['completion_prompt_config']> => {
  return isRecord(value)
}

const isUserInputFormItem = (value: unknown): value is ChatConfig['user_input_form'][number] => {
  return isRecord(value)
}

const isModel = (value: unknown): value is NonNullable<ChatConfig['suggested_questions_after_answer']['model']> => {
  return isRecord(value)
}

const isAnnotationReplyConfig = (value: unknown): value is NonNullable<ChatConfig['annotation_reply']> => {
  return isRecord(value)
}

const isToolItem = (value: unknown): value is ChatConfig['agent_mode']['tools'][number] => {
  return isRecord(value)
}

const isExternalDataTool = (value: unknown): value is NonNullable<ChatConfig['external_data_tools']>[number] => {
  return isRecord(value)
}

const isDatasetConfigs = (value: unknown): value is ChatConfig['dataset_configs'] => {
  return isRecord(value)
}

const isFileUploadConfig = (value: unknown): value is NonNullable<ChatConfig['file_upload']> => {
  return isRecord(value)
}

const isVisionFile = (value: unknown): value is NonNullable<ChatConfig['files']>[number] => {
  return isRecord(value)
}

const defaultDatasetConfigs = (): ChatConfig['dataset_configs'] => ({
  retrieval_model: RETRIEVE_TYPE.oneWay,
  reranking_model: {
    reranking_provider_name: '',
    reranking_model_name: '',
  },
  top_k: 4,
  score_threshold_enabled: false,
  score_threshold: null,
  datasets: {
    datasets: [],
  },
})

const normalizeEnabledConfig = (value: unknown): { enabled: boolean } => {
  const record = isRecord(value) ? value : {}

  return {
    ...record,
    enabled: getBooleanProperty(record, 'enabled'),
  }
}

const normalizeSuggestedQuestionsAfterAnswer = (
  value: unknown,
): ChatConfig['suggested_questions_after_answer'] => {
  const record = isRecord(value) ? value : {}
  const model = getValue(record, 'model')
  const prompt = getOptionalStringProperty(record, 'prompt')

  return {
    enabled: getBooleanProperty(record, 'enabled'),
    ...(isModel(model) ? { model } : {}),
    ...(prompt ? { prompt } : {}),
  }
}

const normalizeTextToSpeech = (value: unknown): ChatConfig['text_to_speech'] => {
  const record = isRecord(value) ? value : {}
  const autoPlay = getValue(record, 'autoPlay')
  const normalizedAutoPlay = isTtsAutoPlay(autoPlay) ? autoPlay : undefined

  return {
    ...record,
    enabled: getBooleanProperty(record, 'enabled'),
    voice: getOptionalStringProperty(record, 'voice'),
    language: getOptionalStringProperty(record, 'language'),
    ...(normalizedAutoPlay ? { autoPlay: normalizedAutoPlay } : {}),
  }
}

const normalizeAgentMode = (value: unknown): ChatConfig['agent_mode'] => {
  const record = isRecord(value) ? value : {}

  return {
    ...record,
    enabled: getBooleanProperty(record, 'enabled'),
    tools: getArrayProperty(record, 'tools', isToolItem),
  }
}

const normalizeSystemParameters = (
  systemParameters: InstalledAppParameters['system_parameters'],
): ChatConfig['system_parameters'] => {
  return {
    audio_file_size_limit: systemParameters.audio_file_size_limit,
    file_size_limit: systemParameters.file_size_limit,
    image_file_size_limit: systemParameters.image_file_size_limit,
    video_file_size_limit: systemParameters.video_file_size_limit,
    workflow_file_upload_limit: systemParameters.workflow_file_upload_limit,
  }
}

const normalizeInstalledAppParameters = (response: InstalledAppParameters): ChatConfig => {
  const chatPromptConfig = getValue(response, 'chat_prompt_config')
  const completionPromptConfig = getValue(response, 'completion_prompt_config')
  const annotationReply = getValue(response, 'annotation_reply')
  const datasetConfigs = getValue(response, 'dataset_configs')
  const fileUpload = getValue(response, 'file_upload')
  const suggestedQuestions = getStringArrayProperty(response, 'suggested_questions')
  const datasetQueryVariable = getOptionalStringProperty(response, 'dataset_query_variable')
  const createdAt = getOptionalNumberProperty(response, 'created_at')
  const updatedAt = getOptionalNumberProperty(response, 'updated_at')
  const externalDataTools = getOptionalArrayProperty(response, 'external_data_tools', isExternalDataTool)
  const files = getOptionalArrayProperty(response, 'files', isVisionFile)
  const supportAnnotation = getOptionalBooleanProperty(response, 'supportAnnotation')
  const questionEditEnable = getOptionalBooleanProperty(response, 'questionEditEnable')
  const supportFeedback = getOptionalBooleanProperty(response, 'supportFeedback')
  const supportCitationHitInfo = getOptionalBooleanProperty(response, 'supportCitationHitInfo')
  const appId = getOptionalStringProperty(response, 'appId')

  return {
    opening_statement: response.opening_statement ?? '',
    suggested_questions: suggestedQuestions,
    pre_prompt: getStringProperty(response, 'pre_prompt'),
    prompt_type: normalizePromptMode(getValue(response, 'prompt_type')),
    ...(isChatPromptConfig(chatPromptConfig) ? { chat_prompt_config: chatPromptConfig } : {}),
    ...(isCompletionPromptConfig(completionPromptConfig) ? { completion_prompt_config: completionPromptConfig } : {}),
    user_input_form: getArrayProperty(response, 'user_input_form', isUserInputFormItem),
    ...(datasetQueryVariable ? { dataset_query_variable: datasetQueryVariable } : {}),
    more_like_this: normalizeEnabledConfig(response.more_like_this),
    suggested_questions_after_answer: normalizeSuggestedQuestionsAfterAnswer(response.suggested_questions_after_answer),
    speech_to_text: normalizeEnabledConfig(response.speech_to_text),
    text_to_speech: normalizeTextToSpeech(response.text_to_speech),
    retriever_resource: normalizeEnabledConfig(response.retriever_resource),
    sensitive_word_avoidance: normalizeEnabledConfig(response.sensitive_word_avoidance),
    ...(isAnnotationReplyConfig(annotationReply) ? { annotation_reply: annotationReply } : {}),
    agent_mode: normalizeAgentMode(getValue(response, 'agent_mode')),
    ...(externalDataTools ? { external_data_tools: externalDataTools } : {}),
    dataset_configs: isDatasetConfigs(datasetConfigs) ? datasetConfigs : defaultDatasetConfigs(),
    ...(isFileUploadConfig(fileUpload) ? { file_upload: fileUpload } : {}),
    ...(files ? { files } : {}),
    system_parameters: normalizeSystemParameters(response.system_parameters),
    ...(createdAt !== undefined ? { created_at: createdAt } : {}),
    ...(updatedAt !== undefined ? { updated_at: updatedAt } : {}),
    ...(supportAnnotation !== undefined ? { supportAnnotation } : {}),
    ...(questionEditEnable !== undefined ? { questionEditEnable } : {}),
    ...(supportFeedback !== undefined ? { supportFeedback } : {}),
    ...(supportCitationHitInfo !== undefined ? { supportCitationHitInfo } : {}),
    ...(appId ? { appId } : {}),
  }
}

export const fetchAppList = (language?: string) => {
  if (!language)
    return consoleClient.explore.apps.get({}).then(normalizeExploreAppsResponse)

  return consoleClient.explore.apps.get({
    query: { language },
  }).then(normalizeExploreAppsResponse)
}

export const fetchLearnDifyAppList = (language?: string) => {
  if (!language)
    return consoleClient.explore.apps.learnDify.get({}).then(normalizeLearnDifyAppsResponse)

  return consoleClient.explore.apps.learnDify.get({
    query: { language },
  }).then(normalizeLearnDifyAppsResponse)
}

export const fetchAppDetail = async (id: string): Promise<ExploreAppDetailResponse> => {
  const response = await consoleClient.explore.apps.byAppId.get({
    params: { app_id: id },
  })
  if (!response)
    throw new Error('Recommended app not found')
  return normalizeAppDetail(response)
}

export const fetchInstalledAppList = (appId?: string | null) => {
  if (!appId)
    return consoleClient.installedApps.get({}).then(normalizeInstalledAppsResponse)

  return consoleClient.installedApps.get({
    query: { app_id: appId },
  }).then(normalizeInstalledAppsResponse)
}

export const uninstallApp = (id: string) => {
  return consoleClient.installedApps.byInstalledAppId.delete({
    params: { installed_app_id: id },
  })
}

export const updatePinStatus = (id: string, isPinned: boolean) => {
  return consoleClient.installedApps.byInstalledAppId.patch({
    params: { installed_app_id: id },
    body: {
      is_pinned: isPinned,
    },
  })
}

export const getAppAccessModeByAppId = (appId: string) => {
  return consoleClient.enterprise.webAppAuth.getWebAppAccessMode({
    query: { appId },
  }).then((response): AppAccessModeResponse => ({
    accessMode: normalizeAccessMode(isRecord(response) ? getValue(response, 'accessMode') : undefined),
  }))
}

export const fetchInstalledAppParams = (appId: string) => {
  return consoleClient.installedApps.byInstalledAppId.parameters.get({
    params: { installed_app_id: appId },
  }).then(normalizeInstalledAppParameters)
}

export const fetchInstalledAppMeta = (appId: string) => {
  return consoleClient.installedApps.byInstalledAppId.meta.get({
    params: { installed_app_id: appId },
  }).then(normalizeAppMeta)
}

export const fetchBanners = (language?: string) => {
  if (!language)
    return consoleClient.explore.banners.get({}).then(normalizeBannersResponse)

  return consoleClient.explore.banners.get({
    query: { language },
  }).then(normalizeBannersResponse)
}
