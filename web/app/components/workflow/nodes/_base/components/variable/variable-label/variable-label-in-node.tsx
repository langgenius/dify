import { memo } from 'react'
import type { VariablePayload } from './types'
import VariableLabel from './base/variable-label'
import cn from '@/utils/classnames'

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
