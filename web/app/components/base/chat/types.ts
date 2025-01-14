import type {
  ModelConfig,
  VisionSettings,
} from '@/types/app'
import type { IChatItem } from '@/app/components/base/chat/chat/type'
import type { NodeTracing } from '@/types/workflow'
import type { WorkflowRunningStatus } from '@/app/components/workflow/types'
import type { FileEntity } from '@/app/components/base/file-uploader/types'

export type { VisionFile } from '@/types/app'
export { TransferMethod } from '@/types/app'
export type {
  Inputs,
  PromptVariable,
} from '@/models/debug'

export interface UserInputForm {
  default: string
  label: string
  required: boolean
  variable: string
}

export interface UserInputFormTextInput {
  'text-input': UserInputForm & {
    max_length: number
  }
}

export interface UserInputFormSelect {
  select: UserInputForm & {
    options: string[]
  }
}

export interface UserInputFormParagraph {
  paragraph: UserInputForm
}

export type VisionConfig = VisionSettings

export interface EnableType {
  enabled: boolean
}

export type ChatConfig = Omit<ModelConfig, 'model'> & {
  supportAnnotation?: boolean
  appId?: string
  supportFeedback?: boolean
  supportCitationHitInfo?: boolean
}

export interface WorkflowProcess {
  status: WorkflowRunningStatus
  tracing: NodeTracing[]
  expand?: boolean // for UI
  resultText?: string
  files?: FileEntity[]
}

export type ChatItem = IChatItem & {
  isError?: boolean
  workflowProcess?: WorkflowProcess
  conversationId?: string
  allFiles?: FileEntity[]
}

export type ChatItemInTree = {
  children?: ChatItemInTree[]
} & IChatItem

export type OnSend = (message: string, files?: FileEntity[], last_answer?: ChatItem | null) => void

export type OnRegenerate = (chatItem: ChatItem) => void

export interface Callback {
  onSuccess: () => void
}

export interface Feedback {
  rating: 'like' | 'dislike' | null
}
