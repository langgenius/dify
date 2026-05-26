import type { VariablePayload } from '@/app/components/workflow/nodes/_base/components/variable/variable-label/types'
import { memo } from 'react'
import VariableLabel from '@/app/components/workflow/nodes/_base/components/variable/variable-label/base/variable-label'

const VariableLabelInSelect = (variablePayload: VariablePayload) => {
  return (
    <VariableLabel
      {...variablePayload}
    />
  )
}

export default memo(VariableLabelInSelect)
