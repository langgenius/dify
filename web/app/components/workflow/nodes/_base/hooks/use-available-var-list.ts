import { useStoreApi } from 'reactflow'
import { useTranslation } from 'react-i18next'
import {
  useIsChatMode,
  useWorkflow,
} from '@/app/components/workflow/hooks'
import { isSystemVar, toNodeOutputVars } from '@/app/components/workflow/nodes/_base/components/variable/utils'
import type { ValueSelector, Var } from '@/app/components/workflow/types'
import { BlockEnum, VarType } from '@/app/components/workflow/types'

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
  const store = useStoreApi()
  const {
    getNodes,
  } = store.getState()

  const availableNodes = onlyLeafNodeVar ? getTreeLeafNodes(nodeId) : getBeforeNodesInSameBranch(nodeId)
  const allOutputVars = toNodeOutputVars(availableNodes, isChatMode)
  const startNode = availableNodes.find((node: any) => {
    return node.data.type === BlockEnum.Start
  })
  const node = getNodes().find(n => n.id === nodeId)
  const isInIteration = !!node?.data.isInIteration
  const iterationNode = isInIteration ? getNodes().find(n => n.id === node.parentId) : null
  const getVarType = (value: ValueSelector, outputVarNodeId: string, isConstant: boolean, isIterationVar: boolean): VarType | 'undefined' => {
    if (isConstant)
      return 'undefined'

    if (isIterationVar) {
      if (value[1] === 'item')
        // eslint-disable-next-line @typescript-eslint/no-use-before-define
        return iterationItemType
      return VarType.number
    }
    const isSystem = isSystemVar(value as ValueSelector)
    const targetVarNodeId = isSystem ? startNode?.id : outputVarNodeId
    const targetVar = allOutputVars.find(v => v.nodeId === targetVarNodeId)

    if (!targetVar)
      return 'undefined'

    let type: VarType = VarType.string
    let curr: any = targetVar.vars
    if (isSystem) {
      return curr.find((v: any) => v.variable === (value as ValueSelector).join('.'))?.type
    }
    else {
      (value as ValueSelector).slice(1).forEach((key, i) => {
        const isLast = i === value.length - 2
        curr = curr?.find((v: any) => v.variable === key)
        if (isLast) {
          type = curr?.type
        }
        else {
          if (curr?.type === VarType.object)
            curr = curr.children
        }
      })
      return type
    }
  }
  const iterationItemType = (() => {
    if (!isInIteration)
      return VarType.string

    const arrType = getVarType(iterationNode?.data.iterator_selector || [], iterationNode?.data.iterator_selector[0] || '', false, false)
    switch (arrType) {
      case VarType.arrayString:
        return VarType.string
      case VarType.arrayNumber:
        return VarType.number
      case VarType.arrayObject:
        return VarType.object
      case VarType.array:
        return VarType.any
      case VarType.arrayFile:
        return VarType.object
      default:
        return VarType.string
    }
  })()

  const availableVars = toNodeOutputVars(availableNodes, isChatMode, filterVar)
  if (isInIteration && node?.parentId) {
    const iterationVar = {
      nodeId: node.parentId,
      title: t('workflow.nodes.iteration.iterationContent'),
      vars: [
        {
          variable: 'item',
          type: iterationItemType as VarType,
        },
        {
          variable: 'index',
          type: VarType.number,
        },
      ].filter((item) => {
        if (item.type === VarType.any)
          return true

        return filterVar(item, [node.parentId!, item.variable])
      }),
    }

    if (iterationVar.vars.length > 0)
      availableVars.push(iterationVar)
  }

  return {
    availableVars,
    availableNodes,
  }
}

export default useAvailableVarList
