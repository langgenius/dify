import type { VariablePayload } from './types'
import { memo } from 'react'
import { cn } from '@/utils/classnames'
import VariableLabel from './base/variable-label'

const VariableLabelInNode = (variablePayload: VariablePayload) => {
  return (
    <VariableLabel
      className={cn(
        'w-full space-x-[1px] bg-workflow-block-parma-bg px-1 shadow-none',
      )}
      {...variablePayload}
    />
  )
}

export default memo(VariableLabelInNode)
