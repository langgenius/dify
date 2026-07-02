import type { ChatConfig } from '@/app/components/base/chat/types'
import { SupportUploadFileTypes } from '@/app/components/workflow/types'
import { ANNOTATION_DEFAULT, DEFAULT_AGENT_SETTING } from '@/config'
import { PromptMode } from '@/models/debug'
import { consoleClient } from '@/service/client'
import { Resolution, RETRIEVE_TYPE, TransferMethod, TtsAutoPlay } from '@/types/app'

type TryAppParameters = import('@dify/contracts/api/console/trial-apps/types.gen').Parameters

const transferMethodValues = new Set<string>(Object.values(TransferMethod))
const supportUploadFileTypeValues = new Set<string>(Object.values(SupportUploadFileTypes))

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const getString = (value: unknown, fallback = '') => {
  return typeof value === 'string' ? value : fallback
}

const getOptionalString = (value: unknown) => {
  return typeof value === 'string' ? value : undefined
}

const getBoolean = (value: unknown, fallback = false) => {
  return typeof value === 'boolean' ? value : fallback
}

const getNumber = (value: unknown, fallback: number) => {
  return typeof value === 'number' ? value : fallback
}

const getStringArray = (value: unknown) => {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

const getStringRecord = (value: unknown) => {
  if (!isRecord(value))
    return undefined

  const record: Record<string, string | undefined> = {}
  Object.entries(value).forEach(([key, item]) => {
    if (typeof item === 'string')
      record[key] = item
  })
  return record
}

const normalizeEnabledConfig = (value: Record<string, unknown>, fallback = false) => {
  return {
    ...value,
    enabled: getBoolean(value.enabled, fallback),
  }
}

const normalizeTextToSpeechConfig = (value: Record<string, unknown>): ChatConfig['text_to_speech'] => {
  const autoPlay = getString(value.autoPlay)
  const config = { ...value }
  delete config.autoPlay
  return {
    ...normalizeEnabledConfig(config),
    voice: getOptionalString(value.voice),
    language: getOptionalString(value.language),
    ...(autoPlay === TtsAutoPlay.enabled || autoPlay === TtsAutoPlay.disabled ? { autoPlay } : {}),
  }
}

const normalizeAnnotationReplyConfig = (value: Record<string, unknown>): ChatConfig['annotation_reply'] => {
  const embeddingModel = isRecord(value.embedding_model) ? value.embedding_model : {}
  return {
    id: getString(value.id),
    enabled: getBoolean(value.enabled),
    score_threshold: getNumber(value.score_threshold, ANNOTATION_DEFAULT.score_threshold),
    embedding_model: {
      embedding_provider_name: getString(embeddingModel.embedding_provider_name),
      embedding_model_name: getString(embeddingModel.embedding_model_name),
    },
  }
}

const getTransferMethods = (value: unknown, fallback: TransferMethod[]) => {
  if (!Array.isArray(value))
    return fallback

  const methods = value.filter((item): item is TransferMethod => {
    return typeof item === 'string' && transferMethodValues.has(item)
  })
  return methods.length > 0 ? methods : fallback
}

const getSupportUploadFileTypes = (value: unknown): SupportUploadFileTypes[] => {
  if (!Array.isArray(value))
    return []

  return value.filter((item): item is SupportUploadFileTypes => {
    return typeof item === 'string' && supportUploadFileTypeValues.has(item)
  })
}

const normalizeVisionSettings = (value: unknown): NonNullable<ChatConfig['file_upload']>['image'] => {
  const image = isRecord(value) ? value : {}
  return {
    enabled: getBoolean(image.enabled),
    number_limits: getNumber(image.number_limits, 3),
    detail: getString(image.detail) === Resolution.low ? Resolution.low : Resolution.high,
    transfer_methods: getTransferMethods(image.transfer_methods, [TransferMethod.local_file, TransferMethod.remote_url]),
  }
}

const normalizeFileUploadConfig = (value: Record<string, unknown>): ChatConfig['file_upload'] => {
  const allowedUploadMethods = getTransferMethods(value.allowed_upload_methods, [TransferMethod.local_file, TransferMethod.remote_url])
  const allowedFileUploadMethods = getTransferMethods(value.allowed_file_upload_methods, allowedUploadMethods)

  return {
    image: normalizeVisionSettings(value.image),
    allowed_file_upload_methods: allowedFileUploadMethods,
    allowed_upload_methods: allowedUploadMethods,
    allowed_file_types: getSupportUploadFileTypes(value.allowed_file_types),
    allowed_file_extensions: getStringArray(value.allowed_file_extensions),
    max_length: getNumber(value.max_length, 1),
    number_limits: getNumber(value.number_limits, 1),
  }
}

const defaultDatasetConfigs: ChatConfig['dataset_configs'] = {
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
}

const normalizeBaseInputForm = (value: Record<string, unknown>) => {
  return {
    default: getString(value.default),
    label: getString(value.label),
    variable: getString(value.variable),
    required: getBoolean(value.required, true),
    hide: getBoolean(value.hide),
  }
}

const normalizeTextInputForm = (value: Record<string, unknown>) => {
  return {
    ...normalizeBaseInputForm(value),
    max_length: getNumber(value.max_length, 0),
  }
}

const normalizeFileInputForm = (value: Record<string, unknown>) => {
  return {
    ...normalizeBaseInputForm(value),
    max_length: getNumber(value.max_length, 1),
    allowed_file_upload_methods: getTransferMethods(value.allowed_file_upload_methods, [
      TransferMethod.local_file,
      TransferMethod.remote_url,
    ]),
    allowed_upload_methods: getTransferMethods(value.allowed_upload_methods, [
      TransferMethod.local_file,
      TransferMethod.remote_url,
    ]),
    allowed_file_types: getSupportUploadFileTypes(value.allowed_file_types),
    allowed_file_extensions: getStringArray(value.allowed_file_extensions),
  }
}

const normalizeUserInputFormItem = (item: Record<string, unknown>): ChatConfig['user_input_form'][number] | null => {
  if (isRecord(item['text-input']))
    return { 'text-input': normalizeTextInputForm(item['text-input']) }

  if (isRecord(item.paragraph))
    return { paragraph: normalizeTextInputForm(item.paragraph) }

  if (isRecord(item.select)) {
    return {
      select: {
        ...normalizeBaseInputForm(item.select),
        options: getStringArray(item.select.options),
      },
    }
  }

  if (isRecord(item.number)) {
    return {
      number: {
        ...normalizeBaseInputForm(item.number),
        max_length: getNumber(item.number.max_length, 0),
      },
    }
  }

  if (isRecord(item.checkbox)) {
    return {
      checkbox: {
        ...normalizeBaseInputForm(item.checkbox),
        default: getBoolean(item.checkbox.default),
      },
    }
  }

  if (isRecord(item.file))
    return { file: normalizeFileInputForm(item.file) }

  if (isRecord(item['file-list']))
    return { 'file-list': normalizeFileInputForm(item['file-list']) }

  if (isRecord(item.external_data_tool)) {
    return {
      external_data_tool: {
        label: getString(item.external_data_tool.label),
        variable: getString(item.external_data_tool.variable),
        required: getBoolean(item.external_data_tool.required, true),
        hide: getBoolean(item.external_data_tool.hide),
        type: getOptionalString(item.external_data_tool.type),
        enabled: getBoolean(item.external_data_tool.enabled),
        icon: getOptionalString(item.external_data_tool.icon),
        icon_background: getOptionalString(item.external_data_tool.icon_background),
        config: getStringRecord(item.external_data_tool.config),
      },
    }
  }

  if (isRecord(item.json_object)) {
    const jsonSchema = item.json_object.json_schema
    return {
      json_object: {
        ...normalizeBaseInputForm(item.json_object),
        json_schema: typeof jsonSchema === 'string' || isRecord(jsonSchema) ? jsonSchema : undefined,
      },
    }
  }

  return null
}

const normalizeUserInputForm = (items: TryAppParameters['user_input_form']): ChatConfig['user_input_form'] => {
  return items.reduce<ChatConfig['user_input_form']>((result, item) => {
    const normalized = normalizeUserInputFormItem(item)
    if (normalized)
      result.push(normalized)
    return result
  }, [])
}

const normalizeTryAppParams = (params: TryAppParameters): ChatConfig => {
  return {
    opening_statement: params.opening_statement ?? '',
    suggested_questions: params.suggested_questions,
    suggested_questions_after_answer: normalizeEnabledConfig(params.suggested_questions_after_answer),
    speech_to_text: normalizeEnabledConfig(params.speech_to_text),
    text_to_speech: normalizeTextToSpeechConfig(params.text_to_speech),
    retriever_resource: normalizeEnabledConfig(params.retriever_resource),
    annotation_reply: normalizeAnnotationReplyConfig(params.annotation_reply),
    more_like_this: normalizeEnabledConfig(params.more_like_this),
    sensitive_word_avoidance: normalizeEnabledConfig(params.sensitive_word_avoidance),
    file_upload: normalizeFileUploadConfig(params.file_upload),
    user_input_form: normalizeUserInputForm(params.user_input_form),
    system_parameters: params.system_parameters,
    pre_prompt: '',
    prompt_type: PromptMode.simple,
    agent_mode: DEFAULT_AGENT_SETTING,
    dataset_configs: defaultDatasetConfigs,
  }
}

export const fetchTryAppInfo = (appId: string) => {
  return consoleClient.trialApps.byAppId.get({ params: { app_id: appId } })
}

export const fetchTryAppDatasets = (appId: string, ids: string[]) => {
  return consoleClient.trialApps.byAppId.datasets.get({
    params: { app_id: appId },
    query: { ids },
  })
}

export const fetchTryAppFlowPreview = (appId: string) => {
  return consoleClient.trialApps.byAppId.workflows.get({ params: { app_id: appId } })
}

export const fetchTryAppParams = (appId: string) => {
  return consoleClient.trialApps.byAppId.parameters.get({ params: { app_id: appId } })
    .then(normalizeTryAppParams)
}

export type TryAppInfo = Awaited<ReturnType<typeof fetchTryAppInfo>>
