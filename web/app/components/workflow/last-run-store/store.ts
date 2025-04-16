import { useContext } from 'react'
import { createStore, useStore } from 'zustand'
import { LastRunContext } from './provider'

type NodeInfo = {
  id: string
  name: string
  type: string
  vars: {
    key: string
    type: string
    value: any
  }[]
} & {
  input: Record<string, any>
  output: Record<string, any>
}

type LastRunState = {
  nodes: NodeInfo[]
}

type LastRunActions = {
  setInfos: (vars: NodeInfo[]) => void
  getInfos: () => NodeInfo[]
  getNodeInfo: (nodeId: string) => NodeInfo | undefined
  getVar: (nodeId: string, key: string) => any
}

type LastRunStore = LastRunState & LastRunActions

export const createLastRunStore = () => {
  return createStore<LastRunStore>((set, get) => ({
    nodes: [{
      id: '',
      name: '',
      type: '',
      vars: [],
      input: {},
      output: {},
    }],
    setInfos: (vars) => {
      set(() => ({
        nodes: vars,
      }))
    },
    getInfos: () => {
      return get().nodes
    },
    clearVars: () => {
      set(() => ({
        nodes: [],
      }))
    },
    getNodeInfo: (nodeId) => {
      const nodes = get().nodes
      return nodes.find(node => node.id === nodeId)
    },
    getVar: (nodeId, key) => {
      const node = get().getNodeInfo(nodeId)
      if (!node)
        return undefined

      const varItem = node.vars.find(v => v.key === key)
      if (!varItem)
        return undefined

      return varItem.value
    },
  }))
}

export const useLastRunStore = <T>(selector: (state: LastRunStore) => T): T => {
  const store = useContext(LastRunContext)
  if (!store)
    throw new Error('Missing LastRunContext.Provider in the tree')

  return useStore(store, selector)
}
