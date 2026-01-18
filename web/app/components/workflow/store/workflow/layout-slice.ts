import type { StateCreator } from 'zustand'
import { STORAGE_KEYS } from '@/config/storage-keys'
import { storage } from '@/utils/storage'

export type LayoutSliceShape = {
  workflowCanvasWidth?: number
  workflowCanvasHeight?: number
  setWorkflowCanvasWidth: (width: number) => void
  setWorkflowCanvasHeight: (height: number) => void
  rightPanelWidth?: number
  setRightPanelWidth: (width: number) => void
  nodePanelWidth: number
  setNodePanelWidth: (width: number) => void
  previewPanelWidth: number
  setPreviewPanelWidth: (width: number) => void
  otherPanelWidth: number
  setOtherPanelWidth: (width: number) => void
  bottomPanelWidth: number
  setBottomPanelWidth: (width: number) => void
  bottomPanelHeight: number
  setBottomPanelHeight: (height: number) => void
  variableInspectPanelHeight: number
  setVariableInspectPanelHeight: (height: number) => void
  maximizeCanvas: boolean
  setMaximizeCanvas: (maximize: boolean) => void
}

export const createLayoutSlice: StateCreator<LayoutSliceShape> = set => ({
  workflowCanvasWidth: undefined,
  workflowCanvasHeight: undefined,
  setWorkflowCanvasWidth: width => set(() => ({ workflowCanvasWidth: width })),
  setWorkflowCanvasHeight: height => set(() => ({ workflowCanvasHeight: height })),
  rightPanelWidth: undefined,
  setRightPanelWidth: width => set(() => ({ rightPanelWidth: width })),
  nodePanelWidth: storage.getNumber(STORAGE_KEYS.WORKFLOW.NODE_PANEL_WIDTH, 420),
  setNodePanelWidth: width => set(() => ({ nodePanelWidth: width })),
  previewPanelWidth: storage.getNumber(STORAGE_KEYS.WORKFLOW.PREVIEW_PANEL_WIDTH, 400),
  setPreviewPanelWidth: width => set(() => ({ previewPanelWidth: width })),
  otherPanelWidth: 400,
  setOtherPanelWidth: width => set(() => ({ otherPanelWidth: width })),
  bottomPanelWidth: 480,
  setBottomPanelWidth: width => set(() => ({ bottomPanelWidth: width })),
  bottomPanelHeight: 324,
  setBottomPanelHeight: height => set(() => ({ bottomPanelHeight: height })),
  variableInspectPanelHeight: storage.getNumber(STORAGE_KEYS.WORKFLOW.VARIABLE_INSPECT_PANEL_HEIGHT, 320),
  setVariableInspectPanelHeight: height => set(() => ({ variableInspectPanelHeight: height })),
  maximizeCanvas: storage.getBoolean(STORAGE_KEYS.WORKFLOW.CANVAS_MAXIMIZE, false),
  setMaximizeCanvas: maximize => set(() => ({ maximizeCanvas: maximize })),
})
