import type { Annotation, MessageRating } from '@/models/log'
import type { VisionFile } from '@/types/app'

export type MessageMore = {
  time: string
  tokens: number
  latency: number | string
}

export type Feedbacktype = {
  rating: MessageRating
  content?: string | null
}

export type FeedbackFunc = (messageId: string, feedback: Feedbacktype) => Promise<any>
export type SubmitAnnotationFunc = (messageId: string, content: string) => Promise<any>

export type DisplayScene = 'web' | 'console'

export type ToolInfoInThought = {
  name: string
  input: string
  output: string
  isFinished: boolean
}

export type ThoughtItem = {
  id: string
  tool: string // plugin or dataset. May has multi.
  thought: string
  tool_input: string
  message_id: string
  observation: string
  position: number
  files?: string[]
  message_files?: VisionFile[]
}

export type CitationItem = {
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

export type IChatItem = {
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
  feedback?: Feedbacktype
  /**
   * The admin feedback result of this message
   */
  adminFeedback?: Feedbacktype
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
  log?: { role: string; text: string; files?: VisionFile[] }[]
  agent_thoughts?: ThoughtItem[]
  message_files?: VisionFile[]
  workflow_run_id?: string
  // for agent log
  conversationId?: string
  input?: any
}

export type MessageEnd = {
  id: string
  metadata: {
    retriever_resources?: CitationItem[]
    annotation_reply: {
      id: string
      account: {
        id: string
        name: string
      }
    }
  }
}

export type MessageReplace = {
  id: string
  task_id: string
  answer: string
  conversation_id: string
}

export type AnnotationReply = {
  id: string
  task_id: string
  answer: string
  conversation_id: string
  annotation_id: string
  annotation_author_name: string
}
