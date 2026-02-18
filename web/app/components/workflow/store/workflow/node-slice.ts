import type { StateCreator } from 'zustand'
import type {
  VariableAssignerNodeType,
} from '@/app/components/workflow/nodes/variable-assigner/types'
import type {
  Node,
} from '@/app/components/workflow/types'
import type {
  NodeTracing,
} from '@/types/workflow'

export type NodeSliceShape = {
  showSingleRunPanel: boolean
  setShowSingleRunPanel: (showSingleRunPanel: boolean) => void
  nodeAnimation: boolean
  setNodeAnimation: (nodeAnimation: boolean) => void
  candidateNode?: Node
  setCandidateNode: (candidateNode?: Node) => void
  nodeMenu?: {
    top: number
    left: number
    nodeId: string
  }
  setNodeMenu: (nodeMenu: NodeSliceShape['nodeMenu']) => void
  showAssignVariablePopup?: {
    nodeId: string
    nodeData: Node['data']
    variableAssignerNodeId: string
    variableAssignerNodeData: VariableAssignerNodeType
    variableAssignerNodeHandleId: string
    parentNode?: Node
    x: number
    y: number
  }
  setShowAssignVariablePopup: (showAssignVariablePopup: NodeSliceShape['showAssignVariablePopup']) => void
  hoveringAssignVariableGroupId?: string
  setHoveringAssignVariableGroupId: (hoveringAssignVariableGroupId?: string) => void
  connectingNodePayload?: { nodeId: string, nodeType: string, handleType: string, handleId: string | null }
  setConnectingNodePayload: (startConnectingPayload?: NodeSliceShape['connectingNodePayload']) => void
  enteringNodePayload?: {
    nodeId: string
    nodeData: VariableAssignerNodeType
  }
  setEnteringNodePayload: (enteringNodePayload?: NodeSliceShape['enteringNodePayload']) => void
  iterTimes: number
  setIterTimes: (iterTimes: number) => void
  loopTimes: number
  setLoopTimes: (loopTimes: number) => void
  iterParallelLogMap: Map<string, Map<string, NodeTracing[]>>
  setIterParallelLogMap: (iterParallelLogMap: Map<string, Map<string, NodeTracing[]>>) => void
  pendingSingleRun?: {
    nodeId: string
    action: 'run' | 'stop'
  }
  setPendingSingleRun: (payload?: NodeSliceShape['pendingSingleRun']) => void
}

export const createNodeSlice: StateCreator<NodeSliceShape> = set => ({
  showSingleRunPanel: false,
  setShowSingleRunPanel: showSingleRunPanel => set(() => ({ showSingleRunPanel })),
  nodeAnimation: false,
  setNodeAnimation: nodeAnimation => set(() => ({ nodeAnimation })),
  candidateNode: undefined,
  setCandidateNode: candidateNode => set(() => ({ candidateNode })),
  nodeMenu: undefined,
  setNodeMenu: nodeMenu => set(() => ({ nodeMenu })),
  showAssignVariablePopup: undefined,
  setShowAssignVariablePopup: showAssignVariablePopup => set(() => ({ showAssignVariablePopup })),
  hoveringAssignVariableGroupId: undefined,
  setHoveringAssignVariableGroupId: hoveringAssignVariableGroupId => set(() => ({ hoveringAssignVariableGroupId })),
  connectingNodePayload: undefined,
  setConnectingNodePayload: connectingNodePayload => set(() => ({ connectingNodePayload })),
  enteringNodePayload: undefined,
  setEnteringNodePayload: enteringNodePayload => set(() => ({ enteringNodePayload })),
  iterTimes: 1,
  setIterTimes: iterTimes => set(() => ({ iterTimes })),
  loopTimes: 1,
  setLoopTimes: loopTimes => set(() => ({ loopTimes })),
  iterParallelLogMap: new Map<string, Map<string, NodeTracing[]>>(),
  setIterParallelLogMap: iterParallelLogMap => set(() => ({ iterParallelLogMap })),
  pendingSingleRun: undefined,
  setPendingSingleRun: payload => set(() => ({ pendingSingleRun: payload })),
})
