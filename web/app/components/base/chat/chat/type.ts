import type { TypeWithI18N } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { Annotation, MessageRating } from '@/models/log'
import type { FileEntity } from '@/app/components/base/file-uploader/types'
import type { InputVarType } from '@/app/components/workflow/types'
import type { FileResponse } from '@/types/workflow'

export interface MessageMore {
  time: string
  tokens: number
  latency: number | string
}

export interface FeedbackType {
  rating: MessageRating
  content?: string | null
}

export type FeedbackFunc = (
  messageId: string,
  feedback: FeedbackType
) => Promise<any>
export type SubmitAnnotationFunc = (
  messageId: string,
  content: string
) => Promise<any>

export type DisplayScene = 'web' | 'console'

export interface ToolInfoInThought {
  name: string
  label: string
  input: string
  output: string
  isFinished: boolean
}

export interface ThoughtItem {
  id: string
  tool: string // plugin or dataset. May has multi.
  thought: string
  tool_input: string
  tool_labels?: { [key: string]: TypeWithI18N }
  message_id: string
  observation: string
  position: number
  files?: string[]
  message_files?: FileEntity[]
}

export interface CitationItem {
  content: string
  data_source_type: string
  dataset_name: string
  dataset_id: string
  document_id: string
  document_name: string
  hit_count: number
  index_node_hash: string
  segment_id: string
  segment_position: number
  score: number
  word_count: number
}

export interface IChatItem {
  id: string
  content: string
  citation?: CitationItem[]
  /**
   * Specific message type
   */
  isAnswer: boolean
  /**
   * The user feedback result of this message
   */
  feedback?: FeedbackType
  /**
   * The admin feedback result of this message
   */
  adminFeedback?: FeedbackType
  /**
   * Whether to hide the feedback area
   */
  feedbackDisabled?: boolean
  /**
   * More information about this message
   */
  more?: MessageMore
  annotation?: Annotation
  useCurrentUserAvatar?: boolean
  isOpeningStatement?: boolean
  suggestedQuestions?: string[]
  log?: { role: string; text: string; files?: FileEntity[] }[]
  agent_thoughts?: ThoughtItem[]
  message_files?: FileEntity[]
  workflow_run_id?: string
  // for agent log
  conversationId?: string
  input?: any
  parentMessageId?: string | null
  siblingCount?: number
  siblingIndex?: number
  prevSibling?: string
  nextSibling?: string
}

export interface Metadata {
  retriever_resources?: CitationItem[]
  annotation_reply: {
    id: string
    account: {
      id: string
      name: string
    }
  }
}

export interface MessageEnd {
  id: string
  metadata: Metadata
  files?: FileResponse[]
}

export interface MessageReplace {
  id: string
  task_id: string
  answer: string
  conversation_id: string
}

export interface AnnotationReply {
  id: string
  task_id: string
  answer: string
  conversation_id: string
  annotation_id: string
  annotation_author_name: string
}

export interface InputForm {
  type: InputVarType
  label: string
  variable: any
  required: boolean
  [key: string]: any
}
