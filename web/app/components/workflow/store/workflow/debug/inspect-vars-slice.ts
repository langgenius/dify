import type { StateCreator } from 'zustand'
import produce from 'immer'
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
  getAllInspectVars: () => NodeWithVar[]
  setNodeInspectVars: (nodeId: string, payload: NodeWithVar) => void
  deleteNodeInspectVars: (nodeId: string) => void
  getNodeInspectVars: (nodeId: string) => NodeWithVar | undefined
  hasNodeInspectVars: (nodeId: string) => boolean
  setInspectVarValue: (nodeId: string, name: string, value: any) => void
  renameInspectVarName: (nodeId: string, varId: string, selector: ValueSelector) => void
  deleteInspectVar: (nodeId: string, varId: string) => void
  getInspectVar: (nodeId: string, name: string) => any // The big value is null
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
    getAllInspectVars: () => {
      return get().nodesWithInspectVars
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
          if (index === -1)
            draft.push(payload)
          else
            draft[index] = payload
        })

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
    getNodeInspectVars: (nodeId) => {
      const nodes = get().nodesWithInspectVars
      return nodes.find(node => node.nodeId === nodeId)
    },
    hasNodeInspectVars: (nodeId) => {
      return !!get().getNodeInspectVars(nodeId)
    },
    setInspectVarValue: (nodeId, varId, value) => {
      set(produce((state: InspectVarsSliceShape) => {
        const nodes = state.nodesWithInspectVars.map((node) => {
          if (node.nodeId === nodeId) {
            return produce(node, (draft) => {
              const needChangeVarIndex = draft.vars.findIndex((varItem) => {
                return varItem.id === varId
              })
              if (needChangeVarIndex !== -1)
                draft.vars[needChangeVarIndex].value = value
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
    getInspectVar(nodeId, name) {
      const node = get().getNodeInspectVars(nodeId)
      if (!node)
        return undefined

      const variable = node.vars.find((varItem) => {
        return varItem.selector[1] === name
      })?.value
      return variable
    },
  })
}
