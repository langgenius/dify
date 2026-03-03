import type { StateCreator } from 'zustand'
import type { RerunVariableGroupName } from '@/service/workflow-rerun'
import type { NodeWithVar, VarInInspect } from '@/types/workflow'

export type VariableInspectMode = 'cache' | 'rerun-edit'

export type RerunVariableMeta = {
  group: RerunVariableGroupName
  declaredType: string | null
  required: boolean | null
  masked: boolean
  rawValueType: string
}

export type RerunContext = {
  appId: string
  sourceRunId: string
  sourceRunStatus: string
  targetNodeId: string
  loading: boolean
  submitting: boolean
  nodeGroups: NodeWithVar[]
  envVars: VarInInspect[]
  originalValueByVarId: Record<string, unknown>
  currentValueByVarId: Record<string, unknown>
  metaByVarId: Record<string, RerunVariableMeta>
}

export type PanelSliceShape = {
  panelWidth: number
  showFeaturesPanel: boolean
  setShowFeaturesPanel: (showFeaturesPanel: boolean) => void
  showWorkflowVersionHistoryPanel: boolean
  setShowWorkflowVersionHistoryPanel: (showWorkflowVersionHistoryPanel: boolean) => void
  showInputsPanel: boolean
  setShowInputsPanel: (showInputsPanel: boolean) => void
  showDebugAndPreviewPanel: boolean
  setShowDebugAndPreviewPanel: (showDebugAndPreviewPanel: boolean) => void
  panelMenu?: {
    top: number
    left: number
  }
  setPanelMenu: (panelMenu: PanelSliceShape['panelMenu']) => void
  selectionMenu?: {
    top: number
    left: number
  }
  setSelectionMenu: (selectionMenu: PanelSliceShape['selectionMenu']) => void
  showVariableInspectPanel: boolean
  setShowVariableInspectPanel: (showVariableInspectPanel: boolean) => void
  variableInspectMode: VariableInspectMode
  setVariableInspectMode: (variableInspectMode: VariableInspectMode) => void
  rerunContext?: RerunContext
  setRerunContext: (rerunContext?: RerunContext) => void
  patchRerunContext: (rerunContext: Partial<RerunContext>) => void
  clearRerunContext: () => void
  updateRerunVarValue: (varId: string, value: unknown) => void
  initShowLastRunTab: boolean
  setInitShowLastRunTab: (initShowLastRunTab: boolean) => void
}

export const createPanelSlice: StateCreator<PanelSliceShape> = set => ({
  panelWidth: localStorage.getItem('workflow-node-panel-width') ? Number.parseFloat(localStorage.getItem('workflow-node-panel-width')!) : 420,
  showFeaturesPanel: false,
  setShowFeaturesPanel: showFeaturesPanel => set(() => ({ showFeaturesPanel })),
  showWorkflowVersionHistoryPanel: false,
  setShowWorkflowVersionHistoryPanel: showWorkflowVersionHistoryPanel => set(() => ({ showWorkflowVersionHistoryPanel })),
  showInputsPanel: false,
  setShowInputsPanel: showInputsPanel => set(() => ({ showInputsPanel })),
  showDebugAndPreviewPanel: false,
  setShowDebugAndPreviewPanel: showDebugAndPreviewPanel => set(() => ({ showDebugAndPreviewPanel })),
  panelMenu: undefined,
  setPanelMenu: panelMenu => set(() => ({ panelMenu })),
  selectionMenu: undefined,
  setSelectionMenu: selectionMenu => set(() => ({ selectionMenu })),
  showVariableInspectPanel: false,
  setShowVariableInspectPanel: showVariableInspectPanel => set((state) => {
    if (showVariableInspectPanel)
      return { showVariableInspectPanel }

    return {
      showVariableInspectPanel,
      variableInspectMode: 'cache',
      rerunContext: state.variableInspectMode === 'rerun-edit' ? undefined : state.rerunContext,
    }
  }),
  variableInspectMode: 'cache',
  setVariableInspectMode: variableInspectMode => set(() => ({ variableInspectMode })),
  rerunContext: undefined,
  setRerunContext: rerunContext => set(() => ({ rerunContext })),
  patchRerunContext: rerunContext => set((state) => {
    if (!state.rerunContext)
      return {}

    return { rerunContext: { ...state.rerunContext, ...rerunContext } }
  }),
  clearRerunContext: () => set(() => ({ rerunContext: undefined })),
  updateRerunVarValue: (varId, value) => set((state) => {
    if (!state.rerunContext)
      return {}

    return {
      rerunContext: {
        ...state.rerunContext,
        currentValueByVarId: {
          ...state.rerunContext.currentValueByVarId,
          [varId]: value,
        },
      },
    }
  }),
  initShowLastRunTab: false,
  setInitShowLastRunTab: initShowLastRunTab => set(() => ({ initShowLastRunTab })),
})
