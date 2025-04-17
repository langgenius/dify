import type { StateCreator } from 'zustand'

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
  setLastRunInfos: (vars: NodeInfo[]) => void
  getLastRunInfos: () => NodeInfo[]
  getLastRunNodeInfo: (nodeId: string) => NodeInfo | undefined
  getLastRunVar: (nodeId: string, key: string) => any
}

export type LastRunSliceShape = LastRunState & LastRunActions

export const createLastRunSlice: StateCreator<LastRunSliceShape> = (set, get) => {
  return ({
    nodes: [{
      id: 'test',
      name: '',
      type: '',
      vars: [],
      input: {},
      output: {},
    }],
    setLastRunInfos: (vars) => {
      set(() => ({
        nodes: vars,
      }))
    },
    getLastRunInfos: () => {
      return get().nodes
    },
    clearVars: () => {
      set(() => ({
        nodes: [],
      }))
    },
    getLastRunNodeInfo: (nodeId) => {
      const nodes = get().nodes
      return nodes.find(node => node.id === nodeId)
    },
    getLastRunVar: (nodeId, key) => {
      const node = get().getLastRunNodeInfo(nodeId)
      if (!node)
        return undefined

      const varItem = node.vars.find(v => v.key === key)
      if (!varItem)
        return undefined

      return varItem.value
    },
  })
}
