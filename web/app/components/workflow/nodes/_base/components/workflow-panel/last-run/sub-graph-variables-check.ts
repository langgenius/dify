import type { ValueSelector } from '@/app/components/workflow/types'
import type { NodeWithVar } from '@/types/workflow'
import { useCallback } from 'react'
import { useSubGraphNodesByParent } from '@/app/components/workflow/hooks'
import {
  isConversationVar,
  isENV,
  isRagVariableVar,
  isSystemVar,
} from '@/app/components/workflow/nodes/_base/components/variable/utils'

type Params = {
  currentNodeId: string
  nodesWithInspectVars: NodeWithVar[]
}

const resolveNestedValue = (value: unknown, path: string[]) => {
  if (!path.length)
    return value
  // Reason: inspect vars store top-level values; nested selectors need safe traversal.
  let current: unknown = value
  for (const key of path) {
    if (current === null || current === undefined)
      return undefined
    if (Array.isArray(current)) {
      const index = Number(key)
      if (!Number.isInteger(index))
        return undefined
      current = current[index]
      continue
    }
    if (typeof current === 'object') {
      current = (current as Record<string, unknown>)[key]
      continue
    }
    return undefined
  }
  return current
}

export const useSubGraphVariablesCheck = ({
  currentNodeId,
  nodesWithInspectVars,
}: Params) => {
  const { subGraphNodeIds } = useSubGraphNodesByParent(currentNodeId)

  const getInspectVarValueBySelector = useCallback((selector: ValueSelector) => {
    if (!selector || selector.length < 2)
      return { found: false, value: undefined }
    if (selector[0] === currentNodeId)
      return { found: false, value: undefined }
    if (isENV(selector) || isSystemVar(selector) || isConversationVar(selector) || isRagVariableVar(selector))
      return { found: false, value: undefined }

    const [nodeId, varName, ...restPath] = selector
    const nodeVars = nodesWithInspectVars.find(node => node.nodeId === nodeId)?.vars || []
    if (!nodeVars.length)
      return { found: false, value: undefined }

    const selectorKey = selector.join('.')
    const varBySelector = nodeVars.find(item => item.selector?.join('.') === selectorKey)
    const varByName = nodeVars.find(item => item.selector?.[1] === varName || item.name === varName)
    const targetVar = varBySelector || varByName
    if (!targetVar)
      return { found: false, value: undefined }

    if (!restPath.length)
      return { found: true, value: targetVar.value }

    return {
      found: true,
      value: resolveNestedValue(targetVar.value, restPath),
    }
  }, [currentNodeId, nodesWithInspectVars])

  const hasNullDependentOutputs = useCallback((vars?: ValueSelector[] | ValueSelector[][]) => {
    if (!vars || vars.length === 0)
      return false

    const isGroupedVars = Array.isArray(vars[0]) && Array.isArray((vars as ValueSelector[][])[0][0])
    const selectors = isGroupedVars ? (vars as ValueSelector[][]).flat() : (vars as ValueSelector[])
    const subGraphNodeIdSet = new Set(subGraphNodeIds)
    const details = selectors.map((selector) => {
      const { found, value } = getInspectVarValueBySelector(selector)
      const valueType = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value
      const isSubgraphOutput = subGraphNodeIdSet.has(selector[0])
      return {
        selector,
        found,
        valueType,
        isSubgraphOutput,
      }
    })
    const hasNull = details.some((item) => {
      if (!item.found)
        return item.isSubgraphOutput
      return item.valueType === 'null' || item.valueType === 'undefined'
    })
    return hasNull
  }, [getInspectVarValueBySelector, subGraphNodeIds])

  return {
    hasNullDependentOutputs,
  }
}
