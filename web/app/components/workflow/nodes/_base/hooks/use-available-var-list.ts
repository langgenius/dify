import { useTranslation } from 'react-i18next'
import useNodeInfo from './use-node-info'
import {
  useIsChatMode,
  useWorkflow,
} from '@/app/components/workflow/hooks'
import { toNodeAvailableVars } from '@/app/components/workflow/nodes/_base/components/variable/utils'
import type { ValueSelector, Var } from '@/app/components/workflow/types'
type Params = {
  onlyLeafNodeVar?: boolean
  filterVar: (payload: Var, selector: ValueSelector) => boolean
}

const useAvailableVarList = (nodeId: string, {
  onlyLeafNodeVar,
  filterVar,
}: Params = {
  onlyLeafNodeVar: false,
  filterVar: () => true,
}) => {
  const { t } = useTranslation()

  const { getTreeLeafNodes, getBeforeNodesInSameBranch } = useWorkflow()
  const isChatMode = useIsChatMode()

  const availableNodes = onlyLeafNodeVar ? getTreeLeafNodes(nodeId) : getBeforeNodesInSameBranch(nodeId)

  const {
    parentNode: iterationNode,
  } = useNodeInfo(nodeId)

  const availableVars = toNodeAvailableVars({
    parentNode: iterationNode,
    t,
    beforeNodes: availableNodes,
    isChatMode,
    filterVar,
  })

  return {
    availableVars,
    availableNodes,
    availableNodesWithParent: iterationNode ? [...availableNodes, iterationNode] : availableNodes,
  }
}

export default useAvailableVarList
