import type {
  ExploreAppMetaResponse,
  Parameters as InstalledAppParametersResponse,
} from '@dify/contracts/api/console/installed-apps/types.gen'
import type { GetWebAppAccessModeRes } from '@dify/contracts/enterprise/types.gen'
import type { ChatConfig } from '@/app/components/base/chat/types'
import type { AccessMode } from '@/models/access-control'
import type { AppMeta, ToolIcon } from '@/models/share'
import { isAccessMode } from '@/models/access-control'
import { PromptMode } from '@/models/debug'
import { RETRIEVE_TYPE, TtsAutoPlay } from '@/types/app'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const getValue = (source: object, key: string): unknown => Reflect.get(source, key)

const getStringProperty = (source: object, key: string) => {
  const value = getValue(source, key)
  return typeof value === 'string' ? value : ''
}

const getBooleanProperty = (source: object, key: string) => {
  const value = getValue(source, key)
  return typeof value === 'boolean' ? value : false
}

const isTtsAutoPlay = (value: unknown): value is TtsAutoPlay =>
  value === TtsAutoPlay.enabled || value === TtsAutoPlay.disabled

const isUserInputFormItem = (value: unknown): value is ChatConfig['user_input_form'][number] => {
  if (!isRecord(value)) return false

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
  ].some((key) => isRecord(getValue(value, key)))
}

const isModel = (
  value: unknown,
): value is NonNullable<ChatConfig['suggested_questions_after_answer']['model']> => isRecord(value)

const isAnnotationReplyConfig = (
  value: unknown,
): value is NonNullable<ChatConfig['annotation_reply']> => isRecord(value)

const isFileUploadConfig = (value: unknown): value is NonNullable<ChatConfig['file_upload']> =>
  isRecord(value)

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
): ChatConfig['system_parameters'] => ({
  audio_file_size_limit: systemParameters.audio_file_size_limit,
  file_size_limit: systemParameters.file_size_limit,
  image_file_size_limit: systemParameters.image_file_size_limit,
  video_file_size_limit: systemParameters.video_file_size_limit,
  workflow_file_upload_limit: systemParameters.workflow_file_upload_limit,
})

export const toInstalledAppParameters = (response: InstalledAppParametersResponse): ChatConfig => ({
  opening_statement: response.opening_statement ?? '',
  suggested_questions: response.suggested_questions,
  pre_prompt: '',
  prompt_type: PromptMode.simple,
  user_input_form: response.user_input_form.filter(isUserInputFormItem),
  more_like_this: normalizeEnabledConfig(response.more_like_this),
  suggested_questions_after_answer: normalizeSuggestedQuestionsAfterAnswer(
    response.suggested_questions_after_answer,
  ),
  speech_to_text: normalizeEnabledConfig(response.speech_to_text),
  text_to_speech: normalizeTextToSpeech(response.text_to_speech),
  retriever_resource: normalizeEnabledConfig(response.retriever_resource),
  sensitive_word_avoidance: normalizeEnabledConfig(response.sensitive_word_avoidance),
  ...(isAnnotationReplyConfig(response.annotation_reply)
    ? { annotation_reply: response.annotation_reply }
    : {}),
  agent_mode: {
    enabled: false,
    tools: [],
  },
  dataset_configs: defaultDatasetConfigs(),
  ...(isFileUploadConfig(response.file_upload) ? { file_upload: response.file_upload } : {}),
  system_parameters: normalizeSystemParameters(response.system_parameters),
})

export const toInstalledAppMeta = (response: ExploreAppMetaResponse): AppMeta => {
  const toolIcons: Record<string, ToolIcon> = {}

  Object.entries(response.tool_icons ?? {}).forEach(([key, value]) => {
    toolIcons[key] = value
  })

  return { tool_icons: toolIcons }
}

export const toInstalledAppAccessMode = (
  response: GetWebAppAccessModeRes,
): { accessMode: AccessMode } => {
  if (isAccessMode(response.accessMode)) return { accessMode: response.accessMode }

  throw new Error('Web app access mode response returned an unsupported access mode.')
}
