import type {
  ModelConfig,
  VisionFile,
  VisionSettings,
} from '@/types/app'
import type { ExternalDataTool } from '@/models/common'
export type { VisionFile } from '@/types/app'
export { TransferMethod } from '@/types/app'

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

export type TextGenerationConfig = Omit<ModelConfig, 'model'> & {
  external_data_tools: ExternalDataTool[]
}

export type OnSend = (message: string, files?: VisionFile[]) => void
