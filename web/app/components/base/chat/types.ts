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
  select: UserInputForm & {
    options: string[]
  }
}

export type UserInputFormParagraph = {
  paragraph: UserInputForm
}

export type VisionConfig = VisionSettings

export type EnableType = {
  enabled: boolean
}

export type ChatConfig = Omit<ModelConfig, 'model'> & {
  supportAnnotation?: boolean
  appId?: string
  questionEditEnable?: boolean
  supportFeedback?: boolean
  supportCitationHitInfo?: boolean
  system_parameters: {
    audio_file_size_limit: number
    file_size_limit: number
    image_file_size_limit: number
    video_file_size_limit: number
    workflow_file_upload_limit: number
  }
  more_like_this: {
    enabled: boolean
  }
}

export type WorkflowProcess = {
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
} & ChatItem

export type OnSend = {
  (message: string, files?: FileEntity[]): void
  (message: string, files: FileEntity[] | undefined, isRegenerate: boolean, lastAnswer?: ChatItem | null): void
}

export type OnRegenerate = (chatItem: ChatItem) => void

export type Callback = {
  onSuccess: () => void
}

export type Feedback = {
  rating: 'like' | 'dislike' | null
  content?: string | null
}

export type MemorySpec = {
  id: string
  name: string
  description: string
  template: string // default value
  instruction: string
  scope: string // app or node
  term: string // session or persistent
  strategy: string
  update_turns: number
  preserved_turns: number
  schedule_mode: string // sync or async
  end_user_visible: boolean
  end_user_editable: boolean
}

export type ConversationMetaData = {
  type: string // mutable_visible_window
  visible_count: number // visible_count - preserved_turns = N messages waiting merged
}

export type Memory = {
  tenant_id: string
  value: string
  app_id: string
  conversation_id?: string
  node_id?: string
  version: number
  edited_by_user: boolean
  conversation_metadata?: ConversationMetaData
  spec: MemorySpec
}
