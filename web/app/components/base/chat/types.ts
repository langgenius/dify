import type { VisionFile, VisionSettings } from '@/types/app'
import type { IChatItem } from '@/app/components/app/chat/type'

export type { VisionFile } from '@/types/app'
export { TransferMethod } from '@/types/app'

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

export type ChatConfig = {
  opening_statement: string
  speech_to_text: EnableType
  user_input_form?: (UserInputFormTextInput | UserInputFormSelect | UserInputFormParagraph)[]
  suggested_questions_after_answer: EnableType
  file_upload?: {
    image: VisionConfig
  }
}

export type ChatItem = IChatItem

export type OnSend = (message: string, files?: VisionFile[]) => void
