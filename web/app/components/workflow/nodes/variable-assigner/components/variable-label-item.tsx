import { memo } from 'react'
import type { ValueSelector } from '@/app/components/workflow/types'
import { useFindNode } from '@/app/components/workflow/hooks/use-find-node'
import { isSystemVar } from '@/app/components/workflow/nodes/_base/components/variable/utils'
import { isExceptionVariable } from '@/app/components/workflow/utils'
import {
  VariableLabelInNode,
} from '@/app/components/workflow/nodes/_base/components/variable/variable-label'

type VariableLabelItemProps = {
  variable: ValueSelector
}
const VariableLabelItem = ({ variable }: VariableLabelItemProps) => {
  const isSystem = isSystemVar(variable)
  const node = useFindNode(variable)
  const varName = isSystem ? `sys.${variable[variable.length - 1]}` : variable.slice(1).join('.')
  const isException = isExceptionVariable(varName, node?.data.type)

  return (
    <VariableLabelInNode
      variables={variable}
      nodeType={node?.data.type}
      nodeTitle={node?.data.title}
      isExceptionVariable={isException}
    />
  )
}

export default memo(VariableLabelItem)
