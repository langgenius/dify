import type {
  ModelConfig,
  VisionFile,
  VisionSettings,
} from '@/types/app'
import type { IChatItem } from '@/app/components/base/chat/chat/type'
import type { NodeTracing } from '@/types/workflow'
import type { WorkflowRunningStatus } from '@/app/components/workflow/types'

export type { VisionFile } from '@/types/app'
export { TransferMethod } from '@/types/app'
export type {
  Inputs,
  PromptVariable,
} from '@/models/debug'

export type UserInputForm = {
  default: string
  label: string
  required: boolean
  variable: string
}

export type UserInputFormTextInput = {
  'text-input': UserInputForm & {
    max_length: number
  }
}

export type UserInputFormSelect = {
  'select': UserInputForm & {
    options: string[]
  }
}

export type UserInputFormParagraph = {
  'paragraph': UserInputForm
}

export type VisionConfig = VisionSettings

export type EnableType = {
  enabled: boolean
}

export type ChatConfig = Omit<ModelConfig, 'model'> & {
  supportAnnotation?: boolean
  appId?: string
  supportFeedback?: boolean
  supportCitationHitInfo?: boolean
}

export type WorkflowProcess = {
  status: WorkflowRunningStatus
  tracing: NodeTracing[]
  expand?: boolean // for UI
  resultText?: string
}

export type ChatItem = IChatItem & {
  isError?: boolean
  workflowProcess?: WorkflowProcess
  conversationId?: string
}

export type OnSend = (message: string, files?: VisionFile[], last_answer?: ChatItem | null) => void

export type OnRegenerate = (chatItem: ChatItem) => void

export type Callback = {
  onSuccess: () => void
}

export type Feedback = {
  rating: 'like' | 'dislike' | null
}
