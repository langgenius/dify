import type {
  ModelConfig,
  VisionFile,
  VisionSettings,
} from '@/types/app'
import type { IChatItem } from '@/app/components/app/chat/type'

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
  'text-inpput': UserInputForm & {
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

export type ChatItem = IChatItem

export type OnSend = (message: string, files?: VisionFile[]) => void

export type Callback = {
  onSuccess: () => void
}

export type Feedback = {
  rating: 'like' | 'dislike' | null
}
