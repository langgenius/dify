import type { WorkflowProcess } from '@/app/components/base/chat/types'

type GenerationTab = 'DETAIL' | 'RESULT'

type PromptLogSource = {
  answer: string
  message: unknown
  message_files?: Array<Record<string, unknown>>
}

type PromptLogAssistantMessage = {
  role: 'assistant'
  text: string
  files: Array<Record<string, unknown>>
}

type PromptLogMessage = {
  role?: string
  text?: string
  files?: Array<Record<string, unknown>>
}

export const MAX_GENERATION_DEPTH = 3

export const shouldShowWorkflowResultTabs = (workflowProcessData?: WorkflowProcess | null) => {
  if (!workflowProcessData)
    return false

  return Boolean(
    workflowProcessData.resultText
    || workflowProcessData.files?.length
    || workflowProcessData.humanInputFormDataList?.length
    || workflowProcessData.humanInputFilledFormDataList?.length,
  )
}

export const getDefaultGenerationTab = (workflowProcessData?: WorkflowProcess | null): GenerationTab => {
  if (shouldShowWorkflowResultTabs(workflowProcessData))
    return 'RESULT'

  return 'DETAIL'
}

const getAssistantFiles = (messageFiles?: Array<Record<string, unknown>>) =>
  messageFiles?.filter(file => file.belongs_to === 'assistant') || []

export const buildPromptLogItem = <T extends PromptLogSource>(data: T): T & { log: PromptLogMessage[] } => {
  if (Array.isArray(data.message)) {
    const messages = data.message as PromptLogMessage[]
    const lastMessage = messages[messages.length - 1]
    const assistantMessage: PromptLogAssistantMessage[] = lastMessage?.role !== 'assistant'
      ? [{
          role: 'assistant',
          text: data.answer,
          files: getAssistantFiles(data.message_files),
        }]
      : []

    return {
      ...data,
      log: [...messages, ...assistantMessage],
    }
  }

  return {
    ...data,
    log: [typeof data.message === 'string'
      ? {
          text: data.message,
        }
      : data.message as PromptLogMessage],
  }
}

export const getGenerationTaskLabel = (taskId: string, depth: number) =>
  depth > 1 ? `${taskId}-${depth - 1}` : taskId

export const getCopyContent = ({
  content,
  isWorkflow,
  workflowProcessData,
}: {
  content: unknown
  isWorkflow?: boolean
  workflowProcessData?: WorkflowProcess
}) => isWorkflow ? workflowProcessData?.resultText : content
