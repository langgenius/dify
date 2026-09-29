import type { ExternalDataTool } from '@/models/common'
import type { AgentConfig } from '@/models/debug'
import type { ModelConfig, VisionFile } from '@/types/app'

export { TransferMethod } from '@/types/app'

export type TextGenerationConfig = Omit<
  ModelConfig,
  'model' | 'system_parameters' | 'agent_mode'
> & {
  agent_mode: Pick<AgentConfig, 'enabled' | 'tools'> & { strategy?: AgentConfig['strategy'] }
  external_data_tools: ExternalDataTool[]
}

export type OnSend = (message: string, files?: VisionFile[]) => void
