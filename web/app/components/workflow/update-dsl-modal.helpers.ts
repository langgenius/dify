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

export const normalizeWorkflowFeatures = (features?: WorkflowFeatures) => {
  const resolvedFeatures = features ?? {}
  return {
    file: {
      image: {
        enabled: !!resolvedFeatures.file_upload?.image?.enabled,
        number_limits: resolvedFeatures.file_upload?.image?.number_limits || 3,
        transfer_methods: resolvedFeatures.file_upload?.image?.transfer_methods || ['local_file', 'remote_url'],
      },
      enabled: !!(resolvedFeatures.file_upload?.enabled || resolvedFeatures.file_upload?.image?.enabled),
      allowed_file_types: resolvedFeatures.file_upload?.allowed_file_types || [SupportUploadFileTypes.image],
      allowed_file_extensions: resolvedFeatures.file_upload?.allowed_file_extensions || FILE_EXTS[SupportUploadFileTypes.image].map(ext => `.${ext}`),
      allowed_file_upload_methods: resolvedFeatures.file_upload?.allowed_file_upload_methods || resolvedFeatures.file_upload?.image?.transfer_methods || ['local_file', 'remote_url'],
      number_limits: resolvedFeatures.file_upload?.number_limits || resolvedFeatures.file_upload?.image?.number_limits || 3,
    },
    opening: {
      enabled: !!resolvedFeatures.opening_statement,
      opening_statement: resolvedFeatures.opening_statement,
      suggested_questions: resolvedFeatures.suggested_questions,
    },
    suggested: resolvedFeatures.suggested_questions_after_answer || { enabled: false },
    speech2text: resolvedFeatures.speech_to_text || { enabled: false },
    text2speech: resolvedFeatures.text_to_speech || { enabled: false },
    citation: resolvedFeatures.retriever_resource || { enabled: false },
    moderation: resolvedFeatures.sensitive_word_avoidance || { enabled: false },
  }
}
