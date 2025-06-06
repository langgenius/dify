import type { RAGPipelineVariables } from '@/models/pipeline'
import type { StateCreator } from 'zustand'
import type {
  ToolWithProvider,
} from '@/app/components/workflow/types'
import type { DataSourceItem } from '@/app/components/workflow/block-selector/types'
import { transformDataSourceToTool } from '@/app/components/workflow/block-selector/utils'

export type RagPipelineSliceShape = {
  pipelineId: string
  knowledgeName: string
  showInputFieldDialog: boolean
  setShowInputFieldDialog: (showInputFieldPanel: boolean) => void
  nodesDefaultConfigs: Record<string, any>
  setNodesDefaultConfigs: (nodesDefaultConfigs: Record<string, any>) => void
  ragPipelineVariables: RAGPipelineVariables
  setRagPipelineVariables: (ragPipelineVariables: RAGPipelineVariables) => void
  dataSourceList: ToolWithProvider[]
  setDataSourceList: (dataSourceList: DataSourceItem[]) => void
}

export type CreateRagPipelineSliceSlice = StateCreator<RagPipelineSliceShape>
export const createRagPipelineSliceSlice: StateCreator<RagPipelineSliceShape> = set => ({
  pipelineId: '',
  knowledgeName: '',
  showInputFieldDialog: false,
  setShowInputFieldDialog: showInputFieldDialog => set(() => ({ showInputFieldDialog })),
  nodesDefaultConfigs: {},
  setNodesDefaultConfigs: nodesDefaultConfigs => set(() => ({ nodesDefaultConfigs })),
  ragPipelineVariables: [],
  setRagPipelineVariables: (ragPipelineVariables: RAGPipelineVariables) => set(() => ({ ragPipelineVariables })),
  dataSourceList: [],
  setDataSourceList: (dataSourceList: DataSourceItem[]) => {
    const formattedDataSourceList = dataSourceList.map(item => transformDataSourceToTool(item))
    set(() => ({ dataSourceList: formattedDataSourceList }))
  },
})
