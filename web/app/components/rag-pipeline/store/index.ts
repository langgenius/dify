import type { RAGPipelineVariables } from '@/models/pipeline'
import type { StateCreator } from 'zustand'
import { InputVarType } from '../../workflow/types'

export type RagPipelineSliceShape = {
  pipelineId: string
  showInputFieldDialog: boolean
  setShowInputFieldDialog: (showInputFieldPanel: boolean) => void
  nodesDefaultConfigs: Record<string, any>
  setNodesDefaultConfigs: (nodesDefaultConfigs: Record<string, any>) => void
  ragPipelineVariables: RAGPipelineVariables
  setRagPipelineVariables: (ragPipelineVariables: RAGPipelineVariables) => void
}

export type CreateRagPipelineSliceSlice = StateCreator<RagPipelineSliceShape>
export const createRagPipelineSliceSlice: StateCreator<RagPipelineSliceShape> = set => ({
  pipelineId: '',
  showInputFieldDialog: false,
  setShowInputFieldDialog: showInputFieldDialog => set(() => ({ showInputFieldDialog })),
  nodesDefaultConfigs: {},
  setNodesDefaultConfigs: nodesDefaultConfigs => set(() => ({ nodesDefaultConfigs })),
  ragPipelineVariables: [{
    // TODO: delete mock data
    nodeId: '123',
    variables: [{
      variable: 'name',
      label: 'name',
      type: InputVarType.textInput,
      required: true,
      max_length: 12,
    }, {
        variable: 'num',
        label: 'num',
        type: InputVarType.number,
        required: true,
      }],
  }, {
      nodeId: '',
      variables: [{
        variable: 'name',
        label: 'name',
        type: InputVarType.textInput,
        required: true,
        max_length: 12,
      }, {
        variable: 'num',
        label: 'num',
        type: InputVarType.number,
        required: true,
      }],
    }],
  setRagPipelineVariables: (ragPipelineVariables: RAGPipelineVariables) => set(() => ({ ragPipelineVariables })),
})
