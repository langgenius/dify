import { create } from 'zustand'
import type { EdgeMouseHandler } from 'reactflow'

type State = {
  selectedNodeId: string
  hoveringEdgeId: string
}

type Action = {
  handleSelectedNodeId: (selectedNodeId: State['selectedNodeId']) => void
  handleEnterEdge: EdgeMouseHandler
  handleLeaveEdge: EdgeMouseHandler
}

export const useStore = create<State & Action>(set => ({
  selectedNodeId: '',
  handleSelectedNodeId: selectedNodeId => set(() => ({ selectedNodeId })),
  hoveringEdgeId: '',
  handleEnterEdge: (_, edge) => set(() => ({ hoveringEdgeId: edge.id })),
  handleLeaveEdge: () => set(() => ({ hoveringEdgeId: '' })),
}))
