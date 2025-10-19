import useNodeInfo from './use-node-info'
import {
  useIsChatMode,
  useWorkflow,
  useWorkflowVariables,
} from '@/app/components/workflow/hooks'
import type { NodeOutPutVar } from '@/app/components/workflow/types'
import { BlockEnum, type Node, type ValueSelector, type Var } from '@/app/components/workflow/types'
import { useStore as useWorkflowStore } from '@/app/components/workflow/store'
import { inputVarTypeToVarType } from '../../data-source/utils'

type Params = {
  onlyLeafNodeVar?: boolean
  hideEnv?: boolean
  hideChatVar?: boolean
  filterVar: (payload: Var, selector: ValueSelector) => boolean
  passedInAvailableNodes?: Node[]
}

// TODO: loop type?
const useAvailableVarList = (nodeId: string, {
  onlyLeafNodeVar,
  filterVar,
  hideEnv,
  hideChatVar,
  passedInAvailableNodes,
}: Params = {
  onlyLeafNodeVar: false,
  filterVar: () => true,
}) => {
  const { getTreeLeafNodes, getNodeById, getBeforeNodesInSameBranchIncludeParent } = useWorkflow()
  const { getNodeAvailableVars } = useWorkflowVariables()
  const isChatMode = useIsChatMode()
  const availableNodes = passedInAvailableNodes || (onlyLeafNodeVar ? getTreeLeafNodes(nodeId) : getBeforeNodesInSameBranchIncludeParent(nodeId))
  const {
    parentNode: iterationNode,
  } = useNodeInfo(nodeId)

  const currNode = getNodeById(nodeId)
  const ragPipelineVariables = useWorkflowStore(s => s.ragPipelineVariables)
  const isDataSourceNode = currNode?.data?.type === BlockEnum.DataSource
  const dataSourceRagVars: NodeOutPutVar[] = []
  if (isDataSourceNode) {
    const ragVariablesInDataSource = ragPipelineVariables?.filter(ragVariable => ragVariable.belong_to_node_id === nodeId)
    const filterVars = ragVariablesInDataSource?.filter(v => filterVar({
      variable: v.variable,
      type: inputVarTypeToVarType(v.type),
      nodeId,
      isRagVariable: true,
    }, ['rag', nodeId, v.variable]))
    if (filterVars?.length) {
      dataSourceRagVars.push({
        nodeId,
        title: currNode.data?.title,
        vars: filterVars.map((v) => {
          return {
            variable: `rag.${nodeId}.${v.variable}`,
            type: inputVarTypeToVarType(v.type),
            description: v.label,
            isRagVariable: true,
          } as Var
        }),
      })
    }
  }
  const availableVars = [...getNodeAvailableVars({
    parentNode: iterationNode,
    beforeNodes: availableNodes,
    isChatMode,
    filterVar,
    hideEnv,
    hideChatVar,
  }), ...dataSourceRagVars]

  return {
    availableVars,
    availableNodes,
    availableNodesWithParent: [
      ...availableNodes,
      ...(isDataSourceNode ? [currNode] : []),
    ],
  }
}

export default useAvailableVarList
