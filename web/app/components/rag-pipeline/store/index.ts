import type { RagPipelineDatasourceProviderResponse } from '@dify/contracts/api/console/rag/types.gen'
import type { StateCreator, StoreApi } from 'zustand'
import type { InputFieldEditorProps } from '../components/panel/input-field/editor'
import type { Shape } from '@/app/components/workflow/store'
import type { IconInfo } from '@/models/datasets'
import type { RAGPipelineVariables } from '@/models/pipeline'
import { useWorkflowStore } from '@/app/components/workflow/store'

export type RagPipelineSliceShape = {
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
  dataSourceList: RagPipelineDatasourceProviderResponse[]
  setDataSourceList: (dataSourceList: RagPipelineDatasourceProviderResponse[]) => void
  isPreparingDataSource: boolean
  setIsPreparingDataSource: (isPreparingDataSource: boolean) => void
  pipelineDraftGeneration: number
  enqueuePipelineDraftOperation: <T>(operation: () => Promise<T>) => Promise<T>
}

type RagPipelineStore = Omit<ReturnType<typeof useWorkflowStore>, 'getState' | 'setState'> &
  StoreApi<Shape & RagPipelineSliceShape>

export const useRagPipelineStore = () => useWorkflowStore() as RagPipelineStore

export const createRagPipelineSliceSlice: StateCreator<
  Partial<RagPipelineSliceShape>,
  [],
  [],
  RagPipelineSliceShape
> = (set) => {
  let draftQueue: Promise<unknown> = Promise.resolve()

  return {
    knowledgeName: '',
    showInputFieldPanel: false,
    setShowInputFieldPanel: (showInputFieldPanel) => set(() => ({ showInputFieldPanel })),
    showInputFieldPreviewPanel: false,
    setShowInputFieldPreviewPanel: (showInputFieldPreviewPanel) =>
      set(() => ({ showInputFieldPreviewPanel })),
    inputFieldEditPanelProps: null,
    setInputFieldEditPanelProps: (inputFieldEditPanelProps) =>
      set(() => ({ inputFieldEditPanelProps })),
    nodesDefaultConfigs: {},
    setNodesDefaultConfigs: (nodesDefaultConfigs) => set(() => ({ nodesDefaultConfigs })),
    ragPipelineVariables: [],
    setRagPipelineVariables: (ragPipelineVariables: RAGPipelineVariables) =>
      set(() => ({ ragPipelineVariables })),
    dataSourceList: [],
    setDataSourceList: (dataSourceList) => set(() => ({ dataSourceList })),
    isPreparingDataSource: false,
    setIsPreparingDataSource: (isPreparingDataSource) => set(() => ({ isPreparingDataSource })),
    pipelineDraftGeneration: 0,
    enqueuePipelineDraftOperation: (operation) => {
      const next = draftQueue.catch(() => undefined).then(operation)
      draftQueue = next
      return next
    },
  }
}
