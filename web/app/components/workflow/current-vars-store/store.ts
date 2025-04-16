import { useContext } from 'react'
import { createStore, useStore } from 'zustand'
import { CurrentVarsContext } from './provider'
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
  nodes: NodeVars[]
}

type CurrentVarsActions = {
  setVars: (vars: NodeVars[]) => void
  getVars: () => NodeVars[]
  clearVars: () => void
  setNodeVars: (nodeId: string, payload: NodeVars) => void
  clearNodeVars: (nodeId: string) => void
  getNodeVars: (nodeId: string) => NodeVars | undefined
  hasNodeVars: (nodeId: string) => boolean
  setVar: (nodeId: string, key: string, value: any) => void
  getVar: (nodeId: string, key: string) => any
}

type CurrentVarsStore = CurrentVarsState & CurrentVarsActions

export const createCurrentVarsStore = () => {
  return createStore<CurrentVarsStore>((set, get) => ({
    nodes: [{
      id: '',
      name: '',
      type: '',
      vars: [],
    }],
    setVars: (vars) => {
      set(() => ({
        nodes: vars,
      }))
    },
    getVars: () => {
      return get().nodes
    },
    clearVars: () => {
      set(() => ({
        nodes: [],
      }))
    },
    setNodeVars: (nodeId, vars) => {
      set((state) => {
        // eslint-disable-next-line sonarjs/no-nested-functions
        const nodes = state.nodes.map((node) => {
          if (node.id === nodeId) {
            return produce(node, (draft) => {
              draft.vars = vars.vars
            })
          }

          return node
        })
        return {
          nodes,
        }
      })
    },
    clearNodeVars: (nodeId) => {
      set(produce((state: CurrentVarsStore) => {
        // eslint-disable-next-line sonarjs/no-nested-functions
        const nodes = state.nodes.filter(node => node.id !== nodeId)
        state.nodes = nodes
      },
      ))
    },
    getNodeVars: (nodeId) => {
      const nodes = get().nodes
      return nodes.find(node => node.id === nodeId)
    },
    hasNodeVars: (nodeId) => {
      return !!get().getNodeVars(nodeId)
    },
    setVar: (nodeId, key, value) => {
      set(produce((state: CurrentVarsStore) => {
        // eslint-disable-next-line sonarjs/no-nested-functions
        const nodes = state.nodes.map((node) => {
          if (node.id === nodeId) {
            return produce(node, (draft) => {
              const index = draft.vars.findIndex(v => v.key === key)
              if (index !== -1)
                draft.vars[index].value = value
            })
          }
          return node
        })
        state.nodes = nodes
      }))
    },
    getVar(nodeId, key) {
      const node = get().getNodeVars(nodeId)
      if (!node)
        return undefined

      const variable = node.vars.find(v => v.key === key)
      if (!variable)
        return undefined

      return variable.value
    },
  }))
}

export const useCurrentVarsStore = <T>(selector: (state: CurrentVarsStore) => T): T => {
  const store = useContext(CurrentVarsContext)
  if (!store)
    throw new Error('Missing CurrentVarsContext.Provider in the tree')

  return useStore(store, selector)
}
