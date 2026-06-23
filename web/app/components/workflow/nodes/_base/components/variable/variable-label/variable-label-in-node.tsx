import type { VariablePayload } from './types'
import { cn } from '@langgenius/dify-ui/cn'
import { memo } from 'react'
import VariableLabel from './base/variable-label'

const VariableLabelInNode = (variablePayload: VariablePayload) => {
  return (
    <VariableLabel
      className={cn(
        'w-full space-x-px bg-workflow-block-parma-bg px-1 shadow-none',
      )}
      {...variablePayload}
    />
  )
}

export default memo(VariableLabelInNode)
