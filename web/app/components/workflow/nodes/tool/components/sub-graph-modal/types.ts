import type { StateCreator } from 'zustand'
import type { Edge, Node, NodeOutPutVar, ValueSelector, VarType } from '@/app/components/workflow/types'

export type SubGraphNodeData = {
  isInSubGraph: boolean
  subGraph_id: string
  subGraphParamKey: string
}

export type SubGraphNode = Node & {
  data: Node['data'] & SubGraphNodeData
}

export type SubGraphSourceNodeData = {
  title: string
  sourceAgentNodeId: string
  sourceVariable: ValueSelector
  sourceVarType: VarType
  isReadOnly: true
  isInSubGraph: true
  subGraph_id: string
  subGraphParamKey: string
}

export type WhenOutputNoneOption = 'skip' | 'error' | 'default'

export type SubGraphConfig = {
  enabled: boolean
  startNodeId: string
  selectedOutputVar: ValueSelector
  whenOutputNone: WhenOutputNoneOption
  defaultValue?: string
}

export type SubGraphOutputVariable = {
  nodeId: string
  nodeName: string
  variable: string
  type: VarType
  description?: string
}

export type SubGraphModalProps = {
  isOpen: boolean
  onClose: () => void
  toolNodeId: string
  paramKey: string
  sourceVariable: ValueSelector
  agentName: string
  agentNodeId: string
}

export type ConfigPanelProps = {
  toolNodeId: string
  paramKey: string
  activeTab: 'settings' | 'lastRun'
  onTabChange: (tab: 'settings' | 'lastRun') => void
}

export type SubGraphCanvasProps = {
  toolNodeId: string
  paramKey: string
  sourceVariable: ValueSelector
  agentNodeId: string
  agentName: string
}

export type SubGraphSliceShape = {
  parentToolNodeId: string
  parameterKey: string
  sourceAgentNodeId: string
  sourceVariable: ValueSelector

  subGraphNodes: SubGraphNode[]
  subGraphEdges: Edge[]

  selectedOutputVar: ValueSelector
  whenOutputNone: WhenOutputNoneOption
  defaultValue: string

  showDebugPanel: boolean
  isRunning: boolean

  parentAvailableVars: NodeOutPutVar[]

  setSubGraphContext: (context: {
    parentToolNodeId: string
    parameterKey: string
    sourceAgentNodeId: string
    sourceVariable: ValueSelector
  }) => void
  setSubGraphNodes: (nodes: SubGraphNode[]) => void
  setSubGraphEdges: (edges: Edge[]) => void
  setSelectedOutputVar: (selector: ValueSelector) => void
  setWhenOutputNone: (option: WhenOutputNoneOption) => void
  setDefaultValue: (value: string) => void
  setShowDebugPanel: (show: boolean) => void
  setIsRunning: (running: boolean) => void
  setParentAvailableVars: (vars: NodeOutPutVar[]) => void
  resetSubGraph: () => void
}

export type CreateSubGraphSlice = StateCreator<SubGraphSliceShape>
