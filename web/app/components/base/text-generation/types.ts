import type { ExternalDataTool } from '@/models/common'
import type {
  ModelConfig,
  VisionFile,
  VisionSettings,
} from '@/types/app'

export type { VisionFile } from '@/types/app'
export { TransferMethod } from '@/types/app'

type UserInputForm = {
  default: string
  label: string
  required: boolean
  variable: string
}

type UserInputFormTextInput = {
  'text-input': UserInputForm & {
    max_length: number
  }
}

type UserInputFormSelect = {
  select: UserInputForm & {
    options: string[]
  }
}

type UserInputFormParagraph = {
  paragraph: UserInputForm
}

type VisionConfig = VisionSettings

type EnableType = {
  enabled: boolean
}

export type TextGenerationConfig = Omit<ModelConfig, 'model'> & {
  external_data_tools: ExternalDataTool[]
}

export type OnSend = (message: string, files?: VisionFile[]) => void
