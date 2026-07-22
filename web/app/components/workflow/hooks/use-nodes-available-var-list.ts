import type { Node, NodeOutPutVar, ValueSelector, Var } from '@/app/components/workflow/types'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useSnippetDraftStore } from '@/app/components/snippets/draft-store'
import { useIsChatMode, useWorkflow, useWorkflowVariables } from '@/app/components/workflow/hooks'
import { useHooksStore } from '@/app/components/workflow/hooks-store/store'
import {
  appendSnippetInputFieldVars,
  filterSnippetSystemVars,
  isSnippetCanvas,
} from '@/app/components/workflow/nodes/_base/hooks/snippet-input-field-vars'
import { BlockEnum } from '@/app/components/workflow/types'
import { FlowType } from '@/types/common'

type Params = {
  onlyLeafNodeVar?: boolean
  hideEnv?: boolean
  hideChatVar?: boolean
  filterVar: (payload: Var, selector: ValueSelector) => boolean
  passedInAvailableNodes?: Node[]
}

const getNodeInfo = (nodeId: string, nodes: Node[]) => {
  const allNodes = nodes
  const node = allNodes.find((n) => n.id === nodeId)
  const isInIteration = !!node?.data.isInIteration
  const isInLoop = !!node?.data.isInLoop
  const parentNodeId = node?.parentId
  const parentNode = allNodes.find((n) => n.id === parentNodeId)
  return {
    node,
    isInIteration,
    isInLoop,
    parentNode,
  }
}

// TODO: loop type?
const useNodesAvailableVarList = (
  nodes: Node[],
  {
    onlyLeafNodeVar,
    filterVar,
    hideEnv = false,
    hideChatVar = false,
    passedInAvailableNodes,
  }: Params = {
    onlyLeafNodeVar: false,
    filterVar: () => true,
  },
) => {
  const { t } = useTranslation()
  const snippetInputFields = useSnippetDraftStore((s) => s.inputFields)
  const { getTreeLeafNodes, getBeforeNodesInSameBranchIncludeParent } = useWorkflow()
  const { getNodeAvailableVars } = useWorkflowVariables()
  const isChatMode = useIsChatMode()
  const isSnippetFlow =
    useHooksStore((s) => s.configsMap?.flowType) === FlowType.snippet || isSnippetCanvas()

  const nodeAvailabilityMap: {
    [key: string]: { availableVars: NodeOutPutVar[]; availableNodes: Node[] }
  } = {}

  nodes.forEach((node) => {
    const nodeId = node.id
    const availableNodes =
      passedInAvailableNodes ||
      (onlyLeafNodeVar ? getTreeLeafNodes(nodeId) : getBeforeNodesInSameBranchIncludeParent(nodeId))
    if (node.data.type === BlockEnum.Loop) availableNodes.push(node)
    const snippetInputFieldAvailability = appendSnippetInputFieldVars({
      availableNodes,
      fields: snippetInputFields,
      title: t(($) => $.panelTitle, { ns: 'snippet' }),
    })

    const { parentNode: iterationNode } = getNodeInfo(nodeId, nodes)

    const availableVars = filterSnippetSystemVars(
      [
        ...snippetInputFieldAvailability.availableVars,
        ...getNodeAvailableVars({
          parentNode: iterationNode,
          beforeNodes: availableNodes,
          isChatMode,
          filterVar,
          hideEnv,
          hideChatVar,
        }),
      ],
      isSnippetFlow,
    )
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
  const snippetInputFields = useSnippetDraftStore((s) => s.inputFields)
  const { getTreeLeafNodes, getBeforeNodesInSameBranchIncludeParent } = useWorkflow()
  const { getNodeAvailableVars } = useWorkflowVariables()
  const isChatMode = useIsChatMode()
  const isSnippetFlow =
    useHooksStore((s) => s.configsMap?.flowType) === FlowType.snippet || isSnippetCanvas()
  const getNodesAvailableVarList = useCallback(
    (
      nodes: Node[],
      { onlyLeafNodeVar, filterVar, hideEnv, hideChatVar, passedInAvailableNodes }: Params = {
        onlyLeafNodeVar: false,
        filterVar: () => true,
      },
    ) => {
      const nodeAvailabilityMap: {
        [key: string]: { availableVars: NodeOutPutVar[]; availableNodes: Node[] }
      } = {}

      nodes.forEach((node) => {
        const nodeId = node.id
        const availableNodes =
          passedInAvailableNodes ||
          (onlyLeafNodeVar
            ? getTreeLeafNodes(nodeId)
            : getBeforeNodesInSameBranchIncludeParent(nodeId))
        if (node.data.type === BlockEnum.Loop) availableNodes.push(node)
        const snippetInputFieldAvailability = appendSnippetInputFieldVars({
          availableNodes,
          fields: snippetInputFields,
          title: t(($) => $.panelTitle, { ns: 'snippet' }),
        })

        const { parentNode: iterationNode } = getNodeInfo(nodeId, nodes)

        const availableVars = filterSnippetSystemVars(
          [
            ...snippetInputFieldAvailability.availableVars,
            ...getNodeAvailableVars({
              parentNode: iterationNode,
              beforeNodes: availableNodes,
              isChatMode,
              filterVar,
              hideEnv,
              hideChatVar,
            }),
          ],
          isSnippetFlow,
        )
        const result = {
          node,
          availableVars,
          availableNodes: snippetInputFieldAvailability.availableNodes,
        }
        nodeAvailabilityMap[nodeId] = result
      })
      return nodeAvailabilityMap
    },
    [
      getTreeLeafNodes,
      getBeforeNodesInSameBranchIncludeParent,
      getNodeAvailableVars,
      isChatMode,
      isSnippetFlow,
      snippetInputFields,
      t,
    ],
  )
  return {
    getNodesAvailableVarList,
  }
}

export default useNodesAvailableVarList
