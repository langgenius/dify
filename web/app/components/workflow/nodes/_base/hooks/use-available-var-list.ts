import {
  useIsChatMode,
  useWorkflow,
} from '@/app/components/workflow/hooks'
import { toNodeOutputVars } from '@/app/components/workflow/nodes/_base/components/variable/utils'
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
  const { getTreeLeafNodes, getBeforeNodesInSameBranch } = useWorkflow()
  const isChatMode = useIsChatMode()

  const availableNodes = onlyLeafNodeVar ? getTreeLeafNodes(nodeId) : getBeforeNodesInSameBranch(nodeId)
  const availableVars = toNodeOutputVars(availableNodes, isChatMode, filterVar)
  return {
    availableVars,
    availableNodes,
  }
}

export default useAvailableVarList
