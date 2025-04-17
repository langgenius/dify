import type { StateCreator } from 'zustand'

import produce from 'immer'

type NodeVars = {
  id: string
  name: string
  type: string
  vars: {
    key: string
    type: string
    value: any
  }[]
}

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
    currentNodes: [{
      id: 'abc',
      name: '',
      type: '',
      vars: [],
    }],
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
    setCurrentNodeVars: (nodeId, vars) => {
      set((state) => {
        const nodes = state.currentNodes.map((node) => {
          if (node.id === nodeId) {
            return produce(node, (draft) => {
              draft.vars = vars.vars
            })
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
        const nodes = state.currentNodes.filter(node => node.id !== nodeId)
        state.currentNodes = nodes
      },
      ))
    },
    getCurrentNodeVars: (nodeId) => {
      const nodes = get().currentNodes
      return nodes.find(node => node.id === nodeId)
    },
    hasCurrentNodeVars: (nodeId) => {
      return !!get().getCurrentNodeVars(nodeId)
    },
    setCurrentVar: (nodeId, key, value) => {
      set(produce((state: CurrentVarsSliceShape) => {
        const nodes = state.currentNodes.map((node) => {
          if (node.id === nodeId) {
            return produce(node, (draft) => {
              const index = draft.vars.findIndex(v => v.key === key)
              if (index !== -1)
                draft.vars[index].value = value
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

      const variable = node.vars.find(v => v.key === key)
      if (!variable)
        return undefined

      return variable.value
    },
  })
}
