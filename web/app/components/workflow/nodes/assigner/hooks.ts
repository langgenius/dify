import type { Node, Var } from '../../types'
import { uniqBy } from 'es-toolkit/compat'
import { useAtomValue } from 'jotai'
import { useCallback } from 'react'
import { useNodes } from 'reactflow'
import { isChatflowAtom } from '@/app/components/workflow/editor-resource/state'
import { useWorkflow } from '../../hooks/use-workflow'
import { useWorkflowVariables } from '../../hooks/use-workflow-variables'
import { AssignerNodeInputType, WriteMode } from './types'

export const useGetAvailableVars = () => {
  const nodes: Node[] = useNodes()
  const { getBeforeNodesInSameBranchIncludeParent } = useWorkflow()
  const { getNodeAvailableVars } = useWorkflowVariables()
  const isChatflow = useAtomValue(isChatflowAtom)
  const getAvailableVars = useCallback(
    (nodeId: string, handleId: string, filterVar: (v: Var) => boolean, hideEnv = false) => {
      const availableNodes: Node[] = []
      const currentNode = nodes.find((node) => node.id === nodeId)!

      if (!currentNode) return []

      const beforeNodes = getBeforeNodesInSameBranchIncludeParent(nodeId)
      availableNodes.push(...beforeNodes)
      const parentNode = nodes.find((node) => node.id === currentNode.parentId)

      if (hideEnv) {
        return getNodeAvailableVars({
          parentNode,
          beforeNodes: uniqBy(availableNodes, 'id').filter((node) => node.id !== nodeId),
          isChatflow,
          hideEnv,
          hideChatVar: hideEnv,
          filterVar,
        })
          .map((node) => ({
            ...node,
            vars: node.isStartNode
              ? node.vars.filter((v) => !v.variable.startsWith('sys.'))
              : node.vars,
          }))
          .filter((item) => item.vars.length > 0)
      }

      return getNodeAvailableVars({
        parentNode,
        beforeNodes: uniqBy(availableNodes, 'id').filter((node) => node.id !== nodeId),
        isChatflow,
        filterVar,
      })
    },
    [nodes, getBeforeNodesInSameBranchIncludeParent, getNodeAvailableVars, isChatflow],
  )

  return getAvailableVars
}

export const useHandleAddOperationItem = () => {
  return useCallback((list: any[]) => {
    const newItem = {
      variable_selector: [],
      write_mode: WriteMode.overwrite,
      input_type: AssignerNodeInputType.variable,
      value: '',
    }
    return [...list, newItem]
  }, [])
}
