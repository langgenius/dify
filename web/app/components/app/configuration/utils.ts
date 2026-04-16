import type { Features as FeaturesData, FileUpload } from '@/app/components/base/features/types'
import type { Collection } from '@/app/components/tools/types'
import type { BlockStatus, ChatPromptConfig, CompletionPromptConfig, ModelConfig } from '@/models/debug'
import { FILE_EXTS } from '@/app/components/base/prompt-editor/constants'
import { SupportUploadFileTypes } from '@/app/components/workflow/types'
import { AppModeEnum, ModelModeType, Resolution } from '@/types/app'

export const withCollectionIconBasePath = (collectionList: Collection[], prefix?: string) => {
  if (!prefix)
    return collectionList

  return collectionList.map((item) => {
    if (typeof item.icon === 'string' && !item.icon.includes(prefix))
      return { ...item, icon: `${prefix}${item.icon}` }

    return item
  })
}

export const buildConfigurationFeaturesData = (
  modelConfig: ModelConfig,
  fileUploadConfigResponse: FileUpload['fileUploadConfig'],
): FeaturesData => {
  return {
    moreLikeThis: modelConfig.more_like_this || { enabled: false },
    opening: {
      enabled: !!modelConfig.opening_statement,
      opening_statement: modelConfig.opening_statement || '',
      suggested_questions: modelConfig.suggested_questions || [],
    },
    moderation: modelConfig.sensitive_word_avoidance || { enabled: false },
    speech2text: modelConfig.speech_to_text || { enabled: false },
    text2speech: modelConfig.text_to_speech || { enabled: false },
    file: {
      image: {
        detail: modelConfig.file_upload?.image?.detail || Resolution.high,
        enabled: !!modelConfig.file_upload?.image?.enabled,
        number_limits: modelConfig.file_upload?.image?.number_limits || 3,
        transfer_methods: modelConfig.file_upload?.image?.transfer_methods || ['local_file', 'remote_url'],
      },
      enabled: !!(modelConfig.file_upload?.enabled || modelConfig.file_upload?.image?.enabled),
      allowed_file_types: modelConfig.file_upload?.allowed_file_types || [],
      allowed_file_extensions: modelConfig.file_upload?.allowed_file_extensions || [...(FILE_EXTS[SupportUploadFileTypes.image] ?? []), ...(FILE_EXTS[SupportUploadFileTypes.video] ?? [])].map(ext => `.${ext}`),
      allowed_file_upload_methods: modelConfig.file_upload?.allowed_file_upload_methods || modelConfig.file_upload?.image?.transfer_methods || ['local_file', 'remote_url'],
      number_limits: modelConfig.file_upload?.number_limits || modelConfig.file_upload?.image?.number_limits || 3,
      fileUploadConfig: fileUploadConfigResponse,
    } as FileUpload,
    suggested: modelConfig.suggested_questions_after_answer || { enabled: false },
    citation: modelConfig.retriever_resource || { enabled: false },
    annotationReply: modelConfig.annotation_reply || { enabled: false },
  }
}

export const getConfigurationPublishingState = ({
  chatPromptConfig,
  completionPromptConfig,
  hasSetBlockStatus,
  hasSetContextVar,
  hasSelectedDataSets,
  isAdvancedMode,
  mode,
  modelModeType,
  promptTemplate,
}: {
  chatPromptConfig: ChatPromptConfig
  completionPromptConfig: CompletionPromptConfig
  hasSetBlockStatus: BlockStatus
  hasSetContextVar: boolean
  hasSelectedDataSets: boolean
  isAdvancedMode: boolean
  mode: AppModeEnum
  modelModeType: ModelModeType
  promptTemplate: string
}) => {
  const promptEmpty = (() => {
    if (mode !== AppModeEnum.COMPLETION)
      return false

    if (isAdvancedMode) {
      if (modelModeType === ModelModeType.chat)
        return chatPromptConfig.prompt.every(({ text }) => !text)

      return !completionPromptConfig.prompt?.text
    }

    return !promptTemplate
  })()

  const cannotPublish = (() => {
    if (mode !== AppModeEnum.COMPLETION) {
      if (!isAdvancedMode)
        return false

      if (modelModeType === ModelModeType.completion) {
        if (!hasSetBlockStatus.history || !hasSetBlockStatus.query)
          return true
      }

      return false
    }

    return promptEmpty
  })()

  return {
    promptEmpty,
    cannotPublish,
    contextVarEmpty: mode === AppModeEnum.COMPLETION && hasSelectedDataSets && !hasSetContextVar,
  }
}
