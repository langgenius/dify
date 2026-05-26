import type { VariablePayload } from '@/app/components/workflow/nodes/_base/components/variable/variable-label/types'
import { cn } from '@langgenius/dify-ui/cn'
import { memo } from 'react'
import VariableLabel from '@/app/components/workflow/nodes/_base/components/variable/variable-label/base/variable-label'

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
