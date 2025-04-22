import type { NodeTracing } from '@/types/workflow'
import type { StateCreator } from 'zustand'

type NodeInfo = NodeTracing

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
    nodes: [],
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
      return nodes.find(node => node.node_id === nodeId)
    },
    getLastRunVar: (nodeId, key) => {
      const node = get().getLastRunNodeInfo(nodeId)
      if (!node)
        return undefined

      const varItem = node
      if (!varItem)
        return undefined

      return varItem.outputs?.[key]
    },
  })
}
