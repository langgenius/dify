import type { AppModelSelectionResponse } from '@dify/contracts/api/console/apps/types.gen'
import type { Features as FeaturesData } from '@/app/components/base/features/types'
import type { FileUploadConfigResponse } from '@/models/common'
import type { AppWorkflowDraftFeatures } from '@/types/workflow'
import { FILE_EXTS } from '@/app/components/base/prompt-editor/constants'
import { SupportUploadFileTypes } from '@/app/components/workflow/types'
import { TransferMethod } from '@/types/app'

type TriggerStatusLike = {
  node_id: string
  status: string
}

const transferMethods = new Set<string>(Object.values(TransferMethod))

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const isJsonValue = (value: unknown): boolean =>
  value === null ||
  typeof value === 'string' ||
  typeof value === 'number' ||
  typeof value === 'boolean' ||
  (Array.isArray(value) && value.every(isJsonValue)) ||
  (isRecord(value) && Object.values(value).every(isJsonValue))

const isAppModelSelection = (value: unknown): value is AppModelSelectionResponse =>
  isRecord(value) &&
  (value.name === undefined || typeof value.name === 'string') &&
  (value.provider === undefined || typeof value.provider === 'string') &&
  (value.mode === undefined ||
    value.mode === '' ||
    value.mode === 'chat' ||
    value.mode === 'completion') &&
  (value.completion_params === undefined ||
    (isRecord(value.completion_params) &&
      Object.values(value.completion_params).every(isJsonValue)))

const toTransferMethods = (methods: string[] | null | undefined): TransferMethod[] | undefined =>
  methods?.filter((method): method is TransferMethod => transferMethods.has(method))

const toEnabled = (feature: { enabled?: boolean | null } | null | undefined): boolean =>
  feature?.enabled === true

const toToggle = (feature: { enabled?: boolean | null } | null | undefined) => ({
  enabled: toEnabled(feature),
})

const toSuggested = (
  feature: AppWorkflowDraftFeatures['suggested_questions_after_answer'],
): NonNullable<FeaturesData['suggested']> => ({
  ...toToggle(feature),
  ...(typeof feature?.prompt === 'string' ? { prompt: feature.prompt } : {}),
  ...(isAppModelSelection(feature?.model) ? { model: feature.model } : {}),
})

const toTextToSpeech = (
  feature: AppWorkflowDraftFeatures['text_to_speech'],
): NonNullable<FeaturesData['text2speech']> => ({
  ...toToggle(feature),
  ...(typeof feature?.language === 'string' ? { language: feature.language } : {}),
  ...(typeof feature?.voice === 'string' ? { voice: feature.voice } : {}),
  ...(feature?.autoPlay === 'enabled' || feature?.autoPlay === 'disabled'
    ? { autoPlay: feature.autoPlay }
    : {}),
})

const toModeration = (
  feature: AppWorkflowDraftFeatures['sensitive_word_avoidance'],
): NonNullable<FeaturesData['moderation']> => ({
  ...toToggle(feature),
  ...(typeof feature?.type === 'string' ? { type: feature.type } : {}),
  ...(isRecord(feature?.config) ? { config: feature.config } : {}),
})

const toAnnotationReply = (
  feature: AppWorkflowDraftFeatures['annotation_reply'],
): NonNullable<FeaturesData['annotationReply']> => {
  const embeddingModel = feature?.embedding_model
  return {
    ...toToggle(feature),
    ...(typeof feature?.id === 'string' ? { id: feature.id } : {}),
    ...(typeof feature?.score_threshold === 'number'
      ? { score_threshold: feature.score_threshold }
      : {}),
    ...(isRecord(embeddingModel) &&
    typeof embeddingModel.embedding_provider_name === 'string' &&
    typeof embeddingModel.embedding_model_name === 'string'
      ? {
          embedding_model: {
            embedding_provider_name: embeddingModel.embedding_provider_name,
            embedding_model_name: embeddingModel.embedding_model_name,
          },
        }
      : {}),
  }
}

export const buildTriggerStatusMap = (triggers: TriggerStatusLike[]) => {
  return triggers.reduce<Record<string, 'enabled' | 'disabled'>>((acc, trigger) => {
    acc[trigger.node_id] = trigger.status === 'enabled' ? 'enabled' : 'disabled'
    return acc
  }, {})
}

export const coerceReplayUserInputs = (
  rawInputs: unknown,
): Record<string, string | number | boolean> | null => {
  if (!rawInputs || typeof rawInputs !== 'object' || Array.isArray(rawInputs)) return null

  const userInputs: Record<string, string | number | boolean> = {}

  Object.entries(rawInputs as Record<string, unknown>).forEach(([key, value]) => {
    if (key.startsWith('sys.')) return

    if (value == null) {
      userInputs[key] = ''
      return
    }

    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      userInputs[key] = value
      return
    }

    try {
      userInputs[key] = JSON.stringify(value)
    } catch {
      userInputs[key] = String(value)
    }
  })

  return userInputs
}

export const buildInitialFeatures = (
  featuresSource: AppWorkflowDraftFeatures | null | undefined,
  fileUploadConfigResponse: FileUploadConfigResponse | undefined,
): FeaturesData => {
  const features = featuresSource || {}
  const fileUpload = features.file_upload
  const imageUpload = fileUpload?.image
  const imageTransferMethods = toTransferMethods(imageUpload?.transfer_methods)

  return {
    file: {
      image: {
        enabled: toEnabled(imageUpload),
        number_limits: imageUpload?.number_limits ?? 3,
        transfer_methods: imageTransferMethods ?? [
          TransferMethod.local_file,
          TransferMethod.remote_url,
        ],
      },
      enabled: toEnabled(fileUpload) || toEnabled(imageUpload),
      allowed_file_types: fileUpload?.allowed_file_types ?? [SupportUploadFileTypes.image],
      allowed_file_extensions:
        fileUpload?.allowed_file_extensions ??
        FILE_EXTS[SupportUploadFileTypes.image]!.map((ext) => `.${ext}`),
      allowed_file_upload_methods: toTransferMethods(fileUpload?.allowed_file_upload_methods) ??
        imageTransferMethods ?? [TransferMethod.local_file, TransferMethod.remote_url],
      number_limits: fileUpload?.number_limits ?? imageUpload?.number_limits ?? 3,
      fileUploadConfig: fileUploadConfigResponse,
    },
    opening: {
      enabled: !!features.opening_statement,
      opening_statement: features.opening_statement ?? undefined,
      suggested_questions: features.suggested_questions ?? undefined,
    },
    suggested: toSuggested(features.suggested_questions_after_answer),
    speech2text: toToggle(features.speech_to_text),
    text2speech: toTextToSpeech(features.text_to_speech),
    citation: toToggle(features.retriever_resource),
    moderation: toModeration(features.sensitive_word_avoidance),
    annotationReply: toAnnotationReply(features.annotation_reply),
  }
}
