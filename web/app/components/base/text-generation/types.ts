import type { ExternalDataTool } from '@/models/common'
import type {
  ModelConfig,
  VisionFile,
} from '@/types/app'

export type { VisionFile } from '@/types/app'
export { TransferMethod } from '@/types/app'

export type TextGenerationConfig = Omit<ModelConfig, 'model'> & {
  external_data_tools: ExternalDataTool[]
}

export type OnSend = (message: string, files?: VisionFile[]) => void
