import type { StateCreator } from 'zustand'
import type { InputFieldEditorProps } from '../components/panel/input-field/editor'
import type { DataSourceItem } from '@/app/components/workflow/block-selector/types'
import type {
  ToolWithProvider,
} from '@/app/components/workflow/types'
import type { IconInfo } from '@/models/datasets'
import type { RAGPipelineVariables } from '@/models/pipeline'
import { transformDataSourceToTool } from '@/app/components/workflow/block-selector/utils'

export type RagPipelineSliceShape = {
  pipelineId: string
  knowledgeName: string
  knowledgeIcon?: IconInfo
  showInputFieldPanel: boolean
  setShowInputFieldPanel: (showInputFieldPanel: boolean) => void
  showInputFieldPreviewPanel: boolean
  setShowInputFieldPreviewPanel: (showInputFieldPreviewPanel: boolean) => void
  inputFieldEditPanelProps: InputFieldEditorProps | null
  setInputFieldEditPanelProps: (showInputFieldEditPanel: InputFieldEditorProps | null) => void
  nodesDefaultConfigs: Record<string, any>
  setNodesDefaultConfigs: (nodesDefaultConfigs: Record<string, any>) => void
  ragPipelineVariables: RAGPipelineVariables
  setRagPipelineVariables: (ragPipelineVariables: RAGPipelineVariables) => void
  dataSourceList: ToolWithProvider[]
  setDataSourceList: (dataSourceList: DataSourceItem[]) => void
  isPreparingDataSource: boolean
  setIsPreparingDataSource: (isPreparingDataSource: boolean) => void
}

export type CreateRagPipelineSliceSlice = StateCreator<RagPipelineSliceShape>
export const createRagPipelineSliceSlice: StateCreator<RagPipelineSliceShape> = set => ({
  pipelineId: '',
  knowledgeName: '',
  showInputFieldPanel: false,
  setShowInputFieldPanel: showInputFieldPanel => set(() => ({ showInputFieldPanel })),
  showInputFieldPreviewPanel: false,
  setShowInputFieldPreviewPanel: showInputFieldPreviewPanel => set(() => ({ showInputFieldPreviewPanel })),
  inputFieldEditPanelProps: null,
  setInputFieldEditPanelProps: inputFieldEditPanelProps => set(() => ({ inputFieldEditPanelProps })),
  nodesDefaultConfigs: {},
  setNodesDefaultConfigs: nodesDefaultConfigs => set(() => ({ nodesDefaultConfigs })),
  ragPipelineVariables: [],
  setRagPipelineVariables: (ragPipelineVariables: RAGPipelineVariables) => set(() => ({ ragPipelineVariables })),
  dataSourceList: [],
  setDataSourceList: (dataSourceList: DataSourceItem[]) => {
    const formattedDataSourceList = dataSourceList.map(item => transformDataSourceToTool(item))
    set(() => ({ dataSourceList: formattedDataSourceList }))
  },
  isPreparingDataSource: false,
  setIsPreparingDataSource: isPreparingDataSource => set(() => ({ isPreparingDataSource })),
})
