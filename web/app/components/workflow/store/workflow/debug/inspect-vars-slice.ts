import type { StateCreator } from 'zustand'
import { produce } from 'immer'
import type { NodeWithVar, VarInInspect } from '@/types/workflow'
import type { ValueSelector } from '../../../types'

type InspectVarsState = {
  currentFocusNodeId: string | null
  nodesWithInspectVars: NodeWithVar[] // the nodes have data
  conversationVars: VarInInspect[]
}

type InspectVarsActions = {
  setCurrentFocusNodeId: (nodeId: string | null) => void
  setNodesWithInspectVars: (payload: NodeWithVar[]) => void
  deleteAllInspectVars: () => void
  setNodeInspectVars: (nodeId: string, payload: VarInInspect[]) => void
  deleteNodeInspectVars: (nodeId: string) => void
  setInspectVarValue: (nodeId: string, name: string, value: any) => void
  resetToLastRunVar: (nodeId: string, varId: string, value: any) => void
  renameInspectVarName: (nodeId: string, varId: string, selector: ValueSelector) => void
  deleteInspectVar: (nodeId: string, varId: string) => void
}

export type InspectVarsSliceShape = InspectVarsState & InspectVarsActions

export const createInspectVarsSlice: StateCreator<InspectVarsSliceShape> = (set) => {
  return ({
    currentFocusNodeId: null,
    nodesWithInspectVars: [],
    conversationVars: [],
    setCurrentFocusNodeId: (nodeId) => {
      set(() => ({
        currentFocusNodeId: nodeId,
      }))
    },
    setNodesWithInspectVars: (payload) => {
      set(() => ({
        nodesWithInspectVars: payload,
      }))
    },
    deleteAllInspectVars: () => {
      set(() => ({
        nodesWithInspectVars: [],
      }))
    },
    setNodeInspectVars: (nodeId, payload) => {
      set((state) => {
        const prevNodes = state.nodesWithInspectVars
        const nodes = produce(prevNodes, (draft) => {
          const index = prevNodes.findIndex(node => node.nodeId === nodeId)
          if (index !== -1) {
            draft[index].vars = payload
            draft[index].isValueFetched = true
          }
        })

        return {
          nodesWithInspectVars: nodes,
        }
      })
    },
    deleteNodeInspectVars: (nodeId) => {
      set((state: InspectVarsSliceShape) => {
        const nodes = state.nodesWithInspectVars.filter(node => node.nodeId !== nodeId)
        return {
          nodesWithInspectVars: nodes,
        }
      },
      )
    },
    setInspectVarValue: (nodeId, varId, value) => {
      set((state: InspectVarsSliceShape) => {
        const nodes = produce(state.nodesWithInspectVars, (draft) => {
          const targetNode = draft.find(node => node.nodeId === nodeId)
          if (!targetNode)
            return
          const targetVar = targetNode.vars.find(varItem => varItem.id === varId)
          if (!targetVar)
            return
          targetVar.value = value
          targetVar.edited = true
        },
        )
        return {
          nodesWithInspectVars: nodes,
        }
      })
    },
    resetToLastRunVar: (nodeId, varId, value) => {
      set((state: InspectVarsSliceShape) => {
        const nodes = produce(state.nodesWithInspectVars, (draft) => {
          const targetNode = draft.find(node => node.nodeId === nodeId)
          if (!targetNode)
            return
          const targetVar = targetNode.vars.find(varItem => varItem.id === varId)
          if (!targetVar)
            return
          targetVar.value = value
          targetVar.edited = false
        },
        )
        return {
          nodesWithInspectVars: nodes,
        }
      })
    },
    renameInspectVarName: (nodeId, varId, selector) => {
      set((state: InspectVarsSliceShape) => {
        const nodes = produce(state.nodesWithInspectVars, (draft) => {
          const targetNode = draft.find(node => node.nodeId === nodeId)
          if (!targetNode)
            return
          const targetVar = targetNode.vars.find(varItem => varItem.id === varId)
          if (!targetVar)
            return
          targetVar.name = selector[1]
          targetVar.selector = selector
        },
        )
        return {
          nodesWithInspectVars: nodes,
        }
      })
    },
    deleteInspectVar: (nodeId, varId) => {
      set((state: InspectVarsSliceShape) => {
        const nodes = produce(state.nodesWithInspectVars, (draft) => {
          const targetNode = draft.find(node => node.nodeId === nodeId)
          if (!targetNode)
            return
          const needChangeVarIndex = targetNode.vars.findIndex(varItem => varItem.id === varId)
          if (needChangeVarIndex !== -1)
            targetNode.vars.splice(needChangeVarIndex, 1)
        },
        )
        return {
          nodesWithInspectVars: nodes,
        }
      })
    },
  })
}
