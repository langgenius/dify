import type { Edge, Node } from 'reactflow'
import type { StateCreator } from 'zustand'

export type SelectPanelSliceShape = {
  selectGraph: {
    nodes: Node[],
    edges: Edge[],
  },
  selectPanelMenu?: {
    top: number
    left: number
  },
  setSelectPanelMenu: (panelMenu: SelectPanelSliceShape['selectPanelMenu']) => void,
  setSelectGraph: (selectGraph: SelectPanelSliceShape['selectGraph']) => void,
}

export const createSelectPanelSlice: StateCreator<SelectPanelSliceShape> = set => ({
  selectPanelMenu: undefined,
  setSelectPanelMenu: selectPanelMenu => set(() => ({ selectPanelMenu })),
  selectGraph: {
    nodes: [],
    edges: [],
  },
  setSelectGraph: selectGraph => set(() => ({ selectGraph })),
})
