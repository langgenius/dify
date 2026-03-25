import type { CommonNodeType, Node } from './types'
import type {
  AnnotationReplyConfig,
  FileUpload,
  OpeningStatement,
  RetrieverResource,
  Runtime,
  SensitiveWordAvoidance,
  SpeechToText,
  SuggestedQuestionsAfterAnswer,
  TextToSpeech,
} from '@/app/components/base/features/types'
import type { WorkflowDraftFeatures } from '@/types/workflow'
import { load as yamlLoad } from 'js-yaml'
import { FILE_EXTS } from '@/app/components/base/prompt-editor/constants'
import { DSLImportStatus } from '@/models/app'
import { AppModeEnum, TransferMethod } from '@/types/app'
import { BlockEnum, SupportUploadFileTypes } from './types'

type ParsedDSL = {
  workflow?: {
    graph?: {
      nodes?: Array<Node<CommonNodeType>>
    }
  }
}

type ImportNotificationPayload = {
  type: 'success' | 'warning'
  message: string
  children?: string
}

type NormalizedWorkflowFeatures = {
  file: FileUpload
  opening: OpeningStatement
  suggested: SuggestedQuestionsAfterAnswer
  speech2text: SpeechToText
  text2speech: TextToSpeech
  citation: RetrieverResource
  moderation: SensitiveWordAvoidance
  annotationReply: AnnotationReplyConfig
  sandbox: Runtime
}

const DEFAULT_TRANSFER_METHODS: TransferMethod[] = [TransferMethod.local_file, TransferMethod.remote_url]

const normalizeEnabledFeature = (feature?: boolean | Record<string, unknown>) => {
  if (typeof feature === 'boolean')
    return { enabled: feature }

  if (feature && typeof feature === 'object')
    return { enabled: typeof feature.enabled === 'boolean' ? feature.enabled : false }

  return { enabled: false }
}

export const getInvalidNodeTypes = (mode?: AppModeEnum) => {
  if (mode === AppModeEnum.ADVANCED_CHAT) {
    const invalidNodeTypes: BlockEnum[] = [
      BlockEnum.End,
      BlockEnum.TriggerWebhook,
      BlockEnum.TriggerSchedule,
      BlockEnum.TriggerPlugin,
    ]
    return invalidNodeTypes
  }

  const invalidNodeTypes: BlockEnum[] = [BlockEnum.Answer]
  return invalidNodeTypes
}

export const validateDSLContent = (content: string, mode?: AppModeEnum) => {
  try {
    const data = yamlLoad(content) as ParsedDSL
    const nodes = data?.workflow?.graph?.nodes ?? []
    const invalidNodes = getInvalidNodeTypes(mode)
    return !nodes.some((node: Node<CommonNodeType>) => node?.data?.type ? invalidNodes.includes(node.data.type) : false)
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

export const normalizeWorkflowFeatures = (features?: WorkflowDraftFeatures): NormalizedWorkflowFeatures => {
  const resolvedFeatures = features ?? {}
  return {
    file: {
      image: {
        enabled: !!resolvedFeatures.file_upload?.image?.enabled,
        number_limits: resolvedFeatures.file_upload?.image?.number_limits || 3,
        transfer_methods: resolvedFeatures.file_upload?.image?.transfer_methods || DEFAULT_TRANSFER_METHODS,
      },
      enabled: !!(resolvedFeatures.file_upload?.enabled || resolvedFeatures.file_upload?.image?.enabled),
      allowed_file_types: resolvedFeatures.file_upload?.allowed_file_types || [SupportUploadFileTypes.image],
      allowed_file_extensions: resolvedFeatures.file_upload?.allowed_file_extensions || FILE_EXTS[SupportUploadFileTypes.image].map(ext => `.${ext}`),
      allowed_file_upload_methods: resolvedFeatures.file_upload?.allowed_file_upload_methods || resolvedFeatures.file_upload?.image?.transfer_methods || DEFAULT_TRANSFER_METHODS,
      number_limits: resolvedFeatures.file_upload?.number_limits || resolvedFeatures.file_upload?.image?.number_limits || 3,
    },
    opening: {
      enabled: !!resolvedFeatures.opening_statement,
      opening_statement: resolvedFeatures.opening_statement,
      suggested_questions: resolvedFeatures.suggested_questions,
    },
    suggested: normalizeEnabledFeature(resolvedFeatures.suggested_questions_after_answer),
    speech2text: normalizeEnabledFeature(resolvedFeatures.speech_to_text),
    text2speech: normalizeEnabledFeature(resolvedFeatures.text_to_speech),
    citation: normalizeEnabledFeature(resolvedFeatures.retriever_resource),
    moderation: normalizeEnabledFeature(resolvedFeatures.sensitive_word_avoidance),
    annotationReply: normalizeEnabledFeature(resolvedFeatures.annotation_reply),
    sandbox: normalizeEnabledFeature(resolvedFeatures.sandbox),
  }
}
