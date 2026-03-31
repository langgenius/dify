import type { IChatItem } from '@/app/components/base/chat/chat/type'
import type { WorkflowProcess } from '@/app/components/base/chat/types'
import type { fetchTextGenerationMessage } from '@/service/debug'

export const MAX_GENERATION_ITEM_DEPTH = 3

export const getCurrentTab = (workflowProcessData?: WorkflowProcess) => {
  if (
    workflowProcessData?.resultText
    || !!workflowProcessData?.files?.length
    || !!workflowProcessData?.humanInputFormDataList?.length
    || !!workflowProcessData?.humanInputFilledFormDataList?.length
  ) {
    return 'RESULT'
  }

  return 'DETAIL'
}

export const buildLogItem = ({
  answer,
  data,
  messageId,
}: {
  answer?: string
  data: Awaited<ReturnType<typeof fetchTextGenerationMessage>>
  messageId?: string | null
}): IChatItem => {
  const assistantFiles = data.message_files?.filter(file => file.belongs_to === 'assistant') || []
  const normalizedMessage = typeof data.message === 'string'
    ? { role: 'user', text: data.message }
    : data.message
  const baseLog = Array.isArray(normalizedMessage) ? normalizedMessage : [normalizedMessage]
  const log = Array.isArray(normalizedMessage)
    ? [
        ...normalizedMessage,
        ...(normalizedMessage.length > 0 && normalizedMessage[normalizedMessage.length - 1].role !== 'assistant'
          ? [{
              role: 'assistant',
              text: answer || '',
              files: assistantFiles,
            }]
          : []),
      ]
    : baseLog

  return {
    id: data.id || messageId || '',
    content: answer || '',
    isAnswer: true,
    log,
    message_files: data.message_files,
  }
}

export const getWorkflowTabSignature = (workflowProcessData?: WorkflowProcess) => JSON.stringify({
  filesLength: workflowProcessData?.files?.length ?? 0,
  humanInputFilledFormDataListLength: workflowProcessData?.humanInputFilledFormDataList?.length ?? 0,
  humanInputFormDataListLength: workflowProcessData?.humanInputFormDataList?.length ?? 0,
  resultText: workflowProcessData?.resultText ?? '',
})
