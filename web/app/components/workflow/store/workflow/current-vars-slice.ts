import type { StateCreator } from 'zustand'
import produce from 'immer'
import type { NodeTracing } from '@/types/workflow'

// TODO: Missing var type
type NodeVars = NodeTracing

type CurrentVarsState = {
  currentNodes: NodeVars[]
}

type CurrentVarsActions = {
  setCurrentVars: (vars: NodeVars[]) => void
  getCurrentVars: () => NodeVars[]
  clearCurrentVars: () => void
  setCurrentNodeVars: (nodeId: string, payload: NodeVars) => void
  clearCurrentNodeVars: (nodeId: string) => void
  getCurrentNodeVars: (nodeId: string) => NodeVars | undefined
  hasCurrentNodeVars: (nodeId: string) => boolean
  setCurrentVar: (nodeId: string, key: string, value: any) => void
  getCurrentVar: (nodeId: string, key: string) => any
}

export type CurrentVarsSliceShape = CurrentVarsState & CurrentVarsActions

export const createCurrentVarsSlice: StateCreator<CurrentVarsSliceShape> = (set, get) => {
  return ({
    currentNodes: [],
    setCurrentVars: (vars) => {
      set(() => ({
        currentNodes: vars,
      }))
    },
    getCurrentVars: () => {
      return get().currentNodes
    },
    clearCurrentVars: () => {
      set(() => ({
        currentNodes: [],
      }))
    },
    setCurrentNodeVars: (nodeId, payload) => {
      set((state) => {
        const nodes = state.currentNodes.map((node) => {
          // eslint-disable-next-line curly
          if (node.node_id === nodeId) {
            return payload
          }

          return node
        })
        return {
          currentNodes: nodes,
        }
      })
    },
    clearCurrentNodeVars: (nodeId) => {
      set(produce((state: CurrentVarsSliceShape) => {
        const nodes = state.currentNodes.filter(node => node.node_id !== nodeId)
        state.currentNodes = nodes
      },
      ))
    },
    getCurrentNodeVars: (nodeId) => {
      const nodes = get().currentNodes
      return nodes.find(node => node.node_id === nodeId)
    },
    hasCurrentNodeVars: (nodeId) => {
      return !!get().getCurrentNodeVars(nodeId)
    },
    setCurrentVar: (nodeId, key, value) => {
      set(produce((state: CurrentVarsSliceShape) => {
        const nodes = state.currentNodes.map((node) => {
          if (node.id === nodeId) {
            return produce(node, (draft) => {
              if (!draft.outputs)
                draft.outputs = {}
              draft.outputs[key] = value
            })
          }
          return node
        })
        state.currentNodes = nodes
      }))
    },
    getCurrentVar(nodeId, key) {
      const node = get().getCurrentNodeVars(nodeId)
      if (!node)
        return undefined

      const variable = node.outputs?.[key]
      return variable
    },
  })
}
