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
  Parameters as InstalledAppParametersResponse,
  InstalledAppResponse,
} from '@dify/contracts/api/console/installed-apps/types.gen'
import type { ChatConfig } from '@/app/components/base/chat/types'
import type { Banner } from '@/models/app'
import type { App, AppCategory, InstalledApp } from '@/models/explore'
import type { AppMeta, ToolIcon } from '@/models/share'
import type { AppIconType } from '@/types/app'
import { AccessMode } from '@/models/access-control'
import { PromptMode } from '@/models/debug'
import { RETRIEVE_TYPE, TtsAutoPlay } from '@/types/app'
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
  mode: string
  export_data: string
  can_trial?: boolean | null
}

type InstalledAppsResponse = {
  installed_apps: InstalledApp[]
}

type AppAccessModeResponse = {
  accessMode: AccessMode
}

type InstalledAppParametersViewModel = ChatConfig

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

const getBooleanProperty = (source: object, key: string, fallback = false) => {
  const value = getValue(source, key)
  return typeof value === 'boolean' ? value : fallback
}

const normalizeAppMode = (value: unknown) => {
  return typeof value === 'string' ? value : ''
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
  if (isAccessMode(value))
    return value

  throw new Error('Web app access mode response returned an unsupported access mode.')
}

const normalizeAppIconType = (value: unknown) => {
  return isAppIconType(value) ? value : null
}

const normalizeAppBasicInfo = (
  source: RecommendedAppInfoResponse | InstalledAppInfoResponse | null | undefined,
  fallbackId: string,
): App['app'] => {
  const description = source && 'description' in source && typeof source.description === 'string'
    ? source.description
    : ''
  const useIconAsAnswerIcon = source
    && 'use_icon_as_answer_icon' in source
    && typeof source.use_icon_as_answer_icon === 'boolean'
    ? source.use_icon_as_answer_icon
    : false

  return {
    id: source?.id ?? fallbackId,
    mode: normalizeAppMode(source?.mode),
    icon_type: normalizeAppIconType(source?.icon_type),
    icon: source?.icon ?? '',
    icon_background: source?.icon_background ?? '',
    icon_url: source?.icon_url ?? '',
    name: source?.name ?? '',
    description,
    use_icon_as_answer_icon: useIconAsAnswerIcon,
  }
}

const normalizeRecommendedApp = (app: RecommendedAppResponse): App => {
  return {
    app: normalizeAppBasicInfo(app.app, app.app_id),
    app_id: app.app_id,
    description: app.description ?? '',
    copyright: app.copyright ?? '',
    privacy_policy: app.privacy_policy ?? null,
    custom_disclaimer: app.custom_disclaimer ?? null,
    categories: app.categories ?? [],
    position: app.position ?? 0,
    is_listed: app.is_listed ?? false,
    install_count: 0,
    installed: false,
    editable: false,
    is_agent: false,
    can_trial: app.can_trial ?? false,
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

const normalizeToolIcons = (value: unknown) => {
  const record = isRecord(value) ? value : {}
  const result: Record<string, ToolIcon> = {}

  Object.entries(record).forEach(([key, item]) => {
    if (typeof item === 'string')
      result[key] = item
    else if (isRecord(item))
      result[key] = item
  })

  return result
}

const normalizeAppMeta = (response: ExploreAppMetaResponse): AppMeta => {
  return {
    tool_icons: normalizeToolIcons(response.tool_icons),
  }
}

const isTtsAutoPlay = (value: unknown): value is TtsAutoPlay => {
  return value === TtsAutoPlay.enabled || value === TtsAutoPlay.disabled
}

const isUserInputFormItem = (value: unknown): value is ChatConfig['user_input_form'][number] => {
  if (!isRecord(value))
    return false

  return [
    'text-input',
    'select',
    'paragraph',
    'number',
    'checkbox',
    'file',
    'file-list',
    'external_data_tool',
    'json_object',
  ].some(key => isRecord(getValue(value, key)))
}

const isModel = (value: unknown): value is NonNullable<ChatConfig['suggested_questions_after_answer']['model']> => {
  return isRecord(value)
}

const isAnnotationReplyConfig = (value: unknown): value is NonNullable<ChatConfig['annotation_reply']> => {
  return isRecord(value)
}

const isFileUploadConfig = (value: unknown): value is NonNullable<ChatConfig['file_upload']> => {
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
  const prompt = getStringProperty(record, 'prompt')

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
    voice: getStringProperty(record, 'voice') || undefined,
    language: getStringProperty(record, 'language') || undefined,
    ...(normalizedAutoPlay ? { autoPlay: normalizedAutoPlay } : {}),
  }
}

const normalizeSystemParameters = (
  systemParameters: InstalledAppParametersResponse['system_parameters'],
): ChatConfig['system_parameters'] => {
  return {
    audio_file_size_limit: systemParameters.audio_file_size_limit,
    file_size_limit: systemParameters.file_size_limit,
    image_file_size_limit: systemParameters.image_file_size_limit,
    video_file_size_limit: systemParameters.video_file_size_limit,
    workflow_file_upload_limit: systemParameters.workflow_file_upload_limit,
  }
}

const normalizeInstalledAppParametersViewModel = (
  response: InstalledAppParametersResponse,
): InstalledAppParametersViewModel => {
  return {
    opening_statement: response.opening_statement ?? '',
    suggested_questions: response.suggested_questions,
    pre_prompt: '',
    prompt_type: PromptMode.simple,
    user_input_form: response.user_input_form.filter(isUserInputFormItem),
    more_like_this: normalizeEnabledConfig(response.more_like_this),
    suggested_questions_after_answer: normalizeSuggestedQuestionsAfterAnswer(response.suggested_questions_after_answer),
    speech_to_text: normalizeEnabledConfig(response.speech_to_text),
    text_to_speech: normalizeTextToSpeech(response.text_to_speech),
    retriever_resource: normalizeEnabledConfig(response.retriever_resource),
    sensitive_word_avoidance: normalizeEnabledConfig(response.sensitive_word_avoidance),
    ...(isAnnotationReplyConfig(response.annotation_reply) ? { annotation_reply: response.annotation_reply } : {}),
    agent_mode: {
      enabled: false,
      tools: [],
    },
    dataset_configs: defaultDatasetConfigs(),
    ...(isFileUploadConfig(response.file_upload) ? { file_upload: response.file_upload } : {}),
    system_parameters: normalizeSystemParameters(response.system_parameters),
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
  }).then(normalizeInstalledAppParametersViewModel)
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
