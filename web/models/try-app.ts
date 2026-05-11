import type { Viewport } from 'reactflow'
import type { Edge, Node } from '@/app/components/workflow/types'
import type { SiteInfo } from '@/models/share'
import type { AppModeEnum, ModelConfig } from '@/types/app'

export type TryAppInfo = {
  name: string
  description: string
  mode: AppModeEnum
  site: SiteInfo
  model_config: ModelConfig
  deleted_tools: { id: string, tool_name: string }[]
}

export type TryAppFlowPreview = {
  graph: {
    nodes: Node[]
    edges: Edge[]
    viewport: Viewport
  }
}
