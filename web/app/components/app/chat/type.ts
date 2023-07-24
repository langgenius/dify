import type { Annotation, MessageRating } from '@/models/log'

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

export type ThoughtItem = {
  id: string
  tool: string // plugin or dataset
  thought: string
  tool_input: string
  message_id: string
}
export type IChatItem = {
  id: string
  content: string
  agent_thoughts?: ThoughtItem[]
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
}
