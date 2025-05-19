import type { StateCreator } from 'zustand'
import produce from 'immer'
import type { NodeWithVar, VarInInspect } from '@/types/workflow'
import type { ValueSelector } from '../../../types'
import type { Node } from '@/app/components/workflow/types'

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
  appendNodeInspectVars: (nodeId: string, payload: VarInInspect[], allNodes: Node[]) => void
  deleteNodeInspectVars: (nodeId: string) => void
  setInspectVarValue: (nodeId: string, name: string, value: any) => void
  renameInspectVarName: (nodeId: string, varId: string, selector: ValueSelector) => void
  deleteInspectVar: (nodeId: string, varId: string) => void
}

export type InspectVarsSliceShape = InspectVarsState & InspectVarsActions

export const createInspectVarsSlice: StateCreator<InspectVarsSliceShape> = (set, get) => {
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
    // after last run would call this
    appendNodeInspectVars: (nodeId, payload, allNodes) => {
      set((state) => {
        const nodes = state.nodesWithInspectVars
        const nodeInfo = allNodes.find(node => node.id === nodeId)
        if (nodeInfo) {
          const index = nodes.findIndex(node => node.nodeId === nodeId)
          if (index === -1) {
            nodes.push({
              nodeId,
              nodeType: nodeInfo.data.type,
              title: nodeInfo.data.title,
              vars: payload,
            })
          }
          else {
            nodes[index].vars = payload
          }
        }
        return {
          nodesWithInspectVars: nodes,
        }
      })
    },
    deleteNodeInspectVars: (nodeId) => {
      set(produce((state: InspectVarsSliceShape) => {
        const nodes = state.nodesWithInspectVars.filter(node => node.nodeId !== nodeId)
        state.nodesWithInspectVars = nodes
      },
      ))
    },
    setInspectVarValue: (nodeId, varId, value) => {
      set(produce((state: InspectVarsSliceShape) => {
        const nodes = state.nodesWithInspectVars.map((node) => {
          if (node.nodeId === nodeId) {
            return produce(node, (draft) => {
              const needChangeVarIndex = draft.vars.findIndex((varItem) => {
                return varItem.id === varId
              })
              if (needChangeVarIndex !== -1) {
                draft.vars[needChangeVarIndex].value = value
                draft.vars[needChangeVarIndex].edited = true
              }
            })
          }
          return node
        })
        state.nodesWithInspectVars = nodes
      }))
    },
    renameInspectVarName: (nodeId, varId, selector) => {
      set(produce((state: InspectVarsSliceShape) => {
        const nodes = state.nodesWithInspectVars.map((node) => {
          if (node.nodeId === nodeId) {
            return produce(node, (draft) => {
              const needChangeVarIndex = draft.vars.findIndex((varItem) => {
                return varItem.id === varId
              })
              if (needChangeVarIndex !== -1)
                draft.vars[needChangeVarIndex].selector = selector
            })
          }
          return node
        })
        state.nodesWithInspectVars = nodes
      }))
    },
    deleteInspectVar: (nodeId, varId) => {
      set(produce((state: InspectVarsSliceShape) => {
        const nodes = state.nodesWithInspectVars.map((node) => {
          if (node.nodeId === nodeId) {
            return produce(node, (draft) => {
              const needChangeVarIndex = draft.vars.findIndex((varItem) => {
                return varItem.id === varId
              })
              if (needChangeVarIndex !== -1)
                draft.vars.splice(needChangeVarIndex, 1)
            })
          }
          return node
        })
        state.nodesWithInspectVars = nodes
      }))
    },
  })
}
