import type { StateCreator } from 'zustand'
import produce from 'immer'
import type { NodeWithVar, VarInInspect } from '@/types/workflow'
import type { ValueSelector } from '../../types'

type InspectVarsState = {
  currentFocusNodeId: string | null
  nodes: NodeWithVar[] // the nodes have data
  conversationVars: VarInInspect[]
}

type InspectVarsActions = {
  getAllInspectVars: () => NodeWithVar[]
  clearInspectVars: () => void
  setNodeInspectVars: (nodeId: string, payload: NodeWithVar) => void
  clearNodeInspectVars: (nodeId: string) => void
  getNodeInspectVars: (nodeId: string) => NodeWithVar | undefined
  hasNodeInspectVars: (nodeId: string) => boolean
  setInspectVar: (nodeId: string, selector: ValueSelector, value: any) => void
  getInspectVar: (nodeId: string, selector: ValueSelector) => any
}

export type CurrentVarsSliceShape = InspectVarsState & InspectVarsActions

export const createInspectVarsSlice: StateCreator<CurrentVarsSliceShape> = (set, get) => {
  return ({
    currentFocusNodeId: null,
    nodes: [],
    conversationVars: [],
    getAllInspectVars: () => {
      return get().nodes
    },
    clearInspectVars: () => {
      set(() => ({
        nodes: [],
      }))
    },
    setNodeInspectVars: (nodeId, payload) => {
      set((state) => {
        const prevNodes = state.nodes
        const nodes = produce(prevNodes, (draft) => {
          const index = prevNodes.findIndex(node => node.nodeId === nodeId)
          if (index === -1)
            draft.push(payload)
          else
            draft[index] = payload
        })

        return {
          nodes,
        }
      })
    },
    clearNodeInspectVars: (nodeId) => {
      set(produce((state: CurrentVarsSliceShape) => {
        const nodes = state.nodes.filter(node => node.nodeId !== nodeId)
        state.nodes = nodes
      },
      ))
    },
    getNodeInspectVars: (nodeId) => {
      const nodes = get().nodes
      return nodes.find(node => node.nodeId === nodeId)
    },
    hasNodeInspectVars: (nodeId) => {
      return !!get().getNodeInspectVars(nodeId)
    },
    setInspectVar: (nodeId, selector, value) => {
      set(produce((state: CurrentVarsSliceShape) => {
        const nodes = state.nodes.map((node) => {
          if (node.nodeId === nodeId) {
            return produce(node, (draft) => {
              const needChangeVarIndex = draft.vars.findIndex((varItem) => {
                return varItem.selector.join('.') === selector.join('.')
              })
              if (needChangeVarIndex !== -1)
                draft.vars[needChangeVarIndex].value = value
            })
          }
          return node
        })
        state.nodes = nodes
      }))
    },
    getInspectVar(nodeId, key) {
      const node = get().getNodeInspectVars(nodeId)
      if (!node)
        return undefined

      const variable = node.vars.find((varItem) => {
        return varItem.selector.join('.') === key.join('.')
      })?.value
      return variable
    },
  })
}
