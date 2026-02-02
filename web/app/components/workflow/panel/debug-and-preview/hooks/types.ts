import type { ChatItem, ChatItemInTree } from '@/app/components/base/chat/types'
import type { FileEntity } from '@/app/components/base/file-uploader/types'

export type ChatConfig = {
  opening_statement?: string
  suggested_questions?: string[]
  suggested_questions_after_answer?: {
    enabled?: boolean
  }
  text_to_speech?: unknown
  speech_to_text?: unknown
  retriever_resource?: unknown
  sensitive_word_avoidance?: unknown
  file_upload?: unknown
}

export type GetAbortController = (abortController: AbortController) => void

export type SendCallback = {
  onGetSuggestedQuestions?: (responseItemId: string, getAbortController: GetAbortController) => Promise<unknown>
}

export type SendParams = {
  query: string
  files?: FileEntity[]
  parent_message_id?: string
  inputs?: Record<string, unknown>
  conversation_id?: string
}

export type UpdateCurrentQAParams = {
  parentId?: string
  responseItem: ChatItem
  placeholderQuestionId: string
  questionItem: ChatItem
}

export type ChatTreeUpdater = (updater: (chatTree: ChatItemInTree[]) => ChatItemInTree[]) => void
