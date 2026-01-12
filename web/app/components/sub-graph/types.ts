import type { StateCreator } from 'zustand'
import type { Edge, Node, NodeOutPutVar, ValueSelector, VarType } from '@/app/components/workflow/types'

export type WhenOutputNoneOption = 'error' | 'default'

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

export type SubGraphProps = {
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

  subGraphNodes: Node[]
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
  setSubGraphNodes: (nodes: Node[]) => void
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
