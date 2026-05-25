import type { Node, NodeOutPutVar, ValueSelector, Var } from '@/app/components/workflow/types'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useSnippetDetailStore } from '@/app/components/snippets/store'
import {
  useIsChatMode,
  useWorkflow,
  useWorkflowVariables,
} from '@/app/components/workflow/hooks'
import {
  appendSnippetInputFieldVars,
} from '@/app/components/workflow/nodes/_base/hooks/snippet-input-field-vars'
import { BlockEnum } from '@/app/components/workflow/types'

type Params = {
  onlyLeafNodeVar?: boolean
  hideEnv?: boolean
  hideChatVar?: boolean
  filterVar: (payload: Var, selector: ValueSelector) => boolean
  passedInAvailableNodes?: Node[]
}

const getNodeInfo = (nodeId: string, nodes: Node[]) => {
  const allNodes = nodes
  const node = allNodes.find(n => n.id === nodeId)
  const isInIteration = !!node?.data.isInIteration
  const isInLoop = !!node?.data.isInLoop
  const parentNodeId = node?.parentId
  const parentNode = allNodes.find(n => n.id === parentNodeId)
  return {
    node,
    isInIteration,
    isInLoop,
    parentNode,
  }
}

// TODO: loop type?
const useNodesAvailableVarList = (nodes: Node[], {
  onlyLeafNodeVar,
  filterVar,
  hideEnv = false,
  hideChatVar = false,
  passedInAvailableNodes,
}: Params = {
  onlyLeafNodeVar: false,
  filterVar: () => true,
}) => {
  const { t } = useTranslation()
  const snippetInputFields = useSnippetDetailStore(s => s.fields)
  const { getTreeLeafNodes, getBeforeNodesInSameBranchIncludeParent } = useWorkflow()
  const { getNodeAvailableVars } = useWorkflowVariables()
  const isChatMode = useIsChatMode()

  const nodeAvailabilityMap: { [key: string ]: { availableVars: NodeOutPutVar[], availableNodes: Node[] } } = {}

  nodes.forEach((node) => {
    const nodeId = node.id
    const availableNodes = passedInAvailableNodes || (onlyLeafNodeVar ? getTreeLeafNodes(nodeId) : getBeforeNodesInSameBranchIncludeParent(nodeId))
    if (node.data.type === BlockEnum.Loop)
      availableNodes.push(node)
    const snippetInputFieldAvailability = appendSnippetInputFieldVars({
      availableNodes,
      fields: snippetInputFields,
      title: t('panelTitle', { ns: 'snippet' }),
    })

    const {
      parentNode: iterationNode,
    } = getNodeInfo(nodeId, nodes)

    const availableVars = [
      ...snippetInputFieldAvailability.availableVars,
      ...getNodeAvailableVars({
        parentNode: iterationNode,
        beforeNodes: availableNodes,
        isChatMode,
        filterVar,
        hideEnv,
        hideChatVar,
      }),
    ]
    const result = {
      node,
      availableVars,
      availableNodes: snippetInputFieldAvailability.availableNodes,
    }
    nodeAvailabilityMap[nodeId] = result
  })
  return nodeAvailabilityMap
}

export const useGetNodesAvailableVarList = () => {
  const { t } = useTranslation()
  const snippetInputFields = useSnippetDetailStore(s => s.fields)
  const { getTreeLeafNodes, getBeforeNodesInSameBranchIncludeParent } = useWorkflow()
  const { getNodeAvailableVars } = useWorkflowVariables()
  const isChatMode = useIsChatMode()
  const getNodesAvailableVarList = useCallback((nodes: Node[], {
    onlyLeafNodeVar,
    filterVar,
    hideEnv,
    hideChatVar,
    passedInAvailableNodes,
  }: Params = {
    onlyLeafNodeVar: false,
    filterVar: () => true,
  }) => {
    const nodeAvailabilityMap: { [key: string ]: { availableVars: NodeOutPutVar[], availableNodes: Node[] } } = {}

    nodes.forEach((node) => {
      const nodeId = node.id
      const availableNodes = passedInAvailableNodes || (onlyLeafNodeVar ? getTreeLeafNodes(nodeId) : getBeforeNodesInSameBranchIncludeParent(nodeId))
      if (node.data.type === BlockEnum.Loop)
        availableNodes.push(node)
      const snippetInputFieldAvailability = appendSnippetInputFieldVars({
        availableNodes,
        fields: snippetInputFields,
        title: t('panelTitle', { ns: 'snippet' }),
      })

      const {
        parentNode: iterationNode,
      } = getNodeInfo(nodeId, nodes)

      const availableVars = [
        ...snippetInputFieldAvailability.availableVars,
        ...getNodeAvailableVars({
          parentNode: iterationNode,
          beforeNodes: availableNodes,
          isChatMode,
          filterVar,
          hideEnv,
          hideChatVar,
        }),
      ]
      const result = {
        node,
        availableVars,
        availableNodes: snippetInputFieldAvailability.availableNodes,
      }
      nodeAvailabilityMap[nodeId] = result
    })
    return nodeAvailabilityMap
  }, [getTreeLeafNodes, getBeforeNodesInSameBranchIncludeParent, getNodeAvailableVars, isChatMode, snippetInputFields, t])
  return {
    getNodesAvailableVarList,
  }
}

export default useNodesAvailableVarList
