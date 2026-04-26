import type { Features as FeaturesData } from '@/app/components/base/features/types'
import type { FileUploadConfigResponse } from '@/models/common'
import { FILE_EXTS } from '@/app/components/base/prompt-editor/constants'
import { SupportUploadFileTypes } from '@/app/components/workflow/types'
import { TransferMethod } from '@/types/app'

type TriggerStatusLike = {
  node_id: string
  status: string
}

type FileUploadFeatureLike = {
  enabled?: boolean
  allowed_file_types?: SupportUploadFileTypes[]
  allowed_file_extensions?: string[]
  allowed_file_upload_methods?: TransferMethod[]
  number_limits?: number
  image?: {
    enabled?: boolean
    number_limits?: number
    transfer_methods?: TransferMethod[]
  }
}

type WorkflowFeaturesLike = {
  file_upload?: FileUploadFeatureLike
  opening_statement?: string
  suggested_questions?: string[]
  suggested_questions_after_answer?: { enabled?: boolean }
  speech_to_text?: { enabled?: boolean }
  text_to_speech?: { enabled?: boolean }
  retriever_resource?: { enabled?: boolean }
  sensitive_word_avoidance?: { enabled?: boolean }
}

export const buildTriggerStatusMap = (triggers: TriggerStatusLike[]) => {
  return triggers.reduce<Record<string, 'enabled' | 'disabled'>>((acc, trigger) => {
    acc[trigger.node_id] = trigger.status === 'enabled' ? 'enabled' : 'disabled'
    return acc
  }, {})
}

export const coerceReplayUserInputs = (rawInputs: unknown): Record<string, string | number | boolean> | null => {
  if (!rawInputs || typeof rawInputs !== 'object' || Array.isArray(rawInputs))
    return null

  const userInputs: Record<string, string | number | boolean> = {}

  Object.entries(rawInputs as Record<string, unknown>).forEach(([key, value]) => {
    if (key.startsWith('sys.'))
      return

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
    }
    catch {
      userInputs[key] = String(value)
    }
  })

  return userInputs
}

export const buildInitialFeatures = (
  featuresSource: WorkflowFeaturesLike | null | undefined,
  fileUploadConfigResponse: FileUploadConfigResponse | undefined,
): FeaturesData => {
  const features = featuresSource || {}
  const fileUpload = features.file_upload
  const imageUpload = fileUpload?.image

  return {
    file: {
      image: {
        enabled: !!imageUpload?.enabled,
        number_limits: imageUpload?.number_limits || 3,
        transfer_methods: imageUpload?.transfer_methods || [TransferMethod.local_file, TransferMethod.remote_url],
      },
      enabled: !!(fileUpload?.enabled || imageUpload?.enabled),
      allowed_file_types: fileUpload?.allowed_file_types || [SupportUploadFileTypes.image],
      allowed_file_extensions: fileUpload?.allowed_file_extensions || FILE_EXTS[SupportUploadFileTypes.image]!.map(ext => `.${ext}`),
      allowed_file_upload_methods: fileUpload?.allowed_file_upload_methods || imageUpload?.transfer_methods || [TransferMethod.local_file, TransferMethod.remote_url],
      number_limits: fileUpload?.number_limits || imageUpload?.number_limits || 3,
      fileUploadConfig: fileUploadConfigResponse,
    },
    opening: {
      enabled: !!features.opening_statement,
      opening_statement: features.opening_statement,
      suggested_questions: features.suggested_questions,
    },
    suggested: features.suggested_questions_after_answer || { enabled: false },
    speech2text: features.speech_to_text || { enabled: false },
    text2speech: features.text_to_speech || { enabled: false },
    citation: features.retriever_resource || { enabled: false },
    moderation: features.sensitive_word_avoidance || { enabled: false },
  }
}
