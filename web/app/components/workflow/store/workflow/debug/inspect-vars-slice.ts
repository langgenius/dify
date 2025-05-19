import type { StateCreator } from 'zustand'
import produce from 'immer'
import type { NodeWithVar, VarInInspect } from '@/types/workflow'
import type { ValueSelector } from '../../../types'
import type { Node } from '@/app/components/workflow/types'
import { isConversationVar, isENV, isSystemVar } from '../../../nodes/_base/components/variable/utils'

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
  setNodeInspectVars: (nodeId: string, payload: VarInInspect[]) => void
  appendNodeInspectVars: (nodeId: string, payload: VarInInspect[], allNodes: Node[]) => void
  deleteNodeInspectVars: (nodeId: string) => void
  getNodeInspectVars: (nodeId: string) => NodeWithVar | undefined
  hasNodeInspectVars: (nodeId: string) => boolean
  getVarId: (nodeId: string, varName: string) => string | undefined
  setInspectVarValue: (nodeId: string, name: string, value: any) => void
  renameInspectVarName: (nodeId: string, varId: string, selector: ValueSelector) => void
  deleteInspectVar: (nodeId: string, varId: string) => void
  getInspectVar: (nodeId: string, name: string) => any
  hasSetInspectVar: (nodeId: string, name: string, sysVars: VarInInspect[], conversationVars: VarInInspect[]) => boolean
  isInspectVarEdited: (nodeId: string, name: string) => boolean
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
    getNodeInspectVars: (nodeId) => {
      const nodes = get().nodesWithInspectVars
      return nodes.find(node => node.nodeId === nodeId)
    },
    hasNodeInspectVars: (nodeId) => {
      return !!get().getNodeInspectVars(nodeId)
    },
    getVarId: (nodeId: string, varName: string) => {
      const node = get().getNodeInspectVars(nodeId)
      if (!node)
        return undefined
      const varId = node.vars.find((varItem) => {
        return varItem.selector[1] === varName
      })?.id
      return varId
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
    getInspectVar: (nodeId, name) => {
      const node = get().getNodeInspectVars(nodeId)
      if (!node)
        return undefined

      const variable = node.vars.find((varItem) => {
        return varItem.selector[1] === name
      })?.value
      return variable
    },
    hasSetInspectVar: (nodeId, name, sysVars, conversationVars) => {
      const isEnv = isENV([nodeId])
      if (isEnv) // always have value
        return true
      const isSys = isSystemVar([nodeId])
      if (isSys)
        return sysVars.some(varItem => varItem.selector?.[1] === name)
      const isChatVar = isConversationVar([nodeId])
      if (isChatVar)
        return conversationVars.some(varItem => varItem.selector?.[1] === name)
      return get().getInspectVar(nodeId, name) !== undefined
    },
    isInspectVarEdited: (nodeId, name) => {
      const inspectVar = get().getInspectVar(nodeId, name)
      if (!inspectVar)
        return false

      return inspectVar.edited
    },
  })
}
