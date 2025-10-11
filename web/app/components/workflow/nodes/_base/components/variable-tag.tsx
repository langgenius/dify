import { useCallback, useMemo } from 'react'
import { useReactFlow, useStoreApi } from 'reactflow'
import { useTranslation } from 'react-i18next'
import type {
  Node,
  ValueSelector,
  VarType,
} from '@/app/components/workflow/types'
import { BlockEnum } from '@/app/components/workflow/types'
import { isConversationVar, isENV, isRagVariableVar, isSystemVar } from '@/app/components/workflow/nodes/_base/components/variable/utils'
import { isExceptionVariable } from '@/app/components/workflow/utils'
import {
  VariableLabelInSelect,
} from '@/app/components/workflow/nodes/_base/components/variable/variable-label'
import { useFindNode } from '@/app/components/workflow/hooks/use-find-node'

type VariableTagProps = {
  valueSelector: ValueSelector
  varType: VarType
  isShort?: boolean
  availableNodes?: Node[]
}
const VariableTag = ({
  valueSelector,
  varType,
  isShort,
  availableNodes,
}: VariableTagProps) => {
  const isRagVar = isRagVariableVar(valueSelector)
  const nodeFromAvailableNodes = useFindNode(isRagVar ? [valueSelector[1]] : [valueSelector[0]], availableNodes)
  const node = useMemo(() => {
    if (isSystemVar(valueSelector)) {
      const startNode = availableNodes?.find(n => n.data.type === BlockEnum.Start)
      if (startNode)
        return startNode
    }
    return nodeFromAvailableNodes
  }, [valueSelector, availableNodes, isRagVar, nodeFromAvailableNodes]) as Node

  const isEnv = isENV(valueSelector)
  const isChatVar = isConversationVar(valueSelector)
  const isValid = Boolean(node) || isEnv || isChatVar || isRagVar

  const variableName = isSystemVar(valueSelector) ? valueSelector.slice(0).join('.') : valueSelector.slice(1).join('.')
  const isException = isExceptionVariable(variableName, node?.data.type)

  const reactflow = useReactFlow()
  const store = useStoreApi()

  const handleVariableJump = useCallback(() => {
    const workflowContainer = document.getElementById('workflow-container')
    const {
      clientWidth,
      clientHeight,
    } = workflowContainer!

    const {
      setViewport,
    } = reactflow
    const { transform } = store.getState()
    const zoom = transform[2]
    const position = node.position
    setViewport({
      x: (clientWidth - 400 - node.width! * zoom) / 2 - position!.x * zoom,
      y: (clientHeight - node.height! * zoom) / 2 - position!.y * zoom,
      zoom: transform[2],
    })
  }, [node, reactflow, store])

  const { t } = useTranslation()
  return (
    <VariableLabelInSelect
      variables={valueSelector}
      nodeType={node?.data.type}
      nodeTitle={node?.data.title}
      variableType={!isShort ? varType : undefined}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey) {
          e.stopPropagation()
          handleVariableJump()
        }
      }}
      errorMsg={!isValid ? t('workflow.errorMsg.invalidVariable') : undefined}
      isExceptionVariable={isException}
    />
  )
}

export default VariableTag
