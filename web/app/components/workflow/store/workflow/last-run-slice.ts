import type { NodeTracing } from '@/types/workflow'
import produce from 'immer'
import type { StateCreator } from 'zustand'

type NodeInfo = NodeTracing

type LastRunState = {
  nodes: NodeInfo[]
}

type LastRunActions = {
  setLastRunInfos: (vars: NodeInfo[]) => void
  getLastRunInfos: () => NodeInfo[]
  setLastRunNodeInfo: (nodeId: string, payload: NodeInfo) => void
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
    setLastRunNodeInfo: (nodeId, payload) => {
      set((state) => {
        const prevNodes = state.nodes
        const nodes = produce(prevNodes, (draft) => {
          const index = prevNodes.findIndex(node => node.id === nodeId)
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
