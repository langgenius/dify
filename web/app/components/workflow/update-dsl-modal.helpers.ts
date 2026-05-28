import type { CommonNodeType, Node } from './types'
import { load as yamlLoad } from 'js-yaml'
import { FILE_EXTS } from '@/app/components/base/prompt-editor/constants'
import { DSLImportStatus } from '@/models/app'
import { AppModeEnum } from '@/types/app'
import { BlockEnum, SupportUploadFileTypes } from './types'

type ParsedDSL = {
  workflow?: {
    graph?: {
      nodes?: Array<Node<CommonNodeType>>
    }
  }
}

type WorkflowFileUploadFeatures = {
  enabled?: boolean
  allowed_file_types?: SupportUploadFileTypes[]
  allowed_file_extensions?: string[]
  allowed_file_upload_methods?: string[]
  number_limits?: number
  image?: {
    enabled?: boolean
    number_limits?: number
    transfer_methods?: string[]
  }
}

type WorkflowFeatures = {
  file_upload?: WorkflowFileUploadFeatures
  opening_statement?: string
  suggested_questions?: string[]
  suggested_questions_after_answer?: { enabled: boolean }
  speech_to_text?: { enabled: boolean }
  text_to_speech?: { enabled: boolean }
  retriever_resource?: { enabled: boolean }
  sensitive_word_avoidance?: { enabled: boolean }
}

type ImportNotificationPayload = {
  type: 'success' | 'warning'
  message: string
  children?: string
}

export const getInvalidNodeTypes = (mode?: AppModeEnum) => {
  if (mode === AppModeEnum.ADVANCED_CHAT) {
    return [
      BlockEnum.End,
      BlockEnum.TriggerWebhook,
      BlockEnum.TriggerSchedule,
      BlockEnum.TriggerPlugin,
    ]
  }

  return [BlockEnum.Answer]
}

export const validateDSLContent = (content: string, mode?: AppModeEnum) => {
  try {
    const data = yamlLoad(content) as ParsedDSL
    const nodes = data?.workflow?.graph?.nodes ?? []
    const invalidNodes = getInvalidNodeTypes(mode)
    return !nodes.some((node: Node<CommonNodeType>) => invalidNodes.includes(node?.data?.type))
  }
  catch {
    return false
  }
}

export const isImportCompleted = (status: DSLImportStatus) => {
  return status === DSLImportStatus.COMPLETED || status === DSLImportStatus.COMPLETED_WITH_WARNINGS
}

export const getImportNotificationPayload = (status: DSLImportStatus, t: (key: string, options?: Record<string, unknown>) => string): ImportNotificationPayload => {
  return {
    type: status === DSLImportStatus.COMPLETED ? 'success' : 'warning',
    message: t(status === DSLImportStatus.COMPLETED ? 'common.importSuccess' : 'common.importWarning', { ns: 'workflow' }),
    children: status === DSLImportStatus.COMPLETED_WITH_WARNINGS
      ? t('common.importWarningDetails', { ns: 'workflow' })
      : undefined,
  }
}

export const normalizeWorkflowFeatures = (features: WorkflowFeatures) => {
  return {
    file: {
      image: {
        enabled: !!features.file_upload?.image?.enabled,
        number_limits: features.file_upload?.image?.number_limits || 3,
        transfer_methods: features.file_upload?.image?.transfer_methods || ['local_file', 'remote_url'],
      },
      enabled: !!(features.file_upload?.enabled || features.file_upload?.image?.enabled),
      allowed_file_types: features.file_upload?.allowed_file_types || [SupportUploadFileTypes.image],
      allowed_file_extensions: features.file_upload?.allowed_file_extensions || FILE_EXTS[SupportUploadFileTypes.image]!.map(ext => `.${ext}`),
      allowed_file_upload_methods: features.file_upload?.allowed_file_upload_methods || features.file_upload?.image?.transfer_methods || ['local_file', 'remote_url'],
      number_limits: features.file_upload?.number_limits || features.file_upload?.image?.number_limits || 3,
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
